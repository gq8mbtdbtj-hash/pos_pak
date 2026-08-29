use crate::database::{get_entity_tags, remove_search_index, set_entity_tags, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::quick_note::{CreateQuickNoteInput, QuickNote};
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

pub struct QuickNoteService<'a> {
    db: &'a Database,
}

impl<'a> QuickNoteService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn create(&self, input: CreateQuickNoteInput) -> AppResult<QuickNote> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let tags = input.tags.unwrap_or_default();

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO quick_notes (id, content, note_type, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, input.content, input.note_type, now.to_rfc3339()],
            )?;
            set_entity_tags(&tx, "quick_note_tags", "quick_note_id", &id, &tags)?;
            upsert_search_index(&tx, "quick_note", &id, "Quick Note", &input.content)?;
            tx.commit()?;
            Ok(())
        })?;

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> AppResult<QuickNote> {
        self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, content, note_type, created_at FROM quick_notes WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound(format!("quick note {id}")))?;

            let tags = get_entity_tags(conn, "quick_note_tags", "quick_note_id", id)?;
            Ok(QuickNote {
                id: row.0,
                content: row.1,
                note_type: row.2,
                created_at: DateTime::parse_from_rfc3339(&row.3)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                tags,
            })
        })
    }

    pub fn list(&self, limit: Option<i32>) -> AppResult<Vec<QuickNote>> {
        self.db.with_conn(|conn| {
            let sql = match limit {
                Some(n) => format!(
                    "SELECT id, content, note_type, created_at FROM quick_notes
                     ORDER BY created_at DESC LIMIT {n}"
                ),
                None => "SELECT id, content, note_type, created_at FROM quick_notes
                          ORDER BY created_at DESC".to_string(),
            };
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;
            let mut notes = Vec::new();
            for row in rows {
                let (id, content, note_type, created_at) = row?;
                let tags = get_entity_tags(conn, "quick_note_tags", "quick_note_id", &id)?;
                notes.push(QuickNote {
                    id,
                    content,
                    note_type,
                    created_at: DateTime::parse_from_rfc3339(&created_at)
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    tags,
                });
            }
            Ok(notes)
        })
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM quick_notes WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "quick_note", id)?;
            tx.commit()?;
            Ok(())
        })
    }
}
