//! HTTPS Contents API transport for encrypted sync packs (no system git).
//! Supports GitHub + Gitee; AtomGit returns a clear unsupported message for now.

use crate::error::{AppError, AppResult};
use crate::services::git_sync::SyncPullResult;
use crate::services::sync_pack::SyncManifest;
use crate::services::vault::SyncRemoteConfig;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use serde_json::json;

const MANIFEST_PATH: &str = "sync/manifest.json";
const PACK_PATH: &str = "sync/latest.posenc";
const USER_AGENT: &str = "personal-os-sync/0.1";

#[derive(Debug, Clone)]
pub struct RemoteRepo {
    pub provider: String,
    pub owner: String,
    pub name: String,
    pub branch: String,
}

#[derive(Debug, Clone)]
pub struct PulledPack {
    pub ciphertext: Vec<u8>,
    pub manifest: SyncManifest,
}

pub struct HttpsGitHostTransport {
    client: reqwest::blocking::Client,
}

impl Default for HttpsGitHostTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpsGitHostTransport {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client");
        Self { client }
    }

    pub fn parse_remote(remote: &SyncRemoteConfig) -> AppResult<RemoteRepo> {
        let provider = normalize_provider(&remote.provider, &remote.repo_url);
        if provider == "atomgit" {
            return Err(AppError::Other(
                "AtomGit 暂未接入 HTTPS Contents API，请使用 GitHub 或 Gitee 私有仓".into(),
            ));
        }
        let (owner, name) = parse_owner_repo(&remote.repo_url)?;
        let branch = if remote.branch.trim().is_empty() {
            "main".into()
        } else {
            remote.branch.trim().to_string()
        };
        Ok(RemoteRepo {
            provider,
            owner,
            name,
            branch,
        })
    }

    pub fn test_connection(&self, remote: &SyncRemoteConfig, pat: &str) -> AppResult<String> {
        let repo = Self::parse_remote(remote)?;
        match self.get_file(&repo, pat, MANIFEST_PATH) {
            Ok(Some(_)) => Ok(format!(
                "连接成功 · {} · {}/{}（已有同步包）",
                repo.provider, repo.owner, repo.name
            )),
            Ok(None) => Ok(format!(
                "连接成功 · {} · {}/{}（仓库可访问，尚无同步包，首次推送时创建）",
                repo.provider, repo.owner, repo.name
            )),
            Err(e) => {
                // Fallback: probe repo root
                let _ = self.probe_repo(&repo, pat).map_err(|_| e.clone_msg())?;
                Ok(format!(
                    "连接成功 · {} · {}/{}（仓库可访问）",
                    repo.provider, repo.owner, repo.name
                ))
            }
        }
    }

    pub fn pull_pack(
        &self,
        remote: &SyncRemoteConfig,
        pat: &str,
    ) -> AppResult<Option<PulledPack>> {
        let repo = Self::parse_remote(remote)?;
        let man = match self.get_file(&repo, pat, MANIFEST_PATH)? {
            Some(f) => f,
            None => return Ok(None),
        };
        let pack = match self.get_file(&repo, pat, PACK_PATH)? {
            Some(f) => f,
            None => {
                return Err(AppError::Other(
                    "远端有 manifest 但缺少 sync/latest.posenc".into(),
                ))
            }
        };
        let manifest: SyncManifest = serde_json::from_slice(&man.bytes)
            .map_err(|e| AppError::Other(format!("远端 manifest 无效: {e}")))?;
        Ok(Some(PulledPack {
            ciphertext: pack.bytes,
            manifest,
        }))
    }

    pub fn push_pack(
        &self,
        remote: &SyncRemoteConfig,
        pat: &str,
        ciphertext: &[u8],
        manifest: &SyncManifest,
    ) -> AppResult<String> {
        let repo = Self::parse_remote(remote)?;
        let man_json = serde_json::to_vec_pretty(manifest)?;

        let existing_man = self.get_file(&repo, pat, MANIFEST_PATH)?;
        let existing_pack = self.get_file(&repo, pat, PACK_PATH)?;

        self.put_file(
            &repo,
            pat,
            PACK_PATH,
            ciphertext,
            &format!("sync pack: {}", manifest.revision),
            existing_pack.as_ref().and_then(|f| f.sha.clone()),
        )?;
        self.put_file(
            &repo,
            pat,
            MANIFEST_PATH,
            &man_json,
            &format!("sync manifest: {}", manifest.revision),
            existing_man.as_ref().and_then(|f| f.sha.clone()),
        )?;
        Ok(manifest.revision.clone())
    }

    /// Read remote manifest content_hash if present (None = empty / no pack).
    pub fn remote_content_hash(
        &self,
        remote: &SyncRemoteConfig,
        pat: &str,
    ) -> AppResult<Option<String>> {
        let repo = Self::parse_remote(remote)?;
        let Some(man) = self.get_file(&repo, pat, MANIFEST_PATH)? else {
            return Ok(None);
        };
        let manifest: SyncManifest = serde_json::from_slice(&man.bytes)
            .map_err(|e| AppError::Other(format!("远端 manifest 无效: {e}")))?;
        Ok(Some(manifest.content_hash))
    }

    /// Map HTTPS pull into SyncPullResult relative to local last_content_hash.
    pub fn pull_result(
        &self,
        remote: &SyncRemoteConfig,
        pat: &str,
        local_hash: Option<&str>,
    ) -> AppResult<(SyncPullResult, Option<PulledPack>)> {
        match self.pull_pack(remote, pat)? {
            None => Ok((
                SyncPullResult {
                    status: "empty".into(),
                    revision: None,
                    content_hash: None,
                    conflict: None,
                },
                None,
            )),
            Some(pulled) => {
                if local_hash.is_some_and(|h| h == pulled.manifest.content_hash) {
                    Ok((
                        SyncPullResult {
                            status: "up_to_date".into(),
                            revision: Some(pulled.manifest.revision.clone()),
                            content_hash: Some(pulled.manifest.content_hash.clone()),
                            conflict: None,
                        },
                        Some(pulled),
                    ))
                } else {
                    Ok((
                        SyncPullResult {
                            status: "updated".into(),
                            revision: Some(pulled.manifest.revision.clone()),
                            content_hash: Some(pulled.manifest.content_hash.clone()),
                            conflict: None,
                        },
                        Some(pulled),
                    ))
                }
            }
        }
    }

    fn probe_repo(&self, repo: &RemoteRepo, pat: &str) -> AppResult<()> {
        let url = match repo.provider.as_str() {
            "gitee" => format!(
                "https://gitee.com/api/v5/repos/{}/{}?access_token={}",
                repo.owner,
                repo.name,
                urlencoding_minimal(pat)
            ),
            _ => format!(
                "https://api.github.com/repos/{}/{}",
                repo.owner, repo.name
            ),
        };
        let mut req = self.client.get(&url);
        if repo.provider != "gitee" {
            req = req.header("Authorization", format!("Bearer {pat}"));
            req = req.header("Accept", "application/vnd.github+json");
            req = req.header("X-GitHub-Api-Version", "2022-11-28");
        }
        let res = req
            .send()
            .map_err(|e| AppError::Other(format!("网络请求失败: {e}")))?;
        if res.status().is_success() {
            return Ok(());
        }
        let code = res.status();
        let body = res.text().unwrap_or_default();
        Err(map_http_err(code, &body, &repo.provider))
    }

    fn get_file(
        &self,
        repo: &RemoteRepo,
        pat: &str,
        path: &str,
    ) -> AppResult<Option<RemoteFile>> {
        let url = contents_url(repo, path, pat, true)?;
        let mut req = self.client.get(&url);
        req = apply_auth(req, repo, pat);
        let res = req
            .send()
            .map_err(|e| AppError::Other(format!("拉取 {path} 失败: {e}")))?;
        let status = res.status();
        let status_u = status.as_u16();
        // Gitee often uses 400/404 for missing paths; treat common "not found" as None.
        if status_u == 404 {
            return Ok(None);
        }
        let text = res
            .text()
            .map_err(|e| AppError::Other(format!("读取 Contents 响应失败: {e}")))?;
        if !status.is_success() {
            if is_missing_contents_body(&text) {
                return Ok(None);
            }
            return Err(map_http_err(status, &text, &repo.provider));
        }
        if text.trim().is_empty() || text.trim() == "null" {
            return Ok(None);
        }

        let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            let snippet: String = text.chars().take(160).collect();
            AppError::Other(format!(
                "解析 Contents 响应失败（HTTP {status_u}）: {e} · {snippet}"
            ))
        })?;

        // Directory listing → treat as missing file at this exact path.
        if value.is_array() {
            return Ok(None);
        }

        let file_obj = match unwrap_contents_object(&value) {
            Some(v) => v,
            None => {
                if value.get("message").is_some() {
                    return Ok(None);
                }
                let snippet: String = text.chars().take(160).collect();
                return Err(AppError::Other(format!(
                    "解析 Contents 响应失败：无法识别文件对象 · {snippet}"
                )));
            }
        };

        let sha = json_string(file_obj.get("sha"));
        let download_url = json_string(file_obj.get("download_url"))
            .filter(|s| !s.is_empty());
        let content = json_string(file_obj.get("content"));

        if content.is_none() {
            if let Some(dl) = download_url {
                let bytes = self.download_bytes(&dl, repo, pat)?;
                return Ok(Some(RemoteFile { bytes, sha }));
            }
            if let Some(ref sha_v) = sha {
                let bytes = self.fetch_blob(repo, pat, sha_v)?;
                return Ok(Some(RemoteFile {
                    bytes,
                    sha: sha.clone(),
                }));
            }
            return Ok(None);
        }

        let cleaned: String = content
            .unwrap_or_default()
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        if cleaned.is_empty() {
            if let Some(dl) = download_url {
                let bytes = self.download_bytes(&dl, repo, pat)?;
                return Ok(Some(RemoteFile { bytes, sha }));
            }
            if let Some(ref sha_v) = sha {
                let bytes = self.fetch_blob(repo, pat, sha_v)?;
                return Ok(Some(RemoteFile {
                    bytes,
                    sha: sha.clone(),
                }));
            }
            return Ok(None);
        }
        let bytes = B64
            .decode(cleaned.as_bytes())
            .map_err(|e| AppError::Other(format!("Base64 解码失败: {e}")))?;
        Ok(Some(RemoteFile { bytes, sha }))
    }

    fn download_bytes(
        &self,
        url: &str,
        repo: &RemoteRepo,
        pat: &str,
    ) -> AppResult<Vec<u8>> {
        let mut req = self.client.get(url);
        req = apply_auth(req, repo, pat);
        let res = req
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .map_err(|e| AppError::Other(format!("下载文件失败: {e}")))?;
        Ok(res.to_vec())
    }

    fn fetch_blob(&self, repo: &RemoteRepo, pat: &str, sha: &str) -> AppResult<Vec<u8>> {
        let url = match repo.provider.as_str() {
            "gitee" => format!(
                "https://gitee.com/api/v5/repos/{}/{}/git/blobs/{}?access_token={}",
                repo.owner,
                repo.name,
                urlencoding_minimal(sha),
                urlencoding_minimal(pat)
            ),
            _ => format!(
                "https://api.github.com/repos/{}/{}/git/blobs/{}",
                repo.owner, repo.name, sha
            ),
        };
        let mut req = self.client.get(&url);
        req = apply_auth(req, repo, pat);
        let res = req
            .send()
            .map_err(|e| AppError::Other(format!("拉取 blob 失败: {e}")))?;
        if !res.status().is_success() {
            let code = res.status();
            let body = res.text().unwrap_or_default();
            return Err(map_http_err(code, &body, &repo.provider));
        }
        let parsed: BlobResponse = res
            .json()
            .map_err(|e| AppError::Other(format!("解析 blob 失败: {e}")))?;
        let cleaned: String = parsed
            .content
            .unwrap_or_default()
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        B64.decode(cleaned.as_bytes())
            .map_err(|e| AppError::Other(format!("Blob Base64 解码失败: {e}")))
    }

    fn put_file(
        &self,
        repo: &RemoteRepo,
        pat: &str,
        path: &str,
        bytes: &[u8],
        message: &str,
        sha: Option<String>,
    ) -> AppResult<()> {
        let url = contents_url(repo, path, pat, false)?;
        let mut body = json!({
            "message": message,
            "content": B64.encode(bytes),
            "branch": repo.branch,
        });
        // Gitee expects access_token in JSON body as well as (optionally) query.
        if repo.provider == "gitee" {
            body["access_token"] = json!(pat);
        }
        if let Some(ref sha) = sha {
            body["sha"] = json!(sha);
        }

        // GitHub: PUT create-or-update. Gitee: POST create, PUT update.
        let res = if repo.provider == "gitee" && sha.is_none() {
            let mut req = self.client.post(&url).json(&body);
            req = apply_auth(req, repo, pat);
            req.send()
                .map_err(|e| AppError::Other(format!("上传 {path} 失败: {e}")))?
        } else {
            let mut req = self.client.put(&url).json(&body);
            req = apply_auth(req, repo, pat);
            req.send()
                .map_err(|e| AppError::Other(format!("上传 {path} 失败: {e}")))?
        };

        if res.status().is_success() {
            return Ok(());
        }
        let code = res.status();
        let text = res.text().unwrap_or_default();

        // Gitee: if update failed because file missing, retry create via POST.
        if repo.provider == "gitee"
            && sha.is_some()
            && (code.as_u16() == 404 || is_missing_contents_body(&text))
        {
            let mut body2 = body.clone();
            if let Some(obj) = body2.as_object_mut() {
                obj.remove("sha");
            }
            let mut req = self.client.post(&url).json(&body2);
            req = apply_auth(req, repo, pat);
            let res2 = req
                .send()
                .map_err(|e| AppError::Other(format!("上传 {path} 失败: {e}")))?;
            if res2.status().is_success() {
                return Ok(());
            }
            let code2 = res2.status();
            let text2 = res2.text().unwrap_or_default();
            return Err(map_http_err(code2, &text2, &repo.provider));
        }

        Err(map_http_err(code, &text, &repo.provider))
    }
}

#[derive(Debug)]
struct RemoteFile {
    bytes: Vec<u8>,
    sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BlobResponse {
    content: Option<String>,
}

fn json_string(v: Option<&serde_json::Value>) -> Option<String> {
    match v? {
        serde_json::Value::String(s) => Some(s.clone()),
        other if !other.is_null() => Some(other.to_string().trim_matches('"').to_string()),
        _ => None,
    }
}

/// GitHub/Gitee GET is a flat file object; write responses nest under `content`.
fn unwrap_contents_object(value: &serde_json::Value) -> Option<&serde_json::Value> {
    if value.get("sha").is_some() || value.get("download_url").is_some() || value.get("encoding").is_some()
    {
        return Some(value);
    }
    if let Some(inner) = value.get("content") {
        if inner.is_object() {
            return Some(inner);
        }
        // Flat file object may have string "content" (base64) — that's the file itself.
        if inner.is_string() && (value.get("path").is_some() || value.get("name").is_some()) {
            return Some(value);
        }
    }
    if value.get("path").is_some() || value.get("name").is_some() || value.get("type").is_some() {
        return Some(value);
    }
    None
}

fn is_missing_contents_body(body: &str) -> bool {
    let lower = body.to_lowercase();
    lower.contains("not found")
        || lower.contains("404")
        || body.contains("不存在")
        || body.contains("无法找到")
        || body.contains("没有找到")
        || body.contains("文件不存在")
}

trait CloneMsg {
    fn clone_msg(&self) -> AppError;
}

impl CloneMsg for AppError {
    fn clone_msg(&self) -> AppError {
        AppError::Other(self.to_string())
    }
}

fn normalize_provider(provider: &str, repo_url: &str) -> String {
    let p = provider.trim().to_lowercase();
    if !p.is_empty() && p != "auto" {
        return p;
    }
    let u = repo_url.to_lowercase();
    if u.contains("gitee.com") {
        "gitee".into()
    } else if u.contains("atomgit.com") {
        "atomgit".into()
    } else {
        "github".into()
    }
}

fn parse_owner_repo(repo_url: &str) -> AppResult<(String, String)> {
    let url = repo_url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let path = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| AppError::Other("仓库 URL 请使用 HTTPS 地址".into()))?;
    let mut parts = path.split('/');
    let _host = parts.next();
    let owner = parts
        .next()
        .ok_or_else(|| AppError::Other("无法从 URL 解析 owner/repo".into()))?;
    let name = parts
        .next()
        .ok_or_else(|| AppError::Other("无法从 URL 解析 owner/repo".into()))?;
    if owner.is_empty() || name.is_empty() {
        return Err(AppError::Other("无法从 URL 解析 owner/repo".into()));
    }
    Ok((owner.to_string(), name.to_string()))
}

fn contents_url(repo: &RemoteRepo, path: &str, pat: &str, with_ref: bool) -> AppResult<String> {
    let enc_path = path
        .split('/')
        .map(urlencoding_minimal)
        .collect::<Vec<_>>()
        .join("/");
    match repo.provider.as_str() {
        "gitee" => {
            let mut u = format!(
                "https://gitee.com/api/v5/repos/{}/{}/contents/{}?access_token={}",
                repo.owner,
                repo.name,
                enc_path,
                urlencoding_minimal(pat)
            );
            if with_ref {
                u.push_str(&format!("&ref={}", urlencoding_minimal(&repo.branch)));
            }
            Ok(u)
        }
        "github" => {
            let mut u = format!(
                "https://api.github.com/repos/{}/{}/contents/{}",
                repo.owner, repo.name, enc_path
            );
            if with_ref {
                u.push_str(&format!("?ref={}", urlencoding_minimal(&repo.branch)));
            }
            Ok(u)
        }
        other => Err(AppError::Other(format!("不支持的 provider: {other}"))),
    }
}

fn apply_auth(
    mut req: reqwest::blocking::RequestBuilder,
    repo: &RemoteRepo,
    pat: &str,
) -> reqwest::blocking::RequestBuilder {
    if repo.provider == "github" {
        req = req.header("Authorization", format!("Bearer {pat}"));
        req = req.header("Accept", "application/vnd.github+json");
        req = req.header("X-GitHub-Api-Version", "2022-11-28");
    } else if repo.provider == "gitee" {
        req = req.header("Accept", "application/json");
        req = req.header("Content-Type", "application/json");
    }
    req
}

fn map_http_err(code: reqwest::StatusCode, body: &str, provider: &str) -> AppError {
    let snippet: String = body.chars().take(200).collect();
    let hint = if code.as_u16() == 401 || code.as_u16() == 403 {
        if provider == "gitee" {
            "请检查 Gitee 私人令牌是否有仓库读写权限"
        } else {
            "请检查 GitHub PAT 是否包含 repo 权限"
        }
    } else if code.as_u16() == 404 {
        "仓库不存在或无权访问，请检查 URL 与令牌"
    } else {
        "请求失败"
    };
    AppError::Other(format!("{hint}（HTTP {code}）{snippet}"))
}

fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_github_url() {
        let (o, n) = parse_owner_repo("https://github.com/acme/personal-os.git").unwrap();
        assert_eq!(o, "acme");
        assert_eq!(n, "personal-os");
    }

    #[test]
    fn unwrap_flat_and_nested_contents() {
        let flat = serde_json::json!({
            "type": "file",
            "sha": "abc",
            "content": "aGVsbG8=",
            "encoding": "base64"
        });
        assert!(unwrap_contents_object(&flat).is_some());

        let nested = serde_json::json!({
            "content": {
                "sha": "abc",
                "content": "aGVsbG8=",
                "encoding": "base64"
            },
            "commit": { "sha": "def" }
        });
        let inner = unwrap_contents_object(&nested).unwrap();
        assert_eq!(inner.get("sha").unwrap(), "abc");
    }

    #[test]
    fn missing_body_detect() {
        assert!(is_missing_contents_body(r#"{"message":"404 Not Found"}"#));
        assert!(is_missing_contents_body("文件不存在"));
    }
}
