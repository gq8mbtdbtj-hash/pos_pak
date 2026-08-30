use crate::database::{get_entity_tags, remove_search_index, set_entity_tags, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::finance::{
    CategorySum, ChartBucket, CreateTransactionInput, FinanceSummary, MoneyFlow,
    PayPeriodGlance, PayPeriodPending, PayPeriodSnapshot, Transaction, TransactionType,
    TxHighlight, UpdateTransactionInput, DEFAULT_CATEGORIES,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Timelike, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

pub struct FinanceService<'a> {
    db: &'a Database,
}

impl<'a> FinanceService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn create(&self, input: CreateTransactionInput) -> AppResult<Transaction> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let tx_type = input.transaction_type.unwrap_or(TransactionType::Expense);
        let category = input
            .category
            .unwrap_or_else(|| "其他".to_string());
        let occurred_at = input.occurred_at.unwrap_or(now);
        let tags = input.tags.unwrap_or_default();

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO transactions (id, amount, type, category, account, merchant, note, occurred_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    input.amount,
                    tx_type.as_str(),
                    category,
                    input.account,
                    input.merchant,
                    input.note,
                    occurred_at.to_rfc3339(),
                    now.to_rfc3339(),
                ],
            )?;
            set_entity_tags(&tx, "transaction_tags", "transaction_id", &id, &tags)?;
            let search_content = format!(
                "{} {} {}",
                category,
                input.merchant.clone().unwrap_or_default(),
                input.note.clone().unwrap_or_default()
            );
            upsert_search_index(
                &tx,
                "transaction",
                &id,
                &format!("{} ¥{}", category, input.amount),
                &search_content,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.get(&id)
    }

    pub fn quick_add(&self, text: &str) -> AppResult<Transaction> {
        let parsed = parse_quick_finances(text);
        if parsed.is_empty() {
            return Err(AppError::Other("无法识别金额".into()));
        }
        let mut last = None;
        for input in parsed {
            last = Some(self.create(input)?);
        }
        last.ok_or_else(|| AppError::Other("无法识别金额".into()))
    }

    pub fn get(&self, id: &str) -> AppResult<Transaction> {
        self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, amount, type, category, account, merchant, note, occurred_at, created_at
                     FROM transactions WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, f64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<String>>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound(format!("transaction {id}")))?;

            let tags = get_entity_tags(conn, "transaction_tags", "transaction_id", id)?;
            Ok(row_to_transaction(row, tags))
        })
    }

    pub fn list(&self, limit: Option<i32>) -> AppResult<Vec<Transaction>> {
        self.db.with_conn(|conn| {
            let sql = match limit {
                Some(n) => format!(
                    "SELECT id, amount, type, category, account, merchant, note, occurred_at, created_at
                     FROM transactions ORDER BY occurred_at DESC LIMIT {n}"
                ),
                None => "SELECT id, amount, type, category, account, merchant, note, occurred_at, created_at
                          FROM transactions ORDER BY occurred_at DESC".to_string(),
            };
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                ))
            })?;
            let mut transactions = Vec::new();
            for row in rows {
                let r = row?;
                let tags = get_entity_tags(conn, "transaction_tags", "transaction_id", &r.0)?;
                transactions.push(row_to_transaction(r, tags));
            }
            Ok(transactions)
        })
    }

    pub fn update(&self, id: &str, input: UpdateTransactionInput) -> AppResult<Transaction> {
        let existing = self.get(id)?;
        let amount = input.amount.unwrap_or(existing.amount);
        let tx_type = input.transaction_type.unwrap_or(existing.transaction_type);
        let category = input
            .category
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .unwrap_or(existing.category);
        let account = input.account.or(existing.account);
        let merchant = input.merchant.or(existing.merchant);
        let note = input.note.or(existing.note);
        let tags = input.tags.unwrap_or(existing.tags);

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "UPDATE transactions
                 SET amount = ?1, type = ?2, category = ?3, account = ?4, merchant = ?5, note = ?6
                 WHERE id = ?7",
                params![
                    amount,
                    tx_type.as_str(),
                    category,
                    account,
                    merchant,
                    note,
                    id,
                ],
            )?;
            set_entity_tags(&tx, "transaction_tags", "transaction_id", id, &tags)?;
            let search_content = format!(
                "{} {} {}",
                category,
                merchant.clone().unwrap_or_default(),
                note.clone().unwrap_or_default()
            );
            upsert_search_index(
                &tx,
                "transaction",
                id,
                &format!("{} ¥{}", category, amount),
                &search_content,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.get(id)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "transaction", id)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn summary(&self, payday: u32) -> AppResult<FinanceSummary> {
        let payday = payday.clamp(1, 28);
        let now = Utc::now();
        let today = now.date_naive();
        let today_start = today.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let week_start_date = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        let week_start = week_start_date.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let month_start_date = today.with_day(1).unwrap();
        let month_start = month_start_date.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let tomorrow = (today + Duration::days(1))
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let week_end = (week_start_date + Duration::days(7))
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let month_end = (last_day_of_month(today) + Duration::days(1))
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();

        let (period_start, period_end) = pay_period_bounds(chrono::Local::now().date_naive(), payday);
        let period_start_dt = period_start.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let period_end_dt = period_end.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let pay_period_label = period_label(period_start, period_end);

        let (today_flow, week_flow, month_flow, pay_period) = self.db.with_conn(|conn| {
            Ok((
                sum_flow_since(conn, &today_start.to_rfc3339())?,
                sum_flow_since(conn, &week_start.to_rfc3339())?,
                sum_flow_since(conn, &month_start.to_rfc3339())?,
                sum_flow_between(conn, &period_start_dt.to_rfc3339(), &period_end_dt.to_rfc3339())?,
            ))
        })?;

        let category_day = self.category_breakdown_between(&today_start, &tomorrow)?;
        let category_week = self.category_breakdown_between(&week_start, &week_end)?;
        let category_month = self.category_breakdown_between(&month_start, &month_end)?;
        let chart_day = self.chart_hours_today(today)?;
        let chart_week = self.chart_days(week_start_date, 7)?;
        let days_in_month = last_day_of_month(today).day() as i64;
        let chart_month = self.chart_days(month_start_date, days_in_month)?;

        let debt_repayment_month: f64 = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM transactions
                 WHERE type = 'expense' AND category = '外债还款'
                   AND occurred_at >= ?1 AND occurred_at < ?2",
                params![month_start.to_rfc3339(), month_end.to_rfc3339()],
                |row| row.get(0),
            )
            .map_err(AppError::from)
        })?;

        let (debt_remaining, debt_monthly_obligation): (f64, f64) = self.db.with_conn(|conn| {
            let remaining = conn.query_row(
                "SELECT COALESCE(SUM(remaining), 0) FROM debts WHERE status = 'active'",
                [],
                |row| row.get(0),
            )?;
            let monthly = conn.query_row(
                "SELECT COALESCE(SUM(monthly_amount), 0) FROM repayment_plans WHERE status = 'active'",
                [],
                |row| row.get(0),
            )?;
            Ok((remaining, monthly))
        })?;

        let (pending_snapshot, snapshots) =
            self.snapshot_status(payday, chrono::Local::now().date_naive())?;

        let period_flow = pay_period.income - pay_period.expense;
        let (prev_start, _) = previous_pay_period(chrono::Local::now().date_naive(), payday);
        let prev_key = prev_start.format("%Y-%m-%d").to_string();
        let opening_snap = snapshots.iter().find(|s| s.period_start == prev_key);
        let opening = opening_snap.map(|s| s.net);
        let opening_period_label = opening_snap.map(|s| s.period_label.clone());
        let opening_missing = opening.is_none();
        let effective = opening.unwrap_or(0.0) + period_flow;
        let due_this_period = self.due_installments_in_period(period_start, period_end)?;
        let after_debts = effective - due_this_period;
        let pay_period_glance = PayPeriodGlance {
            opening,
            opening_period_label,
            opening_missing,
            period_flow,
            effective,
            due_this_period,
            after_debts,
        };

        Ok(FinanceSummary {
            today: today_flow,
            week: week_flow,
            month: month_flow,
            pay_period,
            pay_period_label,
            pay_period_glance,
            by_category: category_month.clone(),
            category_day,
            category_week,
            category_month,
            chart_day,
            chart_week,
            chart_month,
            debt_repayment_month,
            debt_remaining,
            debt_monthly_obligation,
            pending_snapshot,
            snapshots,
        })
    }

    fn due_installments_in_period(
        &self,
        period_start: NaiveDate,
        period_end: NaiveDate,
    ) -> AppResult<f64> {
        let start = period_start.format("%Y-%m-%d").to_string();
        let end = period_end.format("%Y-%m-%d").to_string();
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM repayment_installments
                 WHERE status != 'paid'
                   AND due_date >= ?1 AND due_date < ?2",
                params![start, end],
                |row| row.get(0),
            )
            .map_err(AppError::from)
        })
    }

    fn snapshot_status(
        &self,
        payday: u32,
        today: NaiveDate,
    ) -> AppResult<(Option<PayPeriodPending>, Vec<PayPeriodSnapshot>)> {
        let (prev_start, prev_end) = previous_pay_period(today, payday);
        let snapshots = self.list_snapshots(12)?;
        let prev_key = prev_start.format("%Y-%m-%d").to_string();
        let confirmed = snapshots.iter().any(|s| s.period_start == prev_key);
        let pending = if confirmed {
            None
        } else {
            let start_dt = prev_start.and_hms_opt(0, 0, 0).unwrap().and_utc();
            let end_dt = prev_end.and_hms_opt(0, 0, 0).unwrap().and_utc();
            let flow = self.db.with_conn(|conn| {
                sum_flow_between(conn, &start_dt.to_rfc3339(), &end_dt.to_rfc3339())
            })?;
            Some(PayPeriodPending {
                period_start: prev_key,
                period_end: prev_end.format("%Y-%m-%d").to_string(),
                period_label: period_label(prev_start, prev_end),
                income: flow.income,
                expense: flow.expense,
                net: flow.income - flow.expense,
            })
        };
        Ok((pending, snapshots))
    }

    pub fn list_snapshots(&self, limit: i32) -> AppResult<Vec<PayPeriodSnapshot>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, period_start, period_end, income, expense, net, confirmed_at, note
                 FROM pay_period_snapshots
                 ORDER BY period_start DESC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], map_snapshot_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn confirm_previous_snapshot(
        &self,
        payday: u32,
        net: Option<f64>,
        note: Option<String>,
    ) -> AppResult<PayPeriodSnapshot> {
        let payday = payday.clamp(1, 28);
        let today = chrono::Local::now().date_naive();
        let (prev_start, prev_end) = previous_pay_period(today, payday);
        let start_key = prev_start.format("%Y-%m-%d").to_string();
        let start_dt = prev_start.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let end_dt = prev_end.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let flow = self.db.with_conn(|conn| {
            sum_flow_between(conn, &start_dt.to_rfc3339(), &end_dt.to_rfc3339())
        })?;
        let net = match net {
            Some(n) if n.is_finite() => n,
            _ => flow.income - flow.expense,
        };
        let note = note.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });
        let now = Utc::now();
        if let Some(existing) = self
            .list_snapshots(24)?
            .into_iter()
            .find(|s| s.period_start == start_key)
        {
            return self.write_snapshot_update(
                &existing.id,
                flow.income,
                flow.expense,
                net,
                note,
                now,
                existing.period_start,
                existing.period_end,
                existing.period_label,
            );
        }
        let id = Uuid::new_v4().to_string();
        let note_s = note.clone();
        let end_key = prev_end.format("%Y-%m-%d").to_string();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO pay_period_snapshots
                 (id, period_start, period_end, income, expense, net, confirmed_at, note)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    start_key,
                    end_key,
                    flow.income,
                    flow.expense,
                    net,
                    now.to_rfc3339(),
                    note_s,
                ],
            )?;
            Ok(())
        })?;
        Ok(PayPeriodSnapshot {
            id,
            period_start: start_key,
            period_end: end_key,
            period_label: period_label(prev_start, prev_end),
            income: flow.income,
            expense: flow.expense,
            net,
            confirmed_at: now,
            note,
        })
    }

    pub fn update_snapshot(
        &self,
        id: &str,
        net: Option<f64>,
        note: Option<String>,
    ) -> AppResult<PayPeriodSnapshot> {
        let existing = self
            .list_snapshots(120)?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::NotFound(format!("pay period snapshot {id}")))?;
        let net = match net {
            Some(n) if n.is_finite() => n,
            _ => existing.net,
        };
        let note = match note {
            Some(s) => {
                let t = s.trim().to_string();
                if t.is_empty() {
                    None
                } else {
                    Some(t)
                }
            }
            None => existing.note.clone(),
        };
        self.write_snapshot_update(
            id,
            existing.income,
            existing.expense,
            net,
            note,
            Utc::now(),
            existing.period_start,
            existing.period_end,
            existing.period_label,
        )
    }

    fn write_snapshot_update(
        &self,
        id: &str,
        income: f64,
        expense: f64,
        net: f64,
        note: Option<String>,
        confirmed_at: DateTime<Utc>,
        period_start: String,
        period_end: String,
        period_label: String,
    ) -> AppResult<PayPeriodSnapshot> {
        let note_s = note.clone();
        self.db.with_conn(|conn| {
            let n = conn.execute(
                "UPDATE pay_period_snapshots
                 SET income = ?1, expense = ?2, net = ?3, confirmed_at = ?4, note = ?5
                 WHERE id = ?6",
                params![
                    income,
                    expense,
                    net,
                    confirmed_at.to_rfc3339(),
                    note_s,
                    id,
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("pay period snapshot {id}")));
            }
            Ok(())
        })?;
        Ok(PayPeriodSnapshot {
            id: id.to_string(),
            period_start,
            period_end,
            period_label,
            income,
            expense,
            net,
            confirmed_at,
            note,
        })
    }

    pub fn today_spending(&self) -> AppResult<f64> {
        Ok(self.summary(1)?.today.expense)
    }

    fn chart_hours_today(&self, day: NaiveDate) -> AppResult<Vec<ChartBucket>> {
        let start = day.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let end = (day + Duration::days(1)).and_hms_opt(0, 0, 0).unwrap().and_utc();
        let rows = self.list_tx_between(&start, &end)?;
        let mut income = [0.0f64; 24];
        let mut expense = [0.0f64; 24];
        let mut top_income: Vec<Vec<TxHighlight>> = (0..24).map(|_| Vec::new()).collect();
        let mut top_expense: Vec<Vec<TxHighlight>> = (0..24).map(|_| Vec::new()).collect();

        for row in rows {
            let hour = row.occurred_at.hour() as usize;
            if hour >= 24 {
                continue;
            }
            match row.tx_type.as_str() {
                "income" => {
                    income[hour] += row.amount;
                    push_top(&mut top_income[hour], row.to_highlight(), 12);
                }
                "expense" => {
                    expense[hour] += row.amount;
                    push_top(&mut top_expense[hour], row.to_highlight(), 12);
                }
                _ => {}
            }
        }

        Ok((0..24)
            .map(|h| ChartBucket {
                label: format!("{h:02}"),
                income: income[h],
                expense: expense[h],
                top_income: top_income[h].clone(),
                top_expense: top_expense[h].clone(),
            })
            .collect())
    }

    fn chart_days(&self, start_date: NaiveDate, days: i64) -> AppResult<Vec<ChartBucket>> {
        let start = start_date.and_hms_opt(0, 0, 0).unwrap().and_utc();
        let end = (start_date + Duration::days(days))
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let rows = self.list_tx_between(&start, &end)?;
        let mut buckets: Vec<(f64, f64, Vec<TxHighlight>, Vec<TxHighlight>)> =
            (0..days).map(|_| (0.0, 0.0, Vec::new(), Vec::new())).collect();

        for row in rows {
            let offset = (row.occurred_at.date_naive() - start_date).num_days();
            if offset < 0 || offset >= days {
                continue;
            }
            let idx = offset as usize;
            match row.tx_type.as_str() {
                "income" => {
                    buckets[idx].0 += row.amount;
                    push_top(&mut buckets[idx].2, row.to_highlight(), 12);
                }
                "expense" => {
                    buckets[idx].1 += row.amount;
                    push_top(&mut buckets[idx].3, row.to_highlight(), 12);
                }
                _ => {}
            }
        }

        Ok(buckets
            .into_iter()
            .enumerate()
            .map(|(i, (income, expense, top_income, top_expense))| {
                let d = start_date + Duration::days(i as i64);
                ChartBucket {
                    label: format!("{}/{}", d.month(), d.day()),
                    income,
                    expense,
                    top_income,
                    top_expense,
                }
            })
            .collect())
    }

    fn list_tx_between(
        &self,
        start: &DateTime<Utc>,
        end: &DateTime<Utc>,
    ) -> AppResult<Vec<TxRow>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, amount, type, category, merchant, note, occurred_at
                 FROM transactions
                 WHERE occurred_at >= ?1 AND occurred_at < ?2",
            )?;
            let rows = stmt.query_map(params![start.to_rfc3339(), end.to_rfc3339()], |row| {
                Ok(TxRow {
                    id: row.get(0)?,
                    amount: row.get(1)?,
                    tx_type: row.get(2)?,
                    category: row.get(3)?,
                    merchant: row.get(4)?,
                    note: row.get(5)?,
                    occurred_at: {
                        let s: String = row.get(6)?;
                        DateTime::parse_from_rfc3339(&s)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    },
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn default_categories(&self) -> Vec<String> {
        self.list_categories().unwrap_or_else(|_| {
            DEFAULT_CATEGORIES.iter().map(|s| s.to_string()).collect()
        })
    }

    pub fn list_categories(&self) -> AppResult<Vec<String>> {
        let mut categories: Vec<String> = DEFAULT_CATEGORIES.iter().map(|s| s.to_string()).collect();
        let used = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT category FROM transactions
                 WHERE category IS NOT NULL AND TRIM(category) != ''
                 ORDER BY category",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;
        for category in used {
            if !categories.iter().any(|c| c == &category) {
                categories.push(category);
            }
        }
        Ok(categories)
    }

    fn category_breakdown_between(
        &self,
        start: &DateTime<Utc>,
        end: &DateTime<Utc>,
    ) -> AppResult<Vec<CategorySum>> {
        let rows = self.list_tx_between(start, end)?;
        let mut map: std::collections::BTreeMap<String, (f64, Vec<TxHighlight>)> =
            std::collections::BTreeMap::new();
        for row in rows {
            if row.tx_type != "expense" {
                continue;
            }
            let entry = map.entry(row.category.clone()).or_insert((0.0, Vec::new()));
            entry.0 += row.amount;
            push_top(&mut entry.1, row.to_highlight(), 12);
        }
        let mut out: Vec<CategorySum> = map
            .into_iter()
            .map(|(category, (amount, top))| CategorySum {
                category,
                amount,
                top,
            })
            .collect();
        out.sort_by(|a, b| {
            b.amount
                .partial_cmp(&a.amount)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(out)
    }
}

/// Pay period `[start, end)` where `end` is the next payday date at 00:00.
pub(crate) fn pay_period_bounds(today: NaiveDate, payday: u32) -> (NaiveDate, NaiveDate) {
    let payday = payday.clamp(1, 28);
    let this_month_pay = clamp_day_in_month(today.year(), today.month(), payday);
    let (start, end) = if today >= this_month_pay {
        let next = if today.month() == 12 {
            clamp_day_in_month(today.year() + 1, 1, payday)
        } else {
            clamp_day_in_month(today.year(), today.month() + 1, payday)
        };
        (this_month_pay, next)
    } else {
        let prev = if today.month() == 1 {
            clamp_day_in_month(today.year() - 1, 12, payday)
        } else {
            clamp_day_in_month(today.year(), today.month() - 1, payday)
        };
        (prev, this_month_pay)
    };
    (start, end)
}

pub(crate) fn previous_pay_period(today: NaiveDate, payday: u32) -> (NaiveDate, NaiveDate) {
    let (start, _) = pay_period_bounds(today, payday);
    pay_period_bounds(start - Duration::days(1), payday)
}

fn period_label(start: NaiveDate, end: NaiveDate) -> String {
    let last = end - Duration::days(1);
    format!(
        "{}/{} – {}/{}",
        start.month(),
        start.day(),
        last.month(),
        last.day()
    )
}

fn map_snapshot_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PayPeriodSnapshot> {
    let start: String = row.get(1)?;
    let end: String = row.get(2)?;
    let confirmed: String = row.get(6)?;
    let start_d = NaiveDate::parse_from_str(&start, "%Y-%m-%d")
        .unwrap_or_else(|_| Utc::now().date_naive());
    let end_d = NaiveDate::parse_from_str(&end, "%Y-%m-%d")
        .unwrap_or_else(|_| Utc::now().date_naive());
    Ok(PayPeriodSnapshot {
        id: row.get(0)?,
        period_start: start,
        period_end: end,
        period_label: period_label(start_d, end_d),
        income: row.get(3)?,
        expense: row.get(4)?,
        net: row.get(5)?,
        confirmed_at: DateTime::parse_from_rfc3339(&confirmed)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        note: row.get(7)?,
    })
}

fn clamp_day_in_month(year: i32, month: u32, day: u32) -> NaiveDate {
    let last = last_day_of_month(
        NaiveDate::from_ymd_opt(year, month, 1).expect("valid y-m"),
    )
    .day();
    NaiveDate::from_ymd_opt(year, month, day.min(last)).expect("valid date")
}

fn sum_flow_between(conn: &rusqlite::Connection, start: &str, end: &str) -> AppResult<MoneyFlow> {
    let income: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions
         WHERE type = 'income' AND occurred_at >= ?1 AND occurred_at < ?2",
        params![start, end],
        |row| row.get(0),
    )?;
    let expense: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions
         WHERE type = 'expense' AND occurred_at >= ?1 AND occurred_at < ?2",
        params![start, end],
        |row| row.get(0),
    )?;
    Ok(MoneyFlow { income, expense })
}

fn sum_flow_since(conn: &rusqlite::Connection, since: &str) -> AppResult<MoneyFlow> {
    let income: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions
         WHERE type = 'income' AND occurred_at >= ?1",
        params![since],
        |row| row.get(0),
    )?;
    let expense: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions
         WHERE type = 'expense' AND occurred_at >= ?1",
        params![since],
        |row| row.get(0),
    )?;
    Ok(MoneyFlow { income, expense })
}

fn last_day_of_month(day: NaiveDate) -> NaiveDate {
    let next_month = if day.month() == 12 {
        NaiveDate::from_ymd_opt(day.year() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(day.year(), day.month() + 1, 1).unwrap()
    };
    next_month - Duration::days(1)
}

struct TxRow {
    id: String,
    amount: f64,
    tx_type: String,
    category: String,
    merchant: Option<String>,
    note: Option<String>,
    occurred_at: DateTime<Utc>,
}

impl TxRow {
    fn to_highlight(&self) -> TxHighlight {
        let label = self
            .merchant
            .clone()
            .or_else(|| self.note.clone())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| self.category.clone());
        TxHighlight {
            id: self.id.clone(),
            amount: self.amount,
            category: self.category.clone(),
            label,
            occurred_at: self.occurred_at,
        }
    }
}

fn push_top(list: &mut Vec<TxHighlight>, item: TxHighlight, limit: usize) {
    list.push(item);
    list.sort_by(|a, b| {
        b.amount
            .partial_cmp(&a.amount)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if list.len() > limit {
        list.truncate(limit);
    }
}

fn row_to_transaction(
    row: (String, f64, String, String, Option<String>, Option<String>, Option<String>, String, String),
    tags: Vec<String>,
) -> Transaction {
    Transaction {
        id: row.0,
        amount: row.1,
        transaction_type: TransactionType::from_str(&row.2),
        category: row.3,
        account: row.4,
        merchant: row.5,
        note: row.6,
        occurred_at: DateTime::parse_from_rfc3339(&row.7)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        created_at: DateTime::parse_from_rfc3339(&row.8)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        tags,
    }
}

pub fn parse_quick_finances(text: &str) -> Vec<CreateTransactionInput> {
    extract_amount_segments(text)
        .into_iter()
        .filter(|(_, amount)| *amount > 0.0)
        .map(|(label, amount)| transaction_from_label(label, amount))
        .collect()
}

fn transaction_from_label(label: String, amount: f64) -> CreateTransactionInput {
    let tx_type = guess_type(&label);
    let category = guess_category(&label, &tx_type);
    let note = if label.is_empty() {
        None
    } else {
        Some(label.clone())
    };
    CreateTransactionInput {
        amount,
        transaction_type: Some(tx_type),
        category: Some(category),
        account: None,
        merchant: note.clone(),
        note,
        occurred_at: None,
        tags: None,
    }
}

const INCOME_KEYWORDS: &[&str] = &[
    "卖掉", "卖了", "出售", "售出", "卖出", "转卖", "卖", "收入", "进账", "入账", "工资",
    "薪水", "薪资", "奖金", "收到", "收款", "回款", "赚了", "赚", "盈利", "退款", "报销",
];

const EXPENSE_KEYWORDS: &[&str] = &["买了", "买", "花了", "花", "付了", "付", "支出", "消费"];

fn last_keyword_end(label: &str, keywords: &[&str]) -> Option<usize> {
    keywords
        .iter()
        .filter_map(|kw| label.rfind(kw).map(|i| i + kw.len()))
        .max()
}

fn guess_type(label: &str) -> TransactionType {
    let income_at = last_keyword_end(label, INCOME_KEYWORDS);
    let expense_at = last_keyword_end(label, EXPENSE_KEYWORDS);
    match (income_at, expense_at) {
        (Some(i), Some(e)) if e > i => TransactionType::Expense,
        (Some(_), _) => TransactionType::Income,
        _ => TransactionType::Expense,
    }
}

fn guess_category(label: &str, tx_type: &TransactionType) -> String {
    if *tx_type == TransactionType::Income {
        return "收入".to_string();
    }
    let rules: &[(&str, &str)] = &[
        ("咖啡", "餐饮"),
        ("饭", "餐饮"),
        ("午", "餐饮"),
        ("餐", "餐饮"),
        ("吃", "餐饮"),
        ("地铁", "交通"),
        ("公交", "交通"),
        ("打车", "交通"),
        ("出租", "交通"),
        ("电信", "通讯"),
        ("联通", "通讯"),
        ("移动", "通讯"),
        ("话费", "通讯"),
        ("流量", "通讯"),
        ("宽带", "通讯"),
        ("网费", "通讯"),
        ("通讯", "通讯"),
        ("书", "学习"),
        ("买", "购物"),
    ];
    for (keyword, category) in rules {
        if label.contains(keyword) {
            return category.to_string();
        }
    }
    "其他".to_string()
}

struct AmountHit {
    start: usize,
    end: usize,
    amount: f64,
}

fn extract_amount_segments(text: &str) -> Vec<(String, f64)> {
    let chars: Vec<char> = text.chars().collect();
    let hits = find_amount_hits(&chars);
    let mut results = Vec::new();
    let mut prev = 0usize;
    for hit in hits {
        let label: String = chars[prev..hit.start].iter().collect();
        results.push((normalize_label(&label), hit.amount));
        prev = hit.end;
    }
    results
}

fn normalize_label(s: &str) -> String {
    s.trim()
        .trim_matches(|c: char| "，,。、；;：: 	".contains(c))
        .to_string()
}

fn find_amount_hits(chars: &[char]) -> Vec<AmountHit> {
    let mut hits = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        let mut cursor = i;
        if chars[cursor] == '¥' || chars[cursor] == '$' {
            if cursor + 1 < chars.len() && chars[cursor + 1].is_ascii_digit() {
                cursor += 1;
            } else {
                i += 1;
                continue;
            }
        }
        if !chars[cursor].is_ascii_digit() {
            i += 1;
            continue;
        }
        let digit_start = cursor;
        while cursor < chars.len() && chars[cursor].is_ascii_digit() {
            cursor += 1;
        }
        if cursor < chars.len() && chars[cursor] == '.' {
            let frac = cursor + 1;
            if frac < chars.len() && chars[frac].is_ascii_digit() {
                cursor = frac;
                while cursor < chars.len() && chars[cursor].is_ascii_digit() {
                    cursor += 1;
                }
            }
        }
        let digit_end = cursor;
        let mut end = digit_end;
        if end < chars.len() && chars[end] == '元' {
            end += 1;
        }
        if is_time_or_date_unit(chars.get(end).copied()) || is_clock_minute(chars, start) {
            i = digit_end;
            continue;
        }
        let num_str: String = chars[digit_start..digit_end].iter().collect();
        if let Ok(amount) = num_str.parse::<f64>() {
            if amount > 0.0 {
                hits.push(AmountHit { start, end, amount });
            }
        }
        i = end;
    }
    hits
}

fn is_time_or_date_unit(ch: Option<char>) -> bool {
    matches!(ch, Some('点' | '时' | '分' | '秒' | '月' | '日' | '号' | '年' | ':'))
}

fn is_clock_minute(chars: &[char], start: usize) -> bool {
    let mut k = start;
    while k > 0 && chars[k - 1].is_whitespace() {
        k -= 1;
    }
    k > 0 && chars[k - 1] == '点'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_coffee_expense() {
        let input = parse_quick_finances("咖啡 28").remove(0);
        assert_eq!(input.amount, 28.0);
        assert_eq!(input.category.as_deref(), Some("餐饮"));
        assert_eq!(input.transaction_type, Some(TransactionType::Expense));
    }

    #[test]
    fn parse_lunch_expense() {
        let input = parse_quick_finances("午饭 35").remove(0);
        assert_eq!(input.amount, 35.0);
        assert_eq!(input.category.as_deref(), Some("餐饮"));
    }

    #[test]
    fn parse_glued_amount_as_income() {
        let input = parse_quick_finances("冰箱卖了36").remove(0);
        assert_eq!(input.amount, 36.0);
        assert_eq!(input.transaction_type, Some(TransactionType::Income));
        assert_eq!(input.category.as_deref(), Some("收入"));
    }

    #[test]
    fn parse_continuous_mixed_description() {
        let items = parse_quick_finances("今天卖了冰箱36买了咖啡28");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].amount, 36.0);
        assert_eq!(items[0].transaction_type, Some(TransactionType::Income));
        assert_eq!(items[1].amount, 28.0);
        assert_eq!(items[1].transaction_type, Some(TransactionType::Expense));
        assert_eq!(items[1].category.as_deref(), Some("餐饮"));
    }

    #[test]
    fn parse_glued_multi_expenses() {
        let items = parse_quick_finances("咖啡28地铁4");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].amount, 28.0);
        assert_eq!(items[1].amount, 4.0);
        assert_eq!(items[1].category.as_deref(), Some("交通"));
    }

    #[test]
    fn ignores_meeting_time() {
        assert!(parse_quick_finances("明天9点开会").is_empty());
    }

    #[test]
    fn parse_telecom_bill_as_communication() {
        let input = parse_quick_finances("电信欠费 88").remove(0);
        assert_eq!(input.amount, 88.0);
        assert_eq!(input.category.as_deref(), Some("通讯"));
    }

    #[test]
    fn update_category_to_custom() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("t.db")).unwrap();
        let svc = FinanceService::new(&db);
        let tx = svc
            .create(CreateTransactionInput {
                amount: 88.0,
                transaction_type: Some(TransactionType::Expense),
                category: Some("其他".into()),
                account: None,
                merchant: Some("电信欠费".into()),
                note: Some("电信欠费".into()),
                occurred_at: None,
                tags: None,
            })
            .unwrap();
        let updated = svc
            .update(
                &tx.id,
                UpdateTransactionInput {
                    category: Some("通讯".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.category, "通讯");
        let cats = svc.list_categories().unwrap();
        assert!(cats.iter().any(|c| c == "通讯"));
    }

    #[test]
    fn previous_pay_period_is_closed_window() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        let (s, e) = pay_period_bounds(today, 15);
        assert_eq!(s, NaiveDate::from_ymd_opt(2026, 8, 15).unwrap());
        assert_eq!(e, NaiveDate::from_ymd_opt(2026, 9, 15).unwrap());
        let (ps, pe) = previous_pay_period(today, 15);
        assert_eq!(ps, NaiveDate::from_ymd_opt(2026, 7, 15).unwrap());
        assert_eq!(pe, NaiveDate::from_ymd_opt(2026, 8, 15).unwrap());
    }

    #[test]
    fn confirm_snapshot_persists_and_clears_pending() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("s.db")).unwrap();
        let svc = FinanceService::new(&db);
        let payday = 1u32;
        let today = chrono::Local::now().date_naive();
        let (ps, _) = previous_pay_period(today, payday);
        svc.create(CreateTransactionInput {
            amount: 100.0,
            transaction_type: Some(TransactionType::Income),
            category: Some("收入".into()),
            account: None,
            merchant: None,
            note: None,
            occurred_at: Some(ps.and_hms_opt(12, 0, 0).unwrap().and_utc()),
            tags: None,
        })
        .unwrap();
        let snap = svc.confirm_previous_snapshot(payday, None, None).unwrap();
        assert!((snap.net - 100.0).abs() < 0.01);
        let again = svc
            .confirm_previous_snapshot(payday, Some(80.0), Some("现金盘点".into()))
            .unwrap();
        assert_eq!(again.id, snap.id);
        assert!((again.net - 80.0).abs() < 0.01);
        let edited = svc
            .update_snapshot(&snap.id, Some(75.5), Some("再核".into()))
            .unwrap();
        assert!((edited.net - 75.5).abs() < 0.01);
        assert!(svc.summary(payday).unwrap().pending_snapshot.is_none());
    }

    #[test]
    fn effective_surplus_uses_opening_and_dues() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("g.db")).unwrap();
        let svc = FinanceService::new(&db);
        let payday = 1u32;
        let today = chrono::Local::now().date_naive();
        let (ps, _) = previous_pay_period(today, payday);
        let (cur_start, cur_end) = pay_period_bounds(today, payday);

        svc.create(CreateTransactionInput {
            amount: 100.0,
            transaction_type: Some(TransactionType::Income),
            category: Some("收入".into()),
            account: None,
            merchant: None,
            note: None,
            occurred_at: Some(ps.and_hms_opt(12, 0, 0).unwrap().and_utc()),
            tags: None,
        })
        .unwrap();
        svc.confirm_previous_snapshot(payday, Some(80.0), None)
            .unwrap();

        svc.create(CreateTransactionInput {
            amount: 30.0,
            transaction_type: Some(TransactionType::Expense),
            category: Some("其他".into()),
            account: None,
            merchant: None,
            note: None,
            occurred_at: Some(cur_start.and_hms_opt(12, 0, 0).unwrap().and_utc()),
            tags: None,
        })
        .unwrap();

        let g1 = svc.summary(payday).unwrap().pay_period_glance;
        assert!(!g1.opening_missing);
        assert!((g1.opening.unwrap() - 80.0).abs() < 0.01);
        assert!((g1.period_flow + 30.0).abs() < 0.01);
        assert!((g1.effective - 50.0).abs() < 0.01);
        assert!((g1.after_debts - 50.0).abs() < 0.01);

        let snap = svc.list_snapshots(1).unwrap().into_iter().next().unwrap();
        svc.update_snapshot(&snap.id, Some(100.0), None).unwrap();
        let g2 = svc.summary(payday).unwrap().pay_period_glance;
        assert!((g2.effective - 70.0).abs() < 0.01);

        let due = cur_start + Duration::days(3);
        assert!(due < cur_end);
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO debts
                 (id, name, principal, remaining, annual_rate, start_date, status, created_at, updated_at)
                 VALUES ('d1', '测', 1000, 1000, 0, ?1, 'active', datetime('now'), datetime('now'))",
                params![cur_start.format("%Y-%m-%d").to_string()],
            )?;
            conn.execute(
                "INSERT INTO repayment_plans
                 (id, debt_id, title, monthly_amount, start_date, status, created_at, plan_mode, term_months)
                 VALUES ('p1', 'd1', '计划', 40, ?1, 'active', datetime('now'), 'equal_payment', 1)",
                params![cur_start.format("%Y-%m-%d").to_string()],
            )?;
            conn.execute(
                "INSERT INTO repayment_installments
                 (id, plan_id, sequence, due_date, amount, status)
                 VALUES ('i1', 'p1', 1, ?1, 40, 'pending')",
                params![due.format("%Y-%m-%d").to_string()],
            )?;
            Ok(())
        })
        .unwrap();

        let g3 = svc.summary(payday).unwrap().pay_period_glance;
        assert!((g3.due_this_period - 40.0).abs() < 0.01);
        assert!((g3.after_debts - 30.0).abs() < 0.01);
    }
}
