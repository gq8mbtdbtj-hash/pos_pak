use crate::database::{get_entity_tags, remove_search_index, set_entity_tags, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::task::{
    CreateTaskInput, Task, TaskPriority, TaskStatus, UpdateTaskInput,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

pub struct TaskService<'a> {
    db: &'a Database,
}

impl<'a> TaskService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn create(&self, input: CreateTaskInput) -> AppResult<Task> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let priority = input.priority.unwrap_or(TaskPriority::Medium);
        let tags = input.tags.unwrap_or_default();

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO tasks (id, title, description, status, priority, due_at, created_at)
                 VALUES (?1, ?2, ?3, 'todo', ?4, ?5, ?6)",
                params![
                    id,
                    input.title,
                    input.description,
                    priority.as_str(),
                    input.due_at.map(|d| d.to_rfc3339()),
                    now.to_rfc3339(),
                ],
            )?;
            set_entity_tags(&tx, "task_tags", "task_id", &id, &tags)?;
            upsert_search_index(
                &tx,
                "task",
                &id,
                &input.title,
                &input.description.clone().unwrap_or_default(),
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> AppResult<Task> {
        self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, title, description, status, priority, due_at, created_at, completed_at
                     FROM tasks WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, Option<String>>(7)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound(format!("task {id}")))?;

            let tags = get_entity_tags(conn, "task_tags", "task_id", id)?;
            Ok(row_to_task(row, tags))
        })
    }

    pub fn list(&self, status_filter: Option<&str>) -> AppResult<Vec<Task>> {
        self.db.with_conn(|conn| {
            let mut tasks = Vec::new();
            let sql = match status_filter {
                Some(_) => "SELECT id, title, description, status, priority, due_at, created_at, completed_at
                            FROM tasks WHERE status = ?1 ORDER BY created_at DESC",
                None => "SELECT id, title, description, status, priority, due_at, created_at, completed_at
                          FROM tasks ORDER BY created_at DESC",
            };
            let mut stmt = conn.prepare(sql)?;
            let rows = match status_filter {
                Some(s) => stmt.query_map(params![s], map_task_row)?,
                None => stmt.query_map([], map_task_row)?,
            };
            for row in rows {
                let (id, title, description, status, priority, due_at, created_at, completed_at) = row?;
                let tags = get_entity_tags(conn, "task_tags", "task_id", &id)?;
                tasks.push(Task {
                    id,
                    title,
                    description,
                    status: TaskStatus::from_str(&status),
                    priority: TaskPriority::from_str(&priority),
                    due_at: parse_opt_datetime(&due_at),
                    created_at: parse_datetime(&created_at)?,
                    completed_at: parse_opt_datetime(&completed_at),
                    tags,
                });
            }
            Ok(tasks)
        })
    }

    pub fn list_today(&self) -> AppResult<Vec<Task>> {
        let all = self.list(None)?;
        let today = Utc::now().date_naive();
        Ok(all
            .into_iter()
            .filter(|t| {
                t.status != TaskStatus::Done
                    && t.status != TaskStatus::Cancelled
                    && t.due_at
                        .map(|d| d.date_naive() <= today)
                        .unwrap_or(true)
            })
            .collect())
    }

    pub fn update(&self, id: &str, input: UpdateTaskInput) -> AppResult<Task> {
        let existing = self.get(id)?;
        let title = input.title.unwrap_or(existing.title);
        let description = input.description.or(existing.description);
        let prev_status = existing.status.clone();
        let status = input.status.unwrap_or(existing.status);
        let priority = input.priority.unwrap_or(existing.priority);
        let due_at = match input.due_at {
            Some(v) => v,
            None => existing.due_at,
        };
        let tags = input.tags.unwrap_or(existing.tags);
        let completed_at = if status == TaskStatus::Done && prev_status != TaskStatus::Done {
            Some(Utc::now())
        } else if status != TaskStatus::Done {
            None
        } else {
            existing.completed_at
        };

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "UPDATE tasks SET title=?1, description=?2, status=?3, priority=?4,
                 due_at=?5, completed_at=?6 WHERE id=?7",
                params![
                    title,
                    description,
                    status.as_str(),
                    priority.as_str(),
                    due_at.map(|d| d.to_rfc3339()),
                    completed_at.map(|d| d.to_rfc3339()),
                    id,
                ],
            )?;
            set_entity_tags(&tx, "task_tags", "task_id", id, &tags)?;
            upsert_search_index(
                &tx,
                "task",
                id,
                &title,
                &description.clone().unwrap_or_default(),
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.get(id)
    }

    pub fn find_id_by_tag(&self, tag: &str) -> AppResult<Option<String>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT tt.task_id FROM task_tags tt
                 JOIN tags t ON t.id = tt.tag_id
                 WHERE t.name = ?1
                 LIMIT 1",
                params![tag],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)
        })
    }

    pub fn complete(&self, id: &str) -> AppResult<Task> {
        self.update(
            id,
            UpdateTaskInput {
                status: Some(TaskStatus::Done),
                ..Default::default()
            },
        )
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "task", id)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn count_today_progress(&self) -> AppResult<(i32, i32)> {
        let tasks = self.list_today()?;
        let total = tasks.len() as i32;
        let done = tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Done)
            .count() as i32;
        Ok((done, total))
    }
}

impl Default for UpdateTaskInput {
    fn default() -> Self {
        Self {
            title: None,
            description: None,
            status: None,
            priority: None,
            due_at: None,
            tags: None,
        }
    }
}

fn map_task_row(row: &rusqlite::Row) -> rusqlite::Result<(String, String, Option<String>, String, String, Option<String>, String, Option<String>)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
    ))
}

fn row_to_task(
    row: (String, String, Option<String>, String, String, Option<String>, String, Option<String>),
    tags: Vec<String>,
) -> Task {
    Task {
        id: row.0,
        title: row.1,
        description: row.2,
        status: TaskStatus::from_str(&row.3),
        priority: TaskPriority::from_str(&row.4),
        due_at: parse_opt_datetime(&row.5),
        created_at: parse_datetime(&row.6).unwrap_or_else(|_| Utc::now()),
        completed_at: parse_opt_datetime(&row.7),
        tags,
    }
}

fn parse_datetime(s: &str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| AppError::Other(e.to_string()))
}

fn parse_opt_datetime(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_ref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|d| d.with_timezone(&Utc))
}
