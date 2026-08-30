package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// KnowledgeFile serializes flat (filePath/title/tags/createdAt/updatedAt/content),
// matching the desktop Rust `#[serde(flatten)]` wire format.
type KnowledgeFile struct {
	FilePath  string    `json:"filePath"`
	Title     string    `json:"title"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Content   string    `json:"content"`
}

// meta returns the nested representation used by clients that expect file.meta.*.
func (k KnowledgeFile) MarshalJSON() ([]byte, error) {
	type flat struct {
		FilePath  string    `json:"filePath"`
		Title     string    `json:"title"`
		Tags      []string  `json:"tags"`
		CreatedAt time.Time `json:"createdAt"`
		UpdatedAt time.Time `json:"updatedAt"`
		Content   string    `json:"content"`
		Meta      knowledgeMeta `json:"meta"`
	}
	m := knowledgeMeta{FilePath: k.FilePath, Title: k.Title, Tags: k.Tags, CreatedAt: k.CreatedAt, UpdatedAt: k.UpdatedAt}
	return json.Marshal(flat{k.FilePath, k.Title, k.Tags, k.CreatedAt, k.UpdatedAt, k.Content, m})
}

type knowledgeMeta struct {
	FilePath  string    `json:"filePath"`
	Title     string    `json:"title"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type KnowledgeTreeNode struct {
	Name     string              `json:"name"`
	Path     string              `json:"path"`
	IsDir    bool                `json:"isDir"`
	Children []KnowledgeTreeNode `json:"children"`
}

type CreateKnowledgeInput struct {
	Folder  string    `json:"folder"`
	Title   string    `json:"title"`
	Content *string   `json:"content,omitempty"`
	Tags    *[]string `json:"tags,omitempty"`
}

type UpdateKnowledgeInput struct {
	Content string    `json:"content"`
	Title   *string   `json:"title,omitempty"`
	Tags    *[]string `json:"tags,omitempty"`
}

type knowledgeService struct {
	db   *DB
	root string
}

func newKnowledgeService(db *DB, root string) (*knowledgeService, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	entries, _ := os.ReadDir(root)
	hasFolder := false
	for _, e := range entries {
		if e.IsDir() {
			hasFolder = true
			break
		}
	}
	if !hasFolder {
		for _, f := range []string{"cpp", "graphics", "android", "linux", "ai", "work", "life", "reading"} {
			os.MkdirAll(filepath.Join(root, f), 0o755)
		}
	}
	return &knowledgeService{db: db, root: root}, nil
}

func (s *knowledgeService) listFolders() ([]string, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out, nil
}

func (s *knowledgeService) createFolder(name string) (string, error) {
	folder, err := sanitizeFolderName(name)
	if err != nil {
		return "", err
	}
	p := filepath.Join(s.root, folder)
	if _, err := os.Stat(p); err == nil {
		return "", errf("分类已存在：%s", folder)
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		return "", err
	}
	return folder, nil
}

func (s *knowledgeService) renameFolder(from, to string) (string, error) {
	ff, err := sanitizeFolderName(from)
	if err != nil {
		return "", err
	}
	tt, err := sanitizeFolderName(to)
	if err != nil {
		return "", err
	}
	if ff == tt {
		return tt, nil
	}
	oldPath := filepath.Join(s.root, ff)
	newPath := filepath.Join(s.root, tt)
	if fi, err := os.Stat(oldPath); err != nil || !fi.IsDir() {
		return "", notFound("分类不存在：" + ff)
	}
	if _, err := os.Stat(newPath); err == nil {
		return "", errf("分类已存在：%s", tt)
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return "", err
	}
	// Re-key metadata rows under the new folder prefix.
	rows, _ := s.db.sql.Query(`SELECT file_path, title, created_at, updated_at FROM knowledge_meta WHERE file_path LIKE ?`, ff+"/%")
	type row struct{ oldRel, title, created, updated string }
	var items []row
	for rows.Next() {
		var r row
		rows.Scan(&r.oldRel, &r.title, &r.created, &r.updated)
		items = append(items, r)
	}
	rows.Close()
	for _, r := range items {
		newRel := strings.Replace(r.oldRel, ff+"/", tt+"/", 1)
		tags, _ := getEntityTags(s.db.sql, "knowledge_tags", "file_path", r.oldRel)
		content, _ := os.ReadFile(filepath.Join(s.root, newRel))
		body := stripFrontmatter(string(content))
		tx, _ := s.db.sql.Begin()
		tx.Exec(`DELETE FROM knowledge_meta WHERE file_path = ?`, r.oldRel)
		removeSearchIndex(tx, "knowledge", r.oldRel)
		setEntityTags(tx, "knowledge_tags", "file_path", r.oldRel, []string{})
		tx.Exec(`INSERT INTO knowledge_meta (file_path, title, created_at, updated_at) VALUES (?, ?, ?, ?)`, newRel, r.title, r.created, r.updated)
		upsertSearchIndex(tx, "knowledge", newRel, r.title, body)
		if len(tags) > 0 {
			setEntityTags(tx, "knowledge_tags", "file_path", newRel, tags)
		}
		tx.Commit()
	}
	return tt, nil
}

func (s *knowledgeService) deleteFolder(name string) error {
	folder, err := sanitizeFolderName(name)
	if err != nil {
		return err
	}
	p := filepath.Join(s.root, folder)
	if fi, err := os.Stat(p); err != nil || !fi.IsDir() {
		return notFound("分类不存在：" + folder)
	}
	rows, _ := s.db.sql.Query(`SELECT file_path FROM knowledge_meta WHERE file_path LIKE ?`, folder+"/%")
	var files []string
	for rows.Next() {
		var f string
		rows.Scan(&f)
		files = append(files, f)
	}
	rows.Close()
	for _, f := range files {
		s.delete(f)
	}
	return os.RemoveAll(p)
}

func (s *knowledgeService) tree() (KnowledgeTreeNode, error) {
	return buildTreeNode(s.root, s.root), nil
}

func (s *knowledgeService) resolvePath(rel string) (string, error) {
	if filepath.IsAbs(rel) || strings.Contains(rel, "..") {
		return "", errf("invalid path")
	}
	return filepath.Join(s.root, filepath.FromSlash(rel)), nil
}

func (s *knowledgeService) read(rel string) (KnowledgeFile, error) {
	p, err := s.resolvePath(rel)
	if err != nil {
		return KnowledgeFile{}, err
	}
	content, err := os.ReadFile(p)
	if err != nil {
		return KnowledgeFile{}, notFound(rel)
	}
	meta := s.getOrInferMeta(rel, string(content))
	return KnowledgeFile{FilePath: meta.FilePath, Title: meta.Title, Tags: meta.Tags, CreatedAt: meta.CreatedAt, UpdatedAt: meta.UpdatedAt, Content: string(content)}, nil
}

func (s *knowledgeService) create(in CreateKnowledgeInput) (KnowledgeFile, error) {
	folder := strings.Trim(strings.TrimSpace(in.Folder), "/")
	filename := sanitizeFilename(in.Title) + ".md"
	rel := folder + "/" + filename
	p, err := s.resolvePath(rel)
	if err != nil {
		return KnowledgeFile{}, err
	}
	if _, err := os.Stat(p); err == nil {
		return KnowledgeFile{}, errf("file already exists: %s", rel)
	}
	now := nowUTC()
	tags := []string{}
	if in.Tags != nil {
		tags = *in.Tags
	}
	body := "# " + in.Title + "\n"
	if in.Content != nil {
		body = *in.Content
	}
	fileContent := buildMarkdown(in.Title, tags, now, body)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return KnowledgeFile{}, err
	}
	if err := os.WriteFile(p, []byte(fileContent), 0o644); err != nil {
		return KnowledgeFile{}, err
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return KnowledgeFile{}, err
	}
	defer tx.Rollback()
	tx.Exec(`INSERT INTO knowledge_meta (file_path, title, created_at, updated_at) VALUES (?, ?, ?, ?)`, rel, in.Title, rfc3339(now), rfc3339(now))
	setEntityTags(tx, "knowledge_tags", "file_path", rel, tags)
	upsertSearchIndex(tx, "knowledge", rel, in.Title, body)
	if err := tx.Commit(); err != nil {
		return KnowledgeFile{}, err
	}
	return s.read(rel)
}

func (s *knowledgeService) update(rel string, in UpdateKnowledgeInput) (KnowledgeFile, error) {
	p, err := s.resolvePath(rel)
	if err != nil {
		return KnowledgeFile{}, err
	}
	if _, err := os.Stat(p); err != nil {
		return KnowledgeFile{}, notFound(rel)
	}
	existing, err := s.read(rel)
	if err != nil {
		return KnowledgeFile{}, err
	}
	title := existing.Title
	if in.Title != nil {
		title = *in.Title
	}
	tags := existing.Tags
	if in.Tags != nil {
		tags = *in.Tags
	}
	now := nowUTC()
	fileContent := buildMarkdown(title, tags, existing.CreatedAt, in.Content)
	if err := os.WriteFile(p, []byte(fileContent), 0o644); err != nil {
		return KnowledgeFile{}, err
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return KnowledgeFile{}, err
	}
	defer tx.Rollback()
	tx.Exec(`INSERT INTO knowledge_meta (file_path, title, created_at, updated_at) VALUES (?, ?, ?, ?)
	         ON CONFLICT(file_path) DO UPDATE SET title=?, updated_at=?`,
		rel, title, rfc3339(existing.CreatedAt), rfc3339(now), title, rfc3339(now))
	setEntityTags(tx, "knowledge_tags", "file_path", rel, tags)
	upsertSearchIndex(tx, "knowledge", rel, title, in.Content)
	if err := tx.Commit(); err != nil {
		return KnowledgeFile{}, err
	}
	return s.read(rel)
}

func (s *knowledgeService) delete(rel string) error {
	p, err := s.resolvePath(rel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(p); err == nil {
		os.Remove(p)
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tx.Exec(`DELETE FROM knowledge_meta WHERE file_path = ?`, rel)
	removeSearchIndex(tx, "knowledge", rel)
	return tx.Commit()
}

func (s *knowledgeService) rename(rel, newTitle string) (KnowledgeFile, error) {
	old, err := s.read(rel)
	if err != nil {
		return KnowledgeFile{}, err
	}
	folder := filepath.ToSlash(filepath.Dir(rel))
	if folder == "." {
		folder = ""
	}
	newFilename := sanitizeFilename(newTitle) + ".md"
	newRel := newFilename
	if folder != "" {
		newRel = folder + "/" + newFilename
	}
	if rel != newRel {
		oldPath, _ := s.resolvePath(rel)
		newPath, _ := s.resolvePath(newRel)
		if _, err := os.Stat(newPath); err == nil {
			return KnowledgeFile{}, errf("target file exists")
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return KnowledgeFile{}, err
		}
		tx, _ := s.db.sql.Begin()
		tx.Exec(`DELETE FROM knowledge_meta WHERE file_path = ?`, rel)
		removeSearchIndex(tx, "knowledge", rel)
		tx.Commit()
	}
	return s.update(newRel, UpdateKnowledgeInput{Content: old.Content, Title: &newTitle, Tags: &old.Tags})
}

func (s *knowledgeService) getOrInferMeta(rel, content string) knowledgeMeta {
	if m, ok := s.getMeta(rel); ok {
		return m
	}
	now := nowUTC()
	return knowledgeMeta{FilePath: rel, Title: inferTitle(rel, content), Tags: []string{}, CreatedAt: now, UpdatedAt: now}
}

func (s *knowledgeService) getMeta(rel string) (knowledgeMeta, bool) {
	var title, created, updated string
	err := s.db.sql.QueryRow(`SELECT file_path, title, created_at, updated_at FROM knowledge_meta WHERE file_path = ?`, rel).
		Scan(&rel, &title, &created, &updated)
	if err != nil {
		return knowledgeMeta{}, false
	}
	tags, _ := getEntityTags(s.db.sql, "knowledge_tags", "file_path", rel)
	if tags == nil {
		tags = []string{}
	}
	return knowledgeMeta{FilePath: rel, Title: title, Tags: tags, CreatedAt: parseRFC3339(created), UpdatedAt: parseRFC3339(updated)}, true
}

func buildTreeNode(root, current string) KnowledgeTreeNode {
	name := filepath.Base(current)
	if current == root {
		name = "knowledge"
	}
	rel, _ := filepath.Rel(root, current)
	rel = filepath.ToSlash(rel)
	if rel == "." {
		rel = ""
	}
	children := []KnowledgeTreeNode{}
	entries, _ := os.ReadDir(current)
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, e := range entries {
		p := filepath.Join(current, e.Name())
		if e.IsDir() {
			children = append(children, buildTreeNode(root, p))
		} else if strings.HasSuffix(e.Name(), ".md") {
			childRel, _ := filepath.Rel(root, p)
			children = append(children, KnowledgeTreeNode{Name: e.Name(), Path: filepath.ToSlash(childRel), IsDir: false, Children: []KnowledgeTreeNode{}})
		}
	}
	return KnowledgeTreeNode{Name: name, Path: rel, IsDir: true, Children: children}
}

func buildMarkdown(title string, tags []string, created time.Time, body string) string {
	tagsYaml := "  []"
	if len(tags) > 0 {
		var b strings.Builder
		for i, t := range tags {
			if i > 0 {
				b.WriteString("\n")
			}
			b.WriteString("  - " + t)
		}
		tagsYaml = b.String()
	}
	now := nowUTC()
	return "---\ntitle: " + title + "\ntags:\n" + tagsYaml +
		"\ncreated: " + created.Format(dateFmt) + "\nupdated: " + now.Format(dateFmt) + "\n---\n\n" + body
}

func inferTitle(rel, content string) string {
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "# ") {
			return strings.TrimPrefix(line, "# ")
		}
	}
	base := filepath.Base(rel)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func sanitizeFolderName(s string) (string, error) {
	name := strings.Trim(strings.TrimSpace(s), "/")
	if name == "" {
		return "", errf("分类名不能为空")
	}
	if strings.ContainsAny(name, "/\\") || name == "." || name == ".." {
		return "", errf("分类名不合法")
	}
	if strings.ContainsAny(name, "<>:\"|?*") {
		return "", errf("分类名包含非法字符")
	}
	return name, nil
}

func stripFrontmatter(content string) string {
	trimmed := strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(trimmed, "---") {
		return content
	}
	rest := trimmed[3:]
	if idx := strings.Index(rest, "\n---"); idx >= 0 {
		return strings.TrimLeft(rest[idx+4:], "\n")
	}
	return content
}

func sanitizeFilename(s string) string {
	var b strings.Builder
	for _, c := range s {
		if strings.ContainsRune("<>:\"/\\|?*", c) {
			b.WriteRune('_')
		} else if c == ' ' {
			b.WriteRune('_')
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}
