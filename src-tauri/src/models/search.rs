use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub source_type: String,
    pub title: String,
    pub snippet: String,
    pub reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub tasks_done: i32,
    pub tasks_total: i32,
    pub habits_done: i32,
    pub habits_total: i32,
    pub today_spending: f64,
    pub month_income: f64,
    pub month_expense: f64,
    pub month_net: f64,
    pub pay_period_income: f64,
    pub pay_period_expense: f64,
    pub pay_period_label: String,
    #[serde(default)]
    pub pay_period_effective: f64,
    #[serde(default)]
    pub pay_period_opening: Option<f64>,
    #[serde(default)]
    pub pay_period_opening_missing: bool,
    #[serde(default)]
    pub pay_period_due_this_period: f64,
    #[serde(default)]
    pub pay_period_after_debts: f64,
    pub debt_remaining: f64,
    pub debt_monthly_obligation: f64,
    pub months_to_payoff: Option<i32>,
    pub payoff_date: Option<String>,
}
