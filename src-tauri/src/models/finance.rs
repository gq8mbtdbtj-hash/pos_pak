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
