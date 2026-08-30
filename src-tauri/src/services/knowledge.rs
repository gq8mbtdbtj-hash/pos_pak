use crate::database::{get_entity_tags, remove_search_index, set_entity_tags, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::knowledge::{
    CreateKnowledgeInput, KnowledgeFile, KnowledgeMeta, KnowledgeTreeNode, UpdateKnowledgeInput,
};
use chrono::{DateTime, Utc};
use rusqlite::params;
use std::fs;
use std::path::{Path, PathBuf};

pub struct KnowledgeService<'a> {
    db: &'a Database,
    root: PathBuf,
}

impl<'a> KnowledgeService<'a> {
    pub fn new(db: &'a Database, root: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&root)?;
        for folder in ["cpp", "graphics", "android", "linux", "ai", "work", "life", "reading"] {
            fs::create_dir_all(root.join(folder))?;
        }
        Ok(Self { db, root })
    }

    pub fn tree(&self) -> AppResult<KnowledgeTreeNode> {
        Ok(build_tree_node(&self.root, &self.root))
    }

    pub fn read(&self, rel_path: &str) -> AppResult<KnowledgeFile> {
        let path = self.resolve_path(rel_path)?;
        if !path.exists() {
            return Err(AppError::NotFound(rel_path.to_string()));
        }
        let content = fs::read_to_string(&path)?;
        let meta = self.get_or_infer_meta(rel_path, &content)?;
        Ok(KnowledgeFile { meta, content })
    }

    pub fn create(&self, input: CreateKnowledgeInput) -> AppResult<KnowledgeFile> {
        let folder = sanitize_segment(&input.folder);
        let filename = format!("{}.md", sanitize_filename(&input.title));
        let rel_path = format!("{folder}/{filename}");
        let path = self.resolve_path(&rel_path)?;

        if path.exists() {
            return Err(AppError::Other(format!("file already exists: {rel_path}")));
        }

        let now = Utc::now();
        let tags = input.tags.unwrap_or_default();
        let body = input.content.unwrap_or_else(|| format!("# {}\n", input.title));
        let file_content = build_markdown(&input.title, &tags, &now, &body);

        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(&path, &file_content)?;

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO knowledge_meta (file_path, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![rel_path, input.title, now.to_rfc3339(), now.to_rfc3339()],
            )?;
            set_entity_tags(&tx, "knowledge_tags", "file_path", &rel_path, &tags)?;
            upsert_search_index(&tx, "knowledge", &rel_path, &input.title, &body)?;
            tx.commit()?;
            Ok(())
        })?;

        self.read(&rel_path)
    }

    pub fn update(&self, rel_path: &str, input: UpdateKnowledgeInput) -> AppResult<KnowledgeFile> {
        let path = self.resolve_path(rel_path)?;
        if !path.exists() {
            return Err(AppError::NotFound(rel_path.to_string()));
        }

        let existing = self.read(rel_path)?;
        let title = input.title.unwrap_or(existing.meta.title);
        let tags = input.tags.unwrap_or(existing.meta.tags);
        let now = Utc::now();
        let file_content = build_markdown(&title, &tags, &existing.meta.created_at, &input.content);

        fs::write(&path, &file_content)?;

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO knowledge_meta (file_path, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(file_path) DO UPDATE SET title=?2, updated_at=?4",
                params![
                    rel_path,
                    title,
                    existing.meta.created_at.to_rfc3339(),
                    now.to_rfc3339(),
                ],
            )?;
            set_entity_tags(&tx, "knowledge_tags", "file_path", rel_path, &tags)?;
            upsert_search_index(&tx, "knowledge", rel_path, &title, &input.content)?;
            tx.commit()?;
            Ok(())
        })?;

        self.read(rel_path)
    }

    pub fn delete(&self, rel_path: &str) -> AppResult<()> {
        let path = self.resolve_path(rel_path)?;
        if path.exists() {
            fs::remove_file(&path)?;
        }
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM knowledge_meta WHERE file_path = ?1", params![rel_path])?;
            remove_search_index(&tx, "knowledge", rel_path)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn rename(&self, rel_path: &str, new_title: &str) -> AppResult<KnowledgeFile> {
        let old = self.read(rel_path)?;
        let folder = Path::new(rel_path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("");
        let new_filename = format!("{}.md", sanitize_filename(new_title));
        let new_rel = if folder.is_empty() {
            new_filename.clone()
        } else {
            format!("{folder}/{new_filename}")
        };

        if rel_path != new_rel {
            let old_path = self.resolve_path(rel_path)?;
            let new_path = self.resolve_path(&new_rel)?;
            if new_path.exists() {
                return Err(AppError::Other("target file exists".into()));
            }
            fs::rename(&old_path, &new_path)?;
            self.db.with_conn(|conn| {
                conn.execute("DELETE FROM knowledge_meta WHERE file_path = ?1", params![rel_path])?;
                remove_search_index(conn, "knowledge", rel_path)?;
                Ok(())
            })?;
        }

        self.update(
            &new_rel,
            UpdateKnowledgeInput {
                content: old.content,
                title: Some(new_title.to_string()),
                tags: Some(old.meta.tags),
            },
        )
    }

    /// Full rebuild of knowledge search index (recovery / rare repair).
    #[allow(dead_code)]
    pub fn reindex_all(&self) -> AppResult<()> {
        for entry in walkdir::WalkDir::new(&self.root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
        {
            let path = entry.path();
            let rel = path
                .strip_prefix(&self.root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let content = fs::read_to_string(path)?;
            let meta = self.get_or_infer_meta(&rel, &content)?;
            self.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO knowledge_meta (file_path, title, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(file_path) DO UPDATE SET title=?2, updated_at=?4",
                    params![
                        rel,
                        meta.title,
                        meta.created_at.to_rfc3339(),
                        meta.updated_at.to_rfc3339(),
                    ],
                )?;
                upsert_search_index(&conn, "knowledge", &rel, &meta.title, &content)?;
                Ok(())
            })?;
        }
        Ok(())
    }

    fn resolve_path(&self, rel_path: &str) -> AppResult<PathBuf> {
        let rel = Path::new(rel_path);
        if rel.is_absolute() || rel.components().any(|c| c == std::path::Component::ParentDir) {
            return Err(AppError::Other("invalid path".into()));
        }
        Ok(self.root.join(rel))
    }

    fn get_or_infer_meta(&self, rel_path: &str, content: &str) -> AppResult<KnowledgeMeta> {
        if let Ok(meta) = self.get_meta(rel_path) {
            return Ok(meta);
        }
        let title = infer_title(rel_path, content);
        let now = Utc::now();
        Ok(KnowledgeMeta {
            file_path: rel_path.to_string(),
            title,
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    }

    fn get_meta(&self, rel_path: &str) -> AppResult<KnowledgeMeta> {
        self.db.with_conn(|conn| {
            let row = conn.query_row(
                "SELECT file_path, title, created_at, updated_at FROM knowledge_meta WHERE file_path = ?1",
                params![rel_path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )?;
            let tags = get_entity_tags(conn, "knowledge_tags", "file_path", rel_path)?;
            Ok(KnowledgeMeta {
                file_path: row.0,
                title: row.1,
                created_at: DateTime::parse_from_rfc3339(&row.2)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&row.3)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                tags,
            })
        })
    }
}

fn build_tree_node(root: &Path, current: &Path) -> KnowledgeTreeNode {
    let name = current
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("knowledge")
        .to_string();
    let rel = current
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    let mut children = Vec::new();
    if let Ok(entries) = fs::read_dir(current) {
        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                children.push(build_tree_node(root, &path));
            } else if path.extension().map(|e| e == "md").unwrap_or(false) {
                children.push(KnowledgeTreeNode {
                    name: path.file_name().unwrap().to_string_lossy().to_string(),
                    path: path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"),
                    is_dir: false,
                    children: vec![],
                });
            }
        }
    }

    KnowledgeTreeNode {
        name,
        path: rel,
        is_dir: true,
        children,
    }
}

fn build_markdown(title: &str, tags: &[String], created: &DateTime<Utc>, body: &str) -> String {
    let tags_yaml = if tags.is_empty() {
        "  []".to_string()
    } else {
        tags.iter()
            .map(|t| format!("  - {t}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let now = Utc::now();
    format!(
        "---\ntitle: {title}\ntags:\n{tags_yaml}\ncreated: {}\nupdated: {}\n---\n\n{body}",
        created.format("%Y-%m-%d"),
        now.format("%Y-%m-%d"),
    )
}

fn infer_title(rel_path: &str, content: &str) -> String {
    if let Some(line) = content.lines().find(|l| l.starts_with("# ")) {
        return line.trim_start_matches("# ").to_string();
    }
    Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn sanitize_segment(s: &str) -> String {
    s.trim().trim_matches('/').to_string()
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect::<String>()
        .replace(' ', "_")
}
