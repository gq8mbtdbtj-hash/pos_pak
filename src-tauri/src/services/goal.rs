use crate::database::{remove_search_index, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::goal::{
    CreateCheckinInput, CreateGoalInput, CreateMilestoneInput, Goal, GoalCheckin, GoalDetail,
    GoalKind, GoalMilestone, GoalStatus, UpdateGoalInput,
};
use crate::models::task::{CreateTaskInput, TaskPriority};
use crate::services::task::TaskService;
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, Timelike, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

pub const CHECKIN_FORM_DAYS: i32 = 66;

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
            return Err(AppError::Other("标题不能为空".into()));
        }
        let kind = GoalKind::from_str(input.kind.as_deref().unwrap_or("plan"));
        let (start_value, target_value, unit) = match kind {
            GoalKind::Checkin => {
                let target = input
                    .target_value
                    .ok_or_else(|| AppError::Other("目标打卡必须填写目标值".into()))?;
                // Start is registered from the first check-in; optional at create.
                let start = input.start_value.filter(|s| (*s - target).abs() >= f64::EPSILON);
                (start, Some(target), input.unit)
            }
            GoalKind::Habit => (
                Some(0.0),
                Some(CHECKIN_FORM_DAYS as f64),
                Some(input.unit.unwrap_or_else(|| "天".into())),
            ),
            GoalKind::Plan => (None, None, None),
        };

        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let target = parse_opt_date(input.target_date.as_deref());

        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO goals
                 (id, title, note, target_date, kind, status, progress, start_value, target_value, unit, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'active', 0, ?6, ?7, ?8, ?9, ?9)",
                params![
                    id,
                    title,
                    input.note,
                    target.map(|d| d.format("%Y-%m-%d").to_string()),
                    kind.as_str(),
                    start_value,
                    target_value,
                    unit,
                    now.to_rfc3339(),
                ],
            )?;
            upsert_search_index(conn, "goal", &id, title, input.note.as_deref().unwrap_or(""))?;
            Ok(())
        })?;
        let _ = self.sync_plan_reminders();
        self.get(&id)
    }

    pub fn get(&self, id: &str) -> AppResult<Goal> {
        let mut goal = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT id, title, note, target_date, kind, status, progress, created_at, updated_at,
                        start_value, target_value, unit
                 FROM goals WHERE id = ?1",
                params![id],
                map_goal_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("goal {id}")))
        })?;
        self.enrich_goal(&mut goal)?;
        Ok(goal)
    }

    pub fn detail(&self, id: &str) -> AppResult<GoalDetail> {
        let goal = self.get(id)?;
        let milestones = if goal.kind == GoalKind::Plan {
            self.list_milestones(id)?
        } else {
            vec![]
        };
        let checkins = if goal.kind.uses_daily_checkins() {
            self.list_checkins(id)?
        } else {
            vec![]
        };
        let today = Utc::now().date_naive();
        let checked_today = checkins.iter().any(|c| c.date == today);
        Ok(GoalDetail {
            goal,
            milestones,
            checkins,
            checked_today,
        })
    }

    pub fn list(&self) -> AppResult<Vec<Goal>> {
        let mut goals = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, title, note, target_date, kind, status, progress, created_at, updated_at,
                        start_value, target_value, unit
                 FROM goals
                 ORDER BY
                   CASE kind WHEN 'habit' THEN 0 WHEN 'checkin' THEN 1 ELSE 2 END,
                   CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                   updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_goal_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;
        for g in &mut goals {
            self.enrich_goal(g)?;
        }
        Ok(goals)
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
        let start_value = input.start_value.or(existing.start_value);
        let target_value = input.target_value.or(existing.target_value);
        let unit = match input.unit {
            Some(u) => u,
            None => existing.unit,
        };
        let now = Utc::now();

        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE goals SET title=?1, note=?2, target_date=?3, status=?4, progress=?5,
                 start_value=?6, target_value=?7, unit=?8, updated_at=?9
                 WHERE id=?10",
                params![
                    title,
                    note,
                    target_date.map(|d| d.format("%Y-%m-%d").to_string()),
                    status.as_str(),
                    progress,
                    start_value,
                    target_value,
                    unit,
                    now.to_rfc3339(),
                    id,
                ],
            )?;
            upsert_search_index(conn, "goal", id, &title, note.as_deref().unwrap_or(""))?;
            Ok(())
        })?;
        let _ = self.sync_plan_reminders();
        self.get(id)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM goal_checkins WHERE goal_id = ?1", params![id])?;
            tx.execute("DELETE FROM goal_milestones WHERE goal_id = ?1", params![id])?;
            tx.execute("DELETE FROM goals WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "goal", id)?;
            tx.commit()?;
            Ok(())
        })?;
        let _ = self.sync_plan_reminders();
        Ok(())
    }

    pub fn list_milestones(&self, goal_id: &str) -> AppResult<Vec<GoalMilestone>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, goal_id, title, due_date, done, task_id, habit_id, sort_order, created_at
                 FROM goal_milestones WHERE goal_id = ?1
                 ORDER BY
                   CASE WHEN due_date IS NULL OR TRIM(due_date) = '' THEN 1 ELSE 0 END,
                   due_date ASC,
                   sort_order ASC",
            )?;
            let rows = stmt.query_map(params![goal_id], map_milestone_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn add_milestone(&self, goal_id: &str, input: CreateMilestoneInput) -> AppResult<GoalDetail> {
        let goal = self.get(goal_id)?;
        if goal.kind != GoalKind::Plan {
            return Err(AppError::Other("习惯与目标打卡请使用每日打卡，而不是里程碑".into()));
        }
        let title = input.title.trim();
        if title.is_empty() {
            return Err(AppError::Other("里程碑标题不能为空".into()));
        }
        let due = parse_opt_date(input.due_date.as_deref())
            .ok_or_else(|| AppError::Other("请填写里程碑截止日".into()))?;
        let id = Uuid::new_v4().to_string();
        let sort_order: i32 = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM goal_milestones WHERE goal_id = ?1",
                params![goal_id],
                |row| row.get(0),
            )
            .map_err(AppError::from)
        })?;
        let now = Utc::now();
        let due_s = due.format("%Y-%m-%d").to_string();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO goal_milestones
                 (id, goal_id, title, due_date, done, task_id, habit_id, sort_order, created_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    goal_id,
                    title,
                    due_s,
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
        self.recalc_plan_progress(goal_id)?;
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
        self.recalc_plan_progress(&goal_id)?;
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
        self.recalc_plan_progress(&goal_id)?;
        self.detail(&goal_id)
    }

    pub fn list_checkins(&self, goal_id: &str) -> AppResult<Vec<GoalCheckin>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, goal_id, date, note,
                        COALESCE(value, CAST(progress AS REAL)), created_at
                 FROM goal_checkins WHERE goal_id = ?1
                 ORDER BY created_at DESC, date DESC",
            )?;
            let rows = stmt.query_map(params![goal_id], map_checkin_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn add_checkin(&self, goal_id: &str, input: CreateCheckinInput) -> AppResult<GoalDetail> {
        let goal = self.get(goal_id)?;
        if !goal.kind.uses_daily_checkins() {
            return Err(AppError::Other("计划请记录里程碑，而不是每日打卡".into()));
        }
        let at = parse_checkin_at(input.at.as_deref());
        let date = parse_opt_date(input.date.as_deref()).unwrap_or_else(|| at.date_naive());
        let note = input.note.unwrap_or_default().trim().to_string();
        let value = if goal.kind == GoalKind::Habit {
            // Presence check-in; measured value optional / unused for progress.
            input
                .value
                .or_else(|| input.progress.map(|p| p as f64))
                .unwrap_or(1.0)
        } else {
            input
                .value
                .or_else(|| input.progress.map(|p| p as f64))
                .ok_or_else(|| AppError::Other("请填写实测值".into()))?
        };
        let id = Uuid::new_v4().to_string();
        let date_s = date.format("%Y-%m-%d").to_string();
        let at_s = at.to_rfc3339();

        self.db.with_conn(|conn| {
            if goal.kind == GoalKind::Habit {
                // Habit: one presence row per calendar day (upsert).
                let existing: Option<String> = conn
                    .query_row(
                        "SELECT id FROM goal_checkins WHERE goal_id = ?1 AND date = ?2 LIMIT 1",
                        params![goal_id, date_s],
                        |row| row.get(0),
                    )
                    .optional()?;
                if let Some(eid) = existing {
                    conn.execute(
                        "UPDATE goal_checkins
                         SET note = ?1, progress = 0, value = ?2, created_at = ?3
                         WHERE id = ?4",
                        params![note, value, at_s, eid],
                    )?;
                } else {
                    conn.execute(
                        "INSERT INTO goal_checkins (id, goal_id, date, note, progress, value, created_at)
                         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
                        params![id, goal_id, date_s, note, value, at_s],
                    )?;
                }
            } else {
                // Checkin: allow multiple rows the same day; time to the hour.
                conn.execute(
                    "INSERT INTO goal_checkins (id, goal_id, date, note, progress, value, created_at)
                     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
                    params![id, goal_id, date_s, note, value, at_s],
                )?;
            }
            Ok(())
        })?;
        if goal.kind == GoalKind::Checkin {
            self.sync_start_from_first_checkin(goal_id)?;
        }
        self.recalc_checkin_progress(goal_id)?;
        self.detail(goal_id)
    }

    pub fn delete_checkin(&self, checkin_id: &str) -> AppResult<GoalDetail> {
        let goal_id: String = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT goal_id FROM goal_checkins WHERE id = ?1",
                params![checkin_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("checkin {checkin_id}")))
        })?;
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM goal_checkins WHERE id = ?1", params![checkin_id])?;
            Ok(())
        })?;
        let kind = self.get(&goal_id)?.kind;
        if kind == GoalKind::Checkin {
            self.sync_start_from_first_checkin(&goal_id)?;
        }
        self.recalc_checkin_progress(&goal_id)?;
        self.detail(&goal_id)
    }

    /// Ensure plan goals with target_date have d-3 / d-1 / d0 reminder tasks.
    pub fn sync_plan_reminders(&self) -> AppResult<()> {
        let tasks = TaskService::new(self.db);
        let plans: Vec<(String, String, NaiveDate)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, title, target_date FROM goals
                 WHERE kind IN ('plan', 'normal')
                   AND status = 'active'
                   AND target_date IS NOT NULL
                   AND TRIM(target_date) != ''",
            )?;
            let rows = stmt.query_map([], |row| {
                let date_s: String = row.get(2)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    NaiveDate::parse_from_str(&date_s, "%Y-%m-%d")
                        .unwrap_or_else(|_| Utc::now().date_naive()),
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;

        let active_keys: std::collections::HashSet<String> = plans
            .iter()
            .flat_map(|(id, _, _)| {
                ["d3", "d1", "d0"]
                    .iter()
                    .map(|slot| format!("plan-remind:{id}:{slot}"))
                    .collect::<Vec<_>>()
            })
            .collect();

        let orphan_tags: Vec<(String, String)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT tt.task_id, t.name
                 FROM task_tags tt
                 JOIN tags t ON t.id = tt.tag_id
                 WHERE t.name LIKE 'plan-remind:%'",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;
        for (task_id, tag) in orphan_tags {
            if !active_keys.contains(&tag) {
                let _ = tasks.delete(&task_id);
            }
        }

        for (goal_id, title, due) in plans {
            for (slot, offset_days) in [("d3", 3), ("d1", 1), ("d0", 0)] {
                let tag = format!("plan-remind:{goal_id}:{slot}");
                let remind_day = due - Duration::days(offset_days);
                let due_at = local_noon(remind_day);
                let slot_label = match slot {
                    "d3" => "提前 3 天",
                    "d1" => "提前 1 天",
                    _ => "截止日",
                };
                let task_title = format!("计划提醒 · {title} · {slot_label}");
                let tags = vec![
                    tag.clone(),
                    "计划提醒".into(),
                    format!("plan-due:{due}"),
                ];
                if let Some(existing_id) = tasks.find_id_by_tag(&tag)? {
                    let existing = tasks.get(&existing_id)?;
                    if existing.status.as_str() == "done" || existing.status.as_str() == "cancelled"
                    {
                        continue;
                    }
                    let _ = tasks.update(
                        &existing_id,
                        crate::models::task::UpdateTaskInput {
                            title: Some(task_title),
                            description: Some(format!("计划「{title}」截止日 {due}")),
                            due_at: Some(Some(due_at)),
                            tags: Some(tags),
                            ..Default::default()
                        },
                    );
                } else {
                    let _ = tasks.create(CreateTaskInput {
                        title: task_title,
                        description: Some(format!("计划「{title}」截止日 {due}")),
                        priority: Some(if slot == "d0" {
                            TaskPriority::High
                        } else if slot == "d1" {
                            TaskPriority::Medium
                        } else {
                            TaskPriority::Low
                        }),
                        due_at: Some(due_at),
                        tags: Some(tags),
                    });
                }
            }
        }
        Ok(())
    }

    /// Active habit + check-in goals progress for dashboard.
    pub fn today_checkin_progress(&self) -> AppResult<(i32, i32)> {
        let goals = self.list()?;
        let active: Vec<_> = goals
            .into_iter()
            .filter(|g| g.kind.uses_daily_checkins() && g.status == GoalStatus::Active)
            .collect();
        let total = active.len() as i32;
        let today = Utc::now().date_naive();
        let mut done = 0i32;
        for g in &active {
            let checked = self.db.with_conn(|conn| {
                let n: i32 = conn.query_row(
                    "SELECT COUNT(*) FROM goal_checkins WHERE goal_id = ?1 AND date = ?2",
                    params![g.id, today.format("%Y-%m-%d").to_string()],
                    |row| row.get(0),
                )?;
                Ok::<_, AppError>(n > 0)
            })?;
            if checked {
                done += 1;
            }
        }
        Ok((done, total))
    }

    fn enrich_goal(&self, goal: &mut Goal) -> AppResult<()> {
        match goal.kind {
            GoalKind::Plan => {
                goal.current_value = None;
                goal.gap = None;
                goal.streak = None;
                goal.formed = None;
                Ok(())
            }
            GoalKind::Habit => {
                let streak = self.calc_streak(&goal.id)?;
                goal.streak = Some(streak);
                goal.current_value = Some(streak as f64);
                goal.gap = Some((CHECKIN_FORM_DAYS - streak).max(0) as f64);
                let progress = (((streak.min(CHECKIN_FORM_DAYS) as f64)
                    / (CHECKIN_FORM_DAYS as f64))
                    * 100.0)
                    .round() as i32;
                goal.progress = progress;
                goal.formed = Some(streak >= CHECKIN_FORM_DAYS);
                if goal.start_value.is_none() {
                    goal.start_value = Some(0.0);
                }
                if goal.target_value.is_none() {
                    goal.target_value = Some(CHECKIN_FORM_DAYS as f64);
                }
                Ok(())
            }
            GoalKind::Checkin => {
                let target = match goal.target_value {
                    Some(t) if t.is_finite() => t,
                    _ => {
                        goal.current_value = None;
                        goal.gap = None;
                        goal.streak = None;
                        goal.formed = Some(false);
                        goal.progress = 0;
                        return Ok(());
                    }
                };
                let first = self.first_checkin_value(&goal.id)?;
                let start = match first {
                    Some(v) => {
                        goal.start_value = Some(v);
                        v
                    }
                    None => {
                        goal.current_value = None;
                        goal.gap = None;
                        goal.streak = None;
                        goal.formed = Some(false);
                        goal.progress = 0;
                        return Ok(());
                    }
                };
                let current = self
                    .latest_checkin_value(&goal.id)?
                    .unwrap_or(start);
                goal.current_value = Some(current);
                let toward = target - start;
                let remaining = if toward.abs() < f64::EPSILON {
                    target - current
                } else if toward > 0.0 {
                    target - current
                } else {
                    current - target
                };
                goal.gap = Some(remaining);
                goal.progress = value_progress(start, target, current);
                goal.streak = None;
                goal.formed = Some(goal.progress >= 100);
                Ok(())
            }
        }
    }

    fn latest_checkin_value(&self, goal_id: &str) -> AppResult<Option<f64>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT value FROM goal_checkins WHERE goal_id = ?1 AND value IS NOT NULL
                 ORDER BY created_at DESC LIMIT 1",
                params![goal_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)
        })
    }

    fn first_checkin_value(&self, goal_id: &str) -> AppResult<Option<f64>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT value FROM goal_checkins WHERE goal_id = ?1 AND value IS NOT NULL
                 ORDER BY created_at ASC LIMIT 1",
                params![goal_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)
        })
    }

    /// Persist start_value from the earliest check-in measurement.
    fn sync_start_from_first_checkin(&self, goal_id: &str) -> AppResult<()> {
        let first = self.first_checkin_value(goal_id)?;
        let now = Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            match first {
                Some(v) => {
                    conn.execute(
                        "UPDATE goals SET start_value = ?1, updated_at = ?2 WHERE id = ?3",
                        params![v, now, goal_id],
                    )?;
                }
                None => {
                    conn.execute(
                        "UPDATE goals SET start_value = NULL, updated_at = ?1 WHERE id = ?2",
                        params![now, goal_id],
                    )?;
                }
            }
            Ok(())
        })
    }

    fn recalc_plan_progress(&self, goal_id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let (total, done): (i32, i32) = conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0)
                 FROM goal_milestones WHERE goal_id = ?1",
                params![goal_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let progress = if total == 0 {
                0
            } else {
                ((done as f64 / total as f64) * 100.0).round() as i32
            };
            let now = Utc::now();
            let status = if total > 0 && done == total {
                "done"
            } else {
                "active"
            };
            conn.execute(
                "UPDATE goals SET progress = ?1, status = CASE WHEN status = 'paused' THEN status ELSE ?2 END, updated_at = ?3 WHERE id = ?4",
                params![progress, status, now.to_rfc3339(), goal_id],
            )?;
            Ok(())
        })
    }

    fn recalc_checkin_progress(&self, goal_id: &str) -> AppResult<()> {
        let mut goal = self.get(goal_id)?;
        self.enrich_goal(&mut goal)?;
        let now = Utc::now();
        let status = match goal.kind {
            GoalKind::Habit if goal.formed == Some(true) => "done",
            GoalKind::Checkin if goal.progress >= 100 => "done",
            _ => goal.status.as_str(),
        };
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE goals SET progress = ?1, status = CASE WHEN status = 'paused' THEN status ELSE ?2 END, updated_at = ?3 WHERE id = ?4",
                params![goal.progress, status, now.to_rfc3339(), goal_id],
            )?;
            Ok(())
        })
    }

    fn calc_streak(&self, goal_id: &str) -> AppResult<i32> {
        let today = Utc::now().date_naive();
        let mut date = today;
        let mut streak = 0;
        let mut miss_run = 0;
        for _ in 0..400 {
            let checked = self.has_checkin(goal_id, date)?;
            if checked {
                streak += 1;
                miss_run = 0;
                date -= Duration::days(1);
                continue;
            }
            if streak == 0 && date == today {
                date -= Duration::days(1);
                continue;
            }
            miss_run += 1;
            if miss_run >= 2 {
                break;
            }
            date -= Duration::days(1);
        }
        Ok(streak)
    }

    fn has_checkin(&self, goal_id: &str, date: NaiveDate) -> AppResult<bool> {
        self.db.with_conn(|conn| {
            let n: i32 = conn.query_row(
                "SELECT COUNT(*) FROM goal_checkins WHERE goal_id = ?1 AND date = ?2",
                params![goal_id, date.format("%Y-%m-%d").to_string()],
                |row| row.get(0),
            )?;
            Ok(n > 0)
        })
    }
}

pub fn value_progress(start: f64, target: f64, current: f64) -> i32 {
    let denom = target - start;
    if denom.abs() < f64::EPSILON {
        return 0;
    }
    let pct = ((current - start) / denom) * 100.0;
    pct.round().clamp(0.0, 100.0) as i32
}

fn local_noon(day: NaiveDate) -> DateTime<Utc> {
    let naive = day.and_time(NaiveTime::from_hms_opt(12, 0, 0).unwrap());
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|| DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
}

fn parse_opt_date(s: Option<&str>) -> Option<NaiveDate> {
    s.and_then(|raw| NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok())
}

/// Parse check-in timestamp and truncate to the hour (minutes/seconds discarded).
fn parse_checkin_at(s: Option<&str>) -> DateTime<Utc> {
    match s.map(str::trim).filter(|x| !x.is_empty()) {
        Some(raw) => {
            if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
                return truncate_local_hour(dt.with_timezone(&chrono::Local));
            }
            for fmt in ["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"] {
                if let Ok(naive) = NaiveDateTime::parse_from_str(raw, fmt) {
                    let truncated = naive
                        .date()
                        .and_hms_opt(naive.hour(), 0, 0)
                        .unwrap_or(naive);
                    return chrono::Local
                        .from_local_datetime(&truncated)
                        .single()
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or_else(|| Utc.from_utc_datetime(&truncated));
                }
            }
            truncate_local_hour(chrono::Local::now())
        }
        None => truncate_local_hour(chrono::Local::now()),
    }
}

fn truncate_local_hour(local: chrono::DateTime<chrono::Local>) -> DateTime<Utc> {
    let naive = local
        .date_naive()
        .and_hms_opt(local.hour(), 0, 0)
        .unwrap_or(local.naive_local());
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|| Utc::now())
}

fn map_goal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    let target: Option<String> = row.get(3)?;
    let kind: String = row.get(4)?;
    let created: String = row.get(7)?;
    let updated: String = row.get(8)?;
    Ok(Goal {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        target_date: target.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
        kind: GoalKind::from_str(&kind),
        status: GoalStatus::from_str(&row.get::<_, String>(5)?),
        progress: row.get(6)?,
        created_at: DateTime::parse_from_rfc3339(&created)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        updated_at: DateTime::parse_from_rfc3339(&updated)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        start_value: row.get(9).ok().flatten(),
        target_value: row.get(10).ok().flatten(),
        unit: row.get(11).ok().flatten(),
        current_value: None,
        gap: None,
        streak: None,
        formed: None,
    })
}

fn map_milestone_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalMilestone> {
    let due: Option<String> = row.get(3)?;
    let created: Option<String> = row.get(8).ok();
    Ok(GoalMilestone {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        title: row.get(2)?,
        due_date: due.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
        done: row.get::<_, i32>(4)? == 1,
        task_id: row.get(5)?,
        habit_id: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: created.and_then(|s| {
            DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&Utc))
                .ok()
        }),
    })
}

fn map_checkin_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalCheckin> {
    let date: String = row.get(2)?;
    let created: String = row.get(5)?;
    let value: Option<f64> = row.get(4)?;
    Ok(GoalCheckin {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").unwrap_or_else(|_| Utc::now().date_naive()),
        note: row.get(3)?,
        value: value.unwrap_or(f64::NAN),
        created_at: DateTime::parse_from_rfc3339(&created)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
    })
}

/// One-shot: habits → checkin goals; normal → plan; backfill checkin values.
pub fn migrate_schema_and_habits(conn: &Connection) -> AppResult<()> {
    let _ = conn.execute(
        "ALTER TABLE goals ADD COLUMN start_value REAL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE goals ADD COLUMN target_value REAL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE goals ADD COLUMN unit TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE goal_checkins ADD COLUMN value REAL",
        [],
    );
    migrate_goal_checkins_allow_multi_per_day(conn)?;
    let _ = conn.execute(
        "UPDATE goal_checkins SET value = CAST(progress AS REAL)
         WHERE value IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE goals SET kind = 'plan' WHERE kind = 'normal' OR kind IS NULL OR kind = ''",
        [],
    );
    // Reclassify 66-day presence goals that were stored as checkin.
    let _ = conn.execute(
        "UPDATE goals SET kind = 'habit'
         WHERE kind = 'checkin'
           AND COALESCE(start_value, 0) = 0
           AND COALESCE(target_value, 0) = 66
           AND (unit IS NULL OR unit = '' OR unit = '天')",
        [],
    );
    // Already-migrated habit rows keep fixed ids.
    let _ = conn.execute(
        "UPDATE goals SET kind = 'habit' WHERE id LIKE 'migrated-habit-%'",
        [],
    );

    // Migrate enabled habits into habit goals (idempotent via fixed ids).
    let habits: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at FROM habits WHERE enabled = 1",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for (habit_id, name, created_at) in habits {
        let goal_id = format!("migrated-habit-{habit_id}");
        let exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM goals WHERE id = ?1",
            params![goal_id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO goals
                 (id, title, note, target_date, kind, status, progress, start_value, target_value, unit, created_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, 'habit', 'active', 0, 0, 66, '天', ?4, ?5)",
                params![
                    goal_id,
                    name,
                    format!("由习惯迁移 · {habit_id}"),
                    created_at,
                    now,
                ],
            )?;
            upsert_search_index(conn, "goal", &goal_id, &name, "习惯迁移")?;
        } else {
            let _ = conn.execute(
                "UPDATE goals SET kind = 'habit', start_value = 0, target_value = 66, unit = COALESCE(unit, '天')
                 WHERE id = ?1",
                params![goal_id],
            );
        }

        let records: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT date FROM habit_records
                 WHERE habit_id = ?1 AND completed = 1",
            )?;
            let rows = stmt.query_map(params![habit_id], |row| row.get(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for date in records {
            let exists: i32 = conn.query_row(
                "SELECT COUNT(*) FROM goal_checkins WHERE goal_id = ?1 AND date = ?2",
                params![goal_id, date],
                |row| row.get(0),
            )?;
            if exists > 0 {
                continue;
            }
            let cid = Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            let _ = conn.execute(
                "INSERT INTO goal_checkins (id, goal_id, date, note, progress, value, created_at)
                 VALUES (?1, ?2, ?3, '', 1, 1, ?4)",
                params![cid, goal_id, date, now],
            );
        }

        conn.execute(
            "UPDATE habits SET enabled = 0 WHERE id = ?1",
            params![habit_id],
        )?;
    }

    Ok(())
}

/// Drop UNIQUE(goal_id, date) so check-in goals can log multiple times per day.
fn migrate_goal_checkins_allow_multi_per_day(conn: &Connection) -> AppResult<()> {
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'goal_checkins'",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_default();
    if sql.is_empty() || !sql.to_ascii_uppercase().contains("UNIQUE") {
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal_date ON goal_checkins(goal_id, date)",
            [],
        );
        return Ok(());
    }
    conn.execute_batch(
        "
        CREATE TABLE goal_checkins_new (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            progress INTEGER NOT NULL DEFAULT 0,
            value REAL,
            created_at TEXT NOT NULL
        );
        INSERT INTO goal_checkins_new (id, goal_id, date, note, progress, value, created_at)
        SELECT id, goal_id, date, note, progress, value, created_at FROM goal_checkins;
        DROP TABLE goal_checkins;
        ALTER TABLE goal_checkins_new RENAME TO goal_checkins;
        CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal_date ON goal_checkins(goal_id, date);
        ",
    )?;
    Ok(())
}
