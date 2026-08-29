use crate::database::{remove_search_index, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::goal::{
    CreateGoalInput, CreateMilestoneInput, Goal, GoalDetail, GoalMilestone, GoalStatus,
    UpdateGoalInput,
};
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

pub struct GoalService<'a> {
    db: &'a Database,
}

impl<'a> GoalService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn create(&self, input: CreateGoalInput) -> AppResult<Goal> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err(AppError::Other("目标标题不能为空".into()));
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let target = parse_opt_date(input.target_date.as_deref());

        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO goals (id, title, note, target_date, status, progress, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'active', 0, ?5, ?5)",
                params![
                    id,
                    title,
                    input.note,
                    target.map(|d| d.format("%Y-%m-%d").to_string()),
                    now.to_rfc3339(),
                ],
            )?;
            upsert_search_index(conn, "goal", &id, title, input.note.as_deref().unwrap_or(""))?;
            Ok(())
        })?;
        self.get(&id)
    }

    pub fn get(&self, id: &str) -> AppResult<Goal> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT id, title, note, target_date, status, progress, created_at, updated_at
                 FROM goals WHERE id = ?1",
                params![id],
                map_goal_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("goal {id}")))
        })
    }

    pub fn detail(&self, id: &str) -> AppResult<GoalDetail> {
        let goal = self.get(id)?;
        let milestones = self.list_milestones(id)?;
        Ok(GoalDetail { goal, milestones })
    }

    pub fn list(&self) -> AppResult<Vec<Goal>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, title, note, target_date, status, progress, created_at, updated_at
                 FROM goals
                 ORDER BY
                   CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                   updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_goal_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn update(&self, id: &str, input: UpdateGoalInput) -> AppResult<Goal> {
        let existing = self.get(id)?;
        let title = input
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or(existing.title);
        let note = match input.note {
            Some(n) => n,
            None => existing.note,
        };
        let target_date = match input.target_date {
            Some(Some(s)) => parse_opt_date(Some(&s)),
            Some(None) => None,
            None => existing.target_date,
        };
        let status = input
            .status
            .as_deref()
            .map(GoalStatus::from_str)
            .unwrap_or(existing.status);
        let progress = input
            .progress
            .unwrap_or(existing.progress)
            .clamp(0, 100);
        let now = Utc::now();

        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE goals SET title=?1, note=?2, target_date=?3, status=?4, progress=?5, updated_at=?6
                 WHERE id=?7",
                params![
                    title,
                    note,
                    target_date.map(|d| d.format("%Y-%m-%d").to_string()),
                    status.as_str(),
                    progress,
                    now.to_rfc3339(),
                    id,
                ],
            )?;
            upsert_search_index(
                conn,
                "goal",
                id,
                &title,
                note.as_deref().unwrap_or(""),
            )?;
            Ok(())
        })?;
        self.get(id)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM goal_milestones WHERE goal_id = ?1", params![id])?;
            tx.execute("DELETE FROM goals WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "goal", id)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn list_milestones(&self, goal_id: &str) -> AppResult<Vec<GoalMilestone>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, goal_id, title, due_date, done, task_id, habit_id, sort_order
                 FROM goal_milestones WHERE goal_id = ?1
                 ORDER BY sort_order ASC, created_at ASC",
            )?;
            let rows = stmt.query_map(params![goal_id], map_milestone_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn add_milestone(&self, goal_id: &str, input: CreateMilestoneInput) -> AppResult<GoalDetail> {
        let _ = self.get(goal_id)?;
        let title = input.title.trim();
        if title.is_empty() {
            return Err(AppError::Other("里程碑标题不能为空".into()));
        }
        let id = Uuid::new_v4().to_string();
        let due = parse_opt_date(input.due_date.as_deref());
        let sort_order: i32 = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM goal_milestones WHERE goal_id = ?1",
                params![goal_id],
                |row| row.get(0),
            )
            .map_err(AppError::from)
        })?;
        let now = Utc::now();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO goal_milestones
                 (id, goal_id, title, due_date, done, task_id, habit_id, sort_order, created_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    goal_id,
                    title,
                    due.map(|d| d.format("%Y-%m-%d").to_string()),
                    input.task_id,
                    input.habit_id,
                    sort_order,
                    now.to_rfc3339(),
                ],
            )?;
            conn.execute(
                "UPDATE goals SET updated_at = ?1 WHERE id = ?2",
                params![now.to_rfc3339(), goal_id],
            )?;
            Ok(())
        })?;
        self.recalc_progress(goal_id)?;
        self.detail(goal_id)
    }

    pub fn set_milestone_done(&self, milestone_id: &str, done: bool) -> AppResult<GoalDetail> {
        let goal_id: String = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT goal_id FROM goal_milestones WHERE id = ?1",
                params![milestone_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("milestone {milestone_id}")))
        })?;
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE goal_milestones SET done = ?1 WHERE id = ?2",
                params![if done { 1 } else { 0 }, milestone_id],
            )?;
            Ok(())
        })?;
        self.recalc_progress(&goal_id)?;
        self.detail(&goal_id)
    }

    pub fn delete_milestone(&self, milestone_id: &str) -> AppResult<GoalDetail> {
        let goal_id: String = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT goal_id FROM goal_milestones WHERE id = ?1",
                params![milestone_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("milestone {milestone_id}")))
        })?;
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM goal_milestones WHERE id = ?1",
                params![milestone_id],
            )?;
            Ok(())
        })?;
        self.recalc_progress(&goal_id)?;
        self.detail(&goal_id)
    }

    fn recalc_progress(&self, goal_id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let (total, done): (i32, i32) = conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0)
                 FROM goal_milestones WHERE goal_id = ?1",
                params![goal_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let progress = if total == 0 {
                // keep manual progress if no milestones
                return Ok(());
            } else {
                ((done as f64 / total as f64) * 100.0).round() as i32
            };
            let now = Utc::now();
            conn.execute(
                "UPDATE goals SET progress = ?1, updated_at = ?2 WHERE id = ?3",
                params![progress, now.to_rfc3339(), goal_id],
            )?;
            Ok(())
        })
    }
}

fn parse_opt_date(s: Option<&str>) -> Option<NaiveDate> {
    s.and_then(|raw| NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok())
}

fn map_goal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    let target: Option<String> = row.get(3)?;
    let created: String = row.get(6)?;
    let updated: String = row.get(7)?;
    Ok(Goal {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        target_date: target.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
        status: GoalStatus::from_str(&row.get::<_, String>(4)?),
        progress: row.get(5)?,
        created_at: DateTime::parse_from_rfc3339(&created)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        updated_at: DateTime::parse_from_rfc3339(&updated)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
    })
}

fn map_milestone_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalMilestone> {
    let due: Option<String> = row.get(3)?;
    Ok(GoalMilestone {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        title: row.get(2)?,
        due_date: due.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
        done: row.get::<_, i32>(4)? == 1,
        task_id: row.get(5)?,
        habit_id: row.get(6)?,
        sort_order: row.get(7)?,
    })
}
