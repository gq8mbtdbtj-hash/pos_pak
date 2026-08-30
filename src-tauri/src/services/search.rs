use crate::database::Database;
use crate::error::AppResult;
use crate::models::search::{DashboardStats, SearchResult};
use crate::services::debt::DebtService;
use crate::services::finance::FinanceService;
use crate::services::goal::GoalService;
use crate::services::task::TaskService;
use rusqlite::params;

pub struct SearchService<'a> {
    db: &'a Database,
}

impl<'a> SearchService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn search(&self, query: &str, limit: i32) -> AppResult<Vec<SearchResult>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }

        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT source_type, source_id, title, snippet(search_index, 2, '<b>', '</b>', '...', 32)
                 FROM search_index
                 WHERE search_index MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
            )?;
            let pattern = format!("\"{}\" OR {}", escape_fts(q), escape_fts(q));
            let rows = stmt.query_map(params![pattern, limit], |row| {
                Ok(SearchResult {
                    source_type: row.get(0)?,
                    id: row.get(1)?,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                    reference: row.get(1)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn dashboard(&self, payday: u32) -> AppResult<DashboardStats> {
        let task_svc = TaskService::new(self.db);
        let goal_svc = GoalService::new(self.db);
        let finance_svc = FinanceService::new(self.db);
        let debt_svc = DebtService::new(self.db);

        let (tasks_done, tasks_total) = task_svc.count_today_progress()?;
        let (habits_done, habits_total) = goal_svc.today_checkin_progress()?;
        let today_spending = finance_svc.today_spending()?;
        let finance = finance_svc.summary(payday)?;
        let overview = debt_svc.overview()?;
        let _ = debt_svc.sync_repayment_reminders();
        let _ = goal_svc.sync_plan_reminders();

        Ok(DashboardStats {
            tasks_done,
            tasks_total,
            habits_done,
            habits_total,
            today_spending,
            month_income: finance.month.income,
            month_expense: finance.month.expense,
            month_net: finance.month.income - finance.month.expense,
            debt_remaining: overview.total_remaining,
            debt_monthly_obligation: overview.monthly_obligation,
            months_to_payoff: overview.months_to_payoff,
            payoff_date: overview.payoff_date.map(|d| d.to_string()),
        })
    }
}

fn escape_fts(q: &str) -> String {
    q.replace('"', "\"\"")
}
