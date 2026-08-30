package core

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// HTTPS Contents API transport for encrypted sync packs (no system git).
// Ported from services/sync_https.rs. Supports GitHub + Gitee.

const (
	manifestPath = "sync/manifest.json"
	packPath     = "sync/latest.posenc"
	userAgent    = "personal-os-sync/0.1"
)

// githubAPIBase is overridable so tests can point at a mock Contents API.
var githubAPIBase = "https://api.github.com"

type remoteRepo struct {
	provider string
	owner    string
	name     string
	branch   string
}

type remoteFile struct {
	bytes []byte
	sha   string
}

var httpClient = &http.Client{Timeout: 60 * time.Second}

func normalizeProvider(provider, repoURL string) string {
	p := strings.ToLower(strings.TrimSpace(provider))
	if p != "" && p != "auto" {
		return p
	}
	u := strings.ToLower(repoURL)
	if strings.Contains(u, "gitee.com") {
		return "gitee"
	}
	return "github"
}

func parseOwnerRepo(repoURL string) (string, string, error) {
	url := strings.TrimRight(strings.TrimSpace(repoURL), "/")
	url = strings.TrimSuffix(url, ".git")
	var path string
	switch {
	case strings.HasPrefix(url, "https://"):
		path = strings.TrimPrefix(url, "https://")
	case strings.HasPrefix(url, "http://"):
		path = strings.TrimPrefix(url, "http://")
	default:
		return "", "", errf("仓库 URL 请使用 HTTPS 地址")
	}
	parts := strings.Split(path, "/")
	if len(parts) < 3 || parts[1] == "" || parts[2] == "" {
		return "", "", errf("无法从 URL 解析 owner/repo")
	}
	return parts[1], parts[2], nil
}

func parseRemote(r SyncRemoteConfig) (remoteRepo, error) {
	provider := normalizeProvider(r.Provider, r.RepoURL)
	owner, name, err := parseOwnerRepo(r.RepoURL)
	if err != nil {
		return remoteRepo{}, err
	}
	branch := strings.TrimSpace(r.Branch)
	if branch == "" {
		branch = "main"
	}
	return remoteRepo{provider: provider, owner: owner, name: name, branch: branch}, nil
}

func urlEnc(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}

func contentsURL(repo remoteRepo, path, pat string, withRef bool) (string, error) {
	segs := strings.Split(path, "/")
	for i, s := range segs {
		segs[i] = urlEnc(s)
	}
	encPath := strings.Join(segs, "/")
	switch repo.provider {
	case "gitee":
		u := fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s/contents/%s?access_token=%s",
			repo.owner, repo.name, encPath, urlEnc(pat))
		if withRef {
			u += "&ref=" + urlEnc(repo.branch)
		}
		return u, nil
	case "github":
		u := fmt.Sprintf("" + githubAPIBase + "/repos/%s/%s/contents/%s", repo.owner, repo.name, encPath)
		if withRef {
			u += "?ref=" + urlEnc(repo.branch)
		}
		return u, nil
	default:
		return "", errf("不支持的 provider: %s", repo.provider)
	}
}

func applyAuth(req *http.Request, repo remoteRepo, pat string) {
	req.Header.Set("User-Agent", userAgent)
	if repo.provider == "github" {
		req.Header.Set("Authorization", "Bearer "+pat)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	} else if repo.provider == "gitee" {
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/json")
	}
}

func mapHTTPErr(code int, body, provider string) error {
	snippet := body
	if len(snippet) > 200 {
		snippet = snippet[:200]
	}
	var hint string
	switch {
	case code == 401 || code == 403:
		if provider == "gitee" {
			hint = "请检查 Gitee 私人令牌是否有仓库读写权限"
		} else {
			hint = "请检查 GitHub PAT 是否包含 repo 权限"
		}
	case code == 404:
		hint = "仓库不存在或无权访问，请检查 URL 与令牌"
	default:
		hint = "请求失败"
	}
	return errf("%s（HTTP %d）%s", hint, code, snippet)
}

func isMissingContentsBody(body string) bool {
	l := strings.ToLower(body)
	return strings.Contains(l, "not found") || strings.Contains(l, "404") ||
		strings.Contains(body, "不存在") || strings.Contains(body, "无法找到") ||
		strings.Contains(body, "没有找到") || strings.Contains(body, "文件不存在")
}

type contentsResp struct {
	Content     *string `json:"content"`
	SHA         *string `json:"sha"`
	DownloadURL *string `json:"download_url"`
	Message     *string `json:"message"`
}

// getFile fetches a file via the Contents API; returns (nil,nil) when missing.
func getFile(repo remoteRepo, pat, path string) (*remoteFile, error) {
	u, err := contentsURL(repo, path, pat, true)
	if err != nil {
		return nil, err
	}
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	applyAuth(req, repo, pat)
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, errf("拉取 %s 失败: %v", path, err)
	}
	defer res.Body.Close()
	bodyBytes, _ := io.ReadAll(res.Body)
	text := string(bodyBytes)
	if res.StatusCode == 404 {
		return nil, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		if isMissingContentsBody(text) {
			return nil, nil
		}
		return nil, mapHTTPErr(res.StatusCode, text, repo.provider)
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		return nil, nil // directory listing → treat as missing
	}
	var obj contentsResp
	if err := json.Unmarshal(bodyBytes, &obj); err != nil {
		return nil, errf("解析 Contents 响应失败: %v", err)
	}
	sha := ""
	if obj.SHA != nil {
		sha = *obj.SHA
	}
	cleaned := ""
	if obj.Content != nil {
		cleaned = stripWhitespace(*obj.Content)
	}
	if cleaned == "" {
		if obj.DownloadURL != nil && *obj.DownloadURL != "" {
			b, err := downloadBytes(*obj.DownloadURL, repo, pat)
			if err != nil {
				return nil, err
			}
			return &remoteFile{bytes: b, sha: sha}, nil
		}
		if sha != "" {
			b, err := fetchBlob(repo, pat, sha)
			if err != nil {
				return nil, err
			}
			return &remoteFile{bytes: b, sha: sha}, nil
		}
		if obj.Message != nil {
			return nil, nil
		}
		return nil, nil
	}
	b, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		return nil, errf("Base64 解码失败: %v", err)
	}
	return &remoteFile{bytes: b, sha: sha}, nil
}

func stripWhitespace(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r != ' ' && r != '\n' && r != '\r' && r != '\t' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func downloadBytes(url string, repo remoteRepo, pat string) ([]byte, error) {
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	applyAuth(req, repo, pat)
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, errf("下载文件失败: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, errf("下载文件失败: HTTP %d", res.StatusCode)
	}
	return io.ReadAll(res.Body)
}

func fetchBlob(repo remoteRepo, pat, sha string) ([]byte, error) {
	var u string
	if repo.provider == "gitee" {
		u = fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s/git/blobs/%s?access_token=%s",
			repo.owner, repo.name, urlEnc(sha), urlEnc(pat))
	} else {
		u = fmt.Sprintf("" + githubAPIBase + "/repos/%s/%s/git/blobs/%s", repo.owner, repo.name, sha)
	}
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	applyAuth(req, repo, pat)
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, errf("拉取 blob 失败: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, mapHTTPErr(res.StatusCode, string(body), repo.provider)
	}
	var parsed struct {
		Content *string `json:"content"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, errf("解析 blob 失败: %v", err)
	}
	cleaned := ""
	if parsed.Content != nil {
		cleaned = stripWhitespace(*parsed.Content)
	}
	return base64.StdEncoding.DecodeString(cleaned)
}

func putFile(repo remoteRepo, pat, path string, data []byte, message, sha string) error {
	u, err := contentsURL(repo, path, pat, false)
	if err != nil {
		return err
	}
	body := map[string]any{
		"message": message,
		"content": base64.StdEncoding.EncodeToString(data),
		"branch":  repo.branch,
	}
	if repo.provider == "gitee" {
		body["access_token"] = pat
	}
	if sha != "" {
		body["sha"] = sha
	}
	method := http.MethodPut
	if repo.provider == "gitee" && sha == "" {
		method = http.MethodPost
	}
	res, text, err := doJSON(method, u, repo, pat, body)
	if err != nil {
		return errf("上传 %s 失败: %v", path, err)
	}
	if res >= 200 && res < 300 {
		return nil
	}
	// Gitee: update failed because file missing → retry create via POST.
	if repo.provider == "gitee" && sha != "" && (res == 404 || isMissingContentsBody(text)) {
		delete(body, "sha")
		res2, text2, err := doJSON(http.MethodPost, u, repo, pat, body)
		if err != nil {
			return errf("上传 %s 失败: %v", path, err)
		}
		if res2 >= 200 && res2 < 300 {
			return nil
		}
		return mapHTTPErr(res2, text2, repo.provider)
	}
	return mapHTTPErr(res, text, repo.provider)
}

func doJSON(method, url string, repo remoteRepo, pat string, body map[string]any) (int, string, error) {
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, url, bytes.NewReader(raw))
	applyAuth(req, repo, pat)
	req.Header.Set("Content-Type", "application/json")
	res, err := httpClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b), nil
}

// ---- high-level transport ops ----

func transportTestConnection(remote SyncRemoteConfig, pat string) (string, error) {
	repo, err := parseRemote(remote)
	if err != nil {
		return "", err
	}
	f, err := getFile(repo, pat, manifestPath)
	if err != nil {
		// probe repo root as a fallback
		if perr := probeRepo(repo, pat); perr != nil {
			return "", err
		}
		return fmt.Sprintf("连接成功 · %s · %s/%s（仓库可访问）", repo.provider, repo.owner, repo.name), nil
	}
	if f != nil {
		return fmt.Sprintf("连接成功 · %s · %s/%s（已有同步包）", repo.provider, repo.owner, repo.name), nil
	}
	return fmt.Sprintf("连接成功 · %s · %s/%s（仓库可访问，尚无同步包，首次推送时创建）", repo.provider, repo.owner, repo.name), nil
}

func probeRepo(repo remoteRepo, pat string) error {
	var u string
	if repo.provider == "gitee" {
		u = fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s?access_token=%s", repo.owner, repo.name, urlEnc(pat))
	} else {
		u = fmt.Sprintf("" + githubAPIBase + "/repos/%s/%s", repo.owner, repo.name)
	}
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	applyAuth(req, repo, pat)
	res, err := httpClient.Do(req)
	if err != nil {
		return errf("网络请求失败: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	b, _ := io.ReadAll(res.Body)
	return mapHTTPErr(res.StatusCode, string(b), repo.provider)
}

type pulledPack struct {
	ciphertext []byte
	manifest   SyncManifest
}

func transportPullPack(remote SyncRemoteConfig, pat string) (*pulledPack, error) {
	repo, err := parseRemote(remote)
	if err != nil {
		return nil, err
	}
	man, err := getFile(repo, pat, manifestPath)
	if err != nil {
		return nil, err
	}
	if man == nil {
		return nil, nil
	}
	pack, err := getFile(repo, pat, packPath)
	if err != nil {
		return nil, err
	}
	if pack == nil {
		return nil, errf("远端有 manifest 但缺少 sync/latest.posenc")
	}
	var m SyncManifest
	if err := json.Unmarshal(man.bytes, &m); err != nil {
		return nil, errf("远端 manifest 无效: %v", err)
	}
	return &pulledPack{ciphertext: pack.bytes, manifest: m}, nil
}

func transportPushPack(remote SyncRemoteConfig, pat string, ciphertext []byte, manifest SyncManifest) (string, error) {
	repo, err := parseRemote(remote)
	if err != nil {
		return "", err
	}
	manJSON, _ := json.MarshalIndent(manifest, "", "  ")
	existingMan, _ := getFile(repo, pat, manifestPath)
	existingPack, _ := getFile(repo, pat, packPath)
	packSHA, manSHA := "", ""
	if existingPack != nil {
		packSHA = existingPack.sha
	}
	if existingMan != nil {
		manSHA = existingMan.sha
	}
	if err := putFile(repo, pat, packPath, ciphertext, "sync pack: "+manifest.Revision, packSHA); err != nil {
		return "", err
	}
	if err := putFile(repo, pat, manifestPath, manJSON, "sync manifest: "+manifest.Revision, manSHA); err != nil {
		return "", err
	}
	return manifest.Revision, nil
}

func transportRemoteContentHash(remote SyncRemoteConfig, pat string) (string, error) {
	repo, err := parseRemote(remote)
	if err != nil {
		return "", err
	}
	man, err := getFile(repo, pat, manifestPath)
	if err != nil {
		return "", err
	}
	if man == nil {
		return "", nil
	}
	var m SyncManifest
	if err := json.Unmarshal(man.bytes, &m); err != nil {
		return "", errf("远端 manifest 无效: %v", err)
	}
	return m.ContentHash, nil
}
