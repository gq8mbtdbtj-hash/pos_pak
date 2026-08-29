use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DebtStatus {
    Active,
    Paid,
    Paused,
}

impl DebtStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paid => "paid",
            Self::Paused => "paused",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "paid" => Self::Paid,
            "paused" => Self::Paused,
            _ => Self::Active,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Active,
    Completed,
    Cancelled,
}

impl PlanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "completed" => Self::Completed,
            "cancelled" => Self::Cancelled,
            _ => Self::Active,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallmentStatus {
    Pending,
    Paid,
    Skipped,
}

impl InstallmentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Paid => "paid",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "paid" => Self::Paid,
            "skipped" => Self::Skipped,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepaymentMode {
    /// 先息后本：前期只还利息，到期一次还清本金
    InterestBalloon,
    /// 等额本息：每月同时偿还利息与本金
    EqualPayment,
}

impl RepaymentMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InterestBalloon => "interest_balloon",
            Self::EqualPayment => "equal_payment",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "interest_balloon" | "interest_only" | "balloon" => Self::InterestBalloon,
            _ => Self::EqualPayment,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::InterestBalloon => "先息后本",
            Self::EqualPayment => "等额本息",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Debt {
    pub id: String,
    pub name: String,
    pub creditor: Option<String>,
    pub principal: f64,
    pub remaining: f64,
    pub annual_rate: f64,
    pub start_date: Option<NaiveDate>,
    pub due_date: Option<NaiveDate>,
    pub status: DebtStatus,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDebtInput {
    pub name: String,
    pub creditor: Option<String>,
    pub principal: f64,
    pub remaining: Option<f64>,
    pub annual_rate: Option<f64>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDebtInput {
    pub name: Option<String>,
    pub creditor: Option<String>,
    pub annual_rate: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtPayment {
    pub id: String,
    pub debt_id: String,
    pub amount: f64,
    pub principal_amount: f64,
    pub interest_amount: f64,
    pub paid_at: DateTime<Utc>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub transaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDebtPaymentInput {
    pub amount: Option<f64>,
    pub principal_amount: Option<f64>,
    pub interest_amount: Option<f64>,
    pub paid_at: Option<String>,
    pub note: Option<String>,
    /// 用本期利息 / 还款前剩余本金 反推年利率并写入外债
    pub calibrate_rate: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrateRateInput {
    pub monthly_interest: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrateRateResult {
    pub annual_rate: f64,
    pub monthly_rate: f64,
    pub remaining: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtMetrics {
    pub paid_principal: f64,
    pub paid_interest: f64,
    pub remaining_principal: f64,
    pub remaining_interest_planned: f64,
    pub remaining_total_planned: f64,
    pub months_to_payoff: Option<i32>,
    pub payoff_date: Option<NaiveDate>,
    pub progress_pct: f64,
    pub next_due_amount: Option<f64>,
    pub next_due_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepaymentPlan {
    pub id: String,
    pub debt_id: String,
    pub title: String,
    pub monthly_amount: f64,
    pub start_date: NaiveDate,
    pub status: PlanStatus,
    pub created_at: DateTime<Utc>,
    pub plan_mode: RepaymentMode,
    pub term_months: i32,
    pub installments: Vec<RepaymentInstallment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepaymentPlanInput {
    pub title: Option<String>,
    /// interest_balloon | equal_payment
    pub mode: Option<String>,
    pub term_months: i32,
    pub start_date: Option<String>,
    /// Legacy / optional override; ignored when mode-based schedule is used.
    pub monthly_amount: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepaymentInstallment {
    pub id: String,
    pub plan_id: String,
    pub sequence: i32,
    pub due_date: NaiveDate,
    pub amount: f64,
    pub principal_amount: f64,
    pub interest_amount: f64,
    pub status: InstallmentStatus,
    pub paid_at: Option<DateTime<Utc>>,
    pub payment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtOverview {
    pub total_principal: f64,
    pub total_remaining: f64,
    pub active_count: i32,
    pub monthly_obligation: f64,
    pub paid_principal: f64,
    pub paid_interest: f64,
    pub remaining_interest_planned: f64,
    pub remaining_total_planned: f64,
    pub months_to_payoff: Option<i32>,
    pub payoff_date: Option<NaiveDate>,
    pub upcoming: Vec<UpcomingInstallment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingInstallment {
    pub installment_id: String,
    pub debt_id: String,
    pub debt_name: String,
    pub due_date: NaiveDate,
    pub amount: f64,
    pub plan_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtDetail {
    pub debt: Debt,
    pub payments: Vec<DebtPayment>,
    pub plans: Vec<RepaymentPlan>,
    pub metrics: DebtMetrics,
}
