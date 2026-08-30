use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionType {
    Expense,
    Income,
    Transfer,
}

impl TransactionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Expense => "expense",
            Self::Income => "income",
            Self::Transfer => "transfer",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "income" => Self::Income,
            "transfer" => Self::Transfer,
            _ => Self::Expense,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub amount: f64,
    pub transaction_type: TransactionType,
    pub category: String,
    pub account: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransactionInput {
    pub amount: f64,
    pub transaction_type: Option<TransactionType>,
    pub category: Option<String>,
    pub account: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub occurred_at: Option<DateTime<Utc>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoneyFlow {
    pub income: f64,
    pub expense: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxHighlight {
    pub id: String,
    pub amount: f64,
    pub category: String,
    pub label: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartBucket {
    pub label: String,
    pub income: f64,
    pub expense: f64,
    pub top_income: Vec<TxHighlight>,
    pub top_expense: Vec<TxHighlight>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSummary {
    pub today: MoneyFlow,
    pub week: MoneyFlow,
    pub month: MoneyFlow,
    /// Balance for the current pay period only (not tied to day/week/month filter).
    pub pay_period: MoneyFlow,
    /// e.g. "3/1 – 3/31"
    pub pay_period_label: String,
    /// Opening → effective → after-debts glance (Spec §1).
    #[serde(default)]
    pub pay_period_glance: PayPeriodGlance,
    pub by_category: Vec<CategorySum>,
    pub category_day: Vec<CategorySum>,
    pub category_week: Vec<CategorySum>,
    pub category_month: Vec<CategorySum>,
    pub chart_day: Vec<ChartBucket>,
    pub chart_week: Vec<ChartBucket>,
    pub chart_month: Vec<ChartBucket>,
    /// 本月「外债还款」类支出合计
    pub debt_repayment_month: f64,
    pub debt_remaining: f64,
    pub debt_monthly_obligation: f64,
    #[serde(default)]
    pub pending_snapshot: Option<PayPeriodPending>,
    #[serde(default)]
    pub snapshots: Vec<PayPeriodSnapshot>,
}

/// Derived pay-period cash position (Spec §1).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayPeriodGlance {
    /// Confirmed prior-period surplus; none if not archived yet.
    pub opening: Option<f64>,
    pub opening_period_label: Option<String>,
    /// True when prior period has no confirmed snapshot.
    pub opening_missing: bool,
    /// Period income − expense (same as pay_period net).
    pub period_flow: f64,
    /// opening + period_flow, or period_flow alone when opening missing.
    pub effective: f64,
    /// Unpaid installments due inside the current pay window.
    pub due_this_period: f64,
    /// effective − due_this_period.
    pub after_debts: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayPeriodPending {
    pub period_start: String,
    pub period_end: String,
    pub period_label: String,
    pub income: f64,
    pub expense: f64,
    pub net: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayPeriodSnapshot {
    pub id: String,
    pub period_start: String,
    pub period_end: String,
    pub period_label: String,
    pub income: f64,
    pub expense: f64,
    pub net: f64,
    pub confirmed_at: DateTime<Utc>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmPayPeriodInput {
    pub net: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePayPeriodInput {
    pub net: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySum {
    pub category: String,
    pub amount: f64,
    pub top: Vec<TxHighlight>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTransactionInput {
    pub amount: Option<f64>,
    pub transaction_type: Option<TransactionType>,
    pub category: Option<String>,
    pub account: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub tags: Option<Vec<String>>,
}

pub const DEFAULT_CATEGORIES: &[&str] = &[
    "餐饮", "交通", "通讯", "购物", "娱乐", "住房", "医疗", "学习", "旅行", "外债还款", "收入", "其他",
];
