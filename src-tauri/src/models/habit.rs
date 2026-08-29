use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HabitFrequency {
    Daily,
    Weekly,
    Custom,
}

impl HabitFrequency {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Custom => "custom",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "weekly" => Self::Weekly,
            "custom" => Self::Custom,
            _ => Self::Daily,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub frequency: HabitFrequency,
    pub target: i32,
    pub created_at: DateTime<Utc>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitRecord {
    pub habit_id: String,
    pub date: NaiveDate,
    pub completed: bool,
    pub value: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitWithStats {
    pub habit: Habit,
    pub streak: i32,
    pub completion_rate: f64,
    pub checked_today: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHabitInput {
    pub name: String,
    pub frequency: Option<HabitFrequency>,
    pub target: Option<i32>,
}
