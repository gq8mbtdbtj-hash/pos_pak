use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Done,
    Paused,
}

impl GoalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Done => "done",
            Self::Paused => "paused",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "done" => Self::Done,
            "paused" => Self::Paused,
            _ => Self::Active,
        }
    }
}

/// Stored goal category.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalKind {
    /// Milestone checklist (formerly `normal`).
    Plan,
    /// 66-day habit formation (presence check-ins).
    Habit,
    /// Measured-value daily check-in toward start→target.
    Checkin,
}

impl GoalKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Habit => "habit",
            Self::Checkin => "checkin",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "checkin" => Self::Checkin,
            "habit" => Self::Habit,
            _ => Self::Plan,
        }
    }

    pub fn uses_daily_checkins(&self) -> bool {
        matches!(self, Self::Habit | Self::Checkin)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub kind: GoalKind,
    pub status: GoalStatus,
    pub progress: i32,
    pub start_value: Option<f64>,
    pub target_value: Option<f64>,
    pub unit: Option<String>,
    /// Latest measured value (checkin) or None.
    #[serde(default)]
    pub current_value: Option<f64>,
    /// `target_value - current_value` for checkin.
    #[serde(default)]
    pub gap: Option<f64>,
    #[serde(default)]
    pub streak: Option<i32>,
    #[serde(default)]
    pub formed: Option<bool>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalMilestone {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub due_date: Option<NaiveDate>,
    pub done: bool,
    pub task_id: Option<String>,
    pub habit_id: Option<String>,
    pub sort_order: i32,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCheckin {
    pub id: String,
    pub goal_id: String,
    pub date: NaiveDate,
    pub note: String,
    /// Measured value for the day.
    pub value: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDetail {
    pub goal: Goal,
    pub milestones: Vec<GoalMilestone>,
    pub checkins: Vec<GoalCheckin>,
    pub checked_today: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalInput {
    pub title: String,
    pub note: Option<String>,
    pub target_date: Option<String>,
    /// `plan` | `habit` | `checkin` (legacy `normal` → plan)
    pub kind: Option<String>,
    pub start_value: Option<f64>,
    pub target_value: Option<f64>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalInput {
    pub title: Option<String>,
    pub note: Option<Option<String>>,
    pub target_date: Option<Option<String>>,
    pub status: Option<String>,
    pub progress: Option<i32>,
    pub start_value: Option<f64>,
    pub target_value: Option<f64>,
    pub unit: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMilestoneInput {
    pub title: String,
    pub due_date: Option<String>,
    pub task_id: Option<String>,
    pub habit_id: Option<String>,
    pub progress: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckinInput {
    pub note: Option<String>,
    /// Measured value (required for checkin).
    pub value: Option<f64>,
    /// Legacy alias accepted by older clients.
    pub progress: Option<i32>,
    /// YYYY-MM-DD; defaults to today.
    pub date: Option<String>,
}
