use crate::database::{remove_search_index, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::habit::{
    CreateHabitInput, Habit, HabitFrequency, HabitRecord, HabitWithStats,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

/// Days of unbroken practice to treat a habit as formed.
pub const HABIT_FORM_DAYS: i32 = 66;

pub struct HabitService<'a> {
    db: &'a Database,
}

impl<'a> HabitService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn create(&self, input: CreateHabitInput) -> AppResult<Habit> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let frequency = input.frequency.unwrap_or(HabitFrequency::Daily);
        let target = input.target.unwrap_or(1);

        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO habits (id, name, frequency, target, created_at, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![id, input.name, frequency.as_str(), target, now.to_rfc3339()],
            )?;
            upsert_search_index(&conn, "habit", &id, &input.name, "")?;
            Ok(())
        })?;

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> AppResult<Habit> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT id, name, frequency, target, created_at, enabled FROM habits WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Habit {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        frequency: HabitFrequency::from_str(&row.get::<_, String>(2)?),
                        target: row.get(3)?,
                        created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        enabled: row.get::<_, i32>(5)? == 1,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("habit {id}")))
        })
    }

    pub fn list_with_stats(&self) -> AppResult<Vec<HabitWithStats>> {
        let habits = self.list_enabled()?;
        let today = Utc::now().date_naive();
        let mut result = Vec::new();
        for habit in habits {
            let streak = self.calc_streak(&habit.id)?;
            let completion_rate = ((streak.min(HABIT_FORM_DAYS) as f64) / (HABIT_FORM_DAYS as f64))
                * 100.0;
            let checked_today = self.is_checked(&habit.id, today)?;
            result.push(HabitWithStats {
                habit,
                streak,
                target_days: HABIT_FORM_DAYS,
                formed: streak >= HABIT_FORM_DAYS,
                completion_rate,
                checked_today,
            });
        }
        Ok(result)
    }

    pub fn list_enabled(&self) -> AppResult<Vec<Habit>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, frequency, target, created_at, enabled FROM habits
                 WHERE enabled = 1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(Habit {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    frequency: HabitFrequency::from_str(&row.get::<_, String>(2)?),
                    target: row.get(3)?,
                    created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    enabled: row.get::<_, i32>(5)? == 1,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn check_in(&self, habit_id: &str, date: Option<NaiveDate>) -> AppResult<HabitRecord> {
        let date = date.unwrap_or_else(|| Utc::now().date_naive());
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO habit_records (habit_id, date, completed, value)
                 VALUES (?1, ?2, 1, 1)
                 ON CONFLICT(habit_id, date) DO UPDATE SET completed = 1, value = 1",
                params![habit_id, date.format("%Y-%m-%d").to_string()],
            )?;
            Ok(())
        })?;
        self.get_record(habit_id, date)
    }

    pub fn uncheck(&self, habit_id: &str, date: Option<NaiveDate>) -> AppResult<()> {
        let date = date.unwrap_or_else(|| Utc::now().date_naive());
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE habit_records SET completed = 0, value = 0
                 WHERE habit_id = ?1 AND date = ?2",
                params![habit_id, date.format("%Y-%m-%d").to_string()],
            )?;
            Ok(())
        })
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM habits WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "habit", id)?;
            tx.commit()?;
            Ok(())
        })
    }

    #[allow(dead_code)]
    pub fn today_progress(&self) -> AppResult<(i32, i32)> {
        let habits = self.list_with_stats()?;
        let total = habits.len() as i32;
        let done = habits.iter().filter(|h| h.checked_today).count() as i32;
        Ok((done, total))
    }

    fn get_record(&self, habit_id: &str, date: NaiveDate) -> AppResult<HabitRecord> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT habit_id, date, completed, value, note FROM habit_records
                 WHERE habit_id = ?1 AND date = ?2",
                params![habit_id, date.format("%Y-%m-%d").to_string()],
                |row| {
                    Ok(HabitRecord {
                        habit_id: row.get(0)?,
                        date: NaiveDate::parse_from_str(&row.get::<_, String>(1)?, "%Y-%m-%d")
                            .unwrap_or(date),
                        completed: row.get::<_, i32>(2)? == 1,
                        value: row.get(3)?,
                        note: row.get(4)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("habit record".into()))
        })
    }

    fn is_checked(&self, habit_id: &str, date: NaiveDate) -> AppResult<bool> {
        self.db.with_conn(|conn| {
            let completed: Option<i32> = conn
                .query_row(
                    "SELECT completed FROM habit_records WHERE habit_id = ?1 AND date = ?2",
                    params![habit_id, date.format("%Y-%m-%d").to_string()],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(completed.unwrap_or(0) == 1)
        })
    }

    /// Current streak toward 66-day habit formation.
    /// A single missed day is tolerated; **two consecutive** missed days breaks the streak.
    fn calc_streak(&self, habit_id: &str) -> AppResult<i32> {
        let today = Utc::now().date_naive();
        let mut date = today;
        let mut streak = 0;
        let mut miss_run = 0;
        for _ in 0..400 {
            if self.is_checked(habit_id, date)? {
                streak += 1;
                miss_run = 0;
                date -= Duration::days(1);
                continue;
            }
            // Today not checked yet: don't treat as a miss.
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
}
