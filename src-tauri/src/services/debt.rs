use crate::database::{remove_search_index, upsert_search_index, Database};
use crate::error::{AppError, AppResult};
use crate::models::debt::{
    CalibrateRateInput, CalibrateRateResult, CreateDebtInput, CreateDebtPaymentInput,
    CreateRepaymentPlanInput, Debt, DebtDetail, DebtMetrics, DebtOverview, DebtPayment, DebtStatus,
    InstallmentStatus, PlanStatus, RepaymentInstallment, RepaymentMode, RepaymentPlan,
    UpcomingInstallment, UpdateDebtInput,
};
use crate::models::finance::{CreateTransactionInput, TransactionType};
use crate::models::task::{CreateTaskInput, TaskPriority, TaskStatus, UpdateTaskInput};
use crate::services::finance::FinanceService;
use crate::services::task::TaskService;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

pub struct DebtService<'a> {
    db: &'a Database,
}

impl<'a> DebtService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn overview(&self) -> AppResult<DebtOverview> {
        let _ = self.complete_past_due_installments();
        // 校准所有外债剩余本金
        if let Ok(list) = self.list() {
            for d in list {
                let _ = self.sync_remaining(&d.id);
            }
        }
        self.db.with_conn(|conn| {
            let (total_principal, total_remaining, active_count): (f64, f64, i32) = conn.query_row(
                "SELECT
                    COALESCE(SUM(principal), 0),
                    COALESCE(SUM(CASE WHEN status = 'active' THEN remaining ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)
                 FROM debts",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;

            let monthly_obligation: f64 = conn.query_row(
                "SELECT COALESCE(SUM(monthly_amount), 0) FROM repayment_plans
                 WHERE status = 'active'",
                [],
                |row| row.get(0),
            )?;

            let (paid_principal, paid_interest): (f64, f64) = conn.query_row(
                "SELECT
                    COALESCE(SUM(COALESCE(principal_amount, amount)), 0),
                    COALESCE(SUM(COALESCE(interest_amount, 0)), 0)
                 FROM debt_payments",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;

            let (remaining_interest_planned, remaining_total_planned): (f64, f64) = conn.query_row(
                "SELECT
                    COALESCE(SUM(COALESCE(i.interest_amount, 0)), 0),
                    COALESCE(SUM(i.amount), 0)
                 FROM repayment_installments i
                 JOIN repayment_plans p ON p.id = i.plan_id
                 JOIN debts d ON d.id = p.debt_id
                 WHERE i.status = 'pending' AND p.status = 'active' AND d.status = 'active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;

            let payoff: Option<(String, i32)> = conn
                .query_row(
                    "SELECT MAX(i.due_date), COUNT(*)
                     FROM repayment_installments i
                     JOIN repayment_plans p ON p.id = i.plan_id
                     JOIN debts d ON d.id = p.debt_id
                     WHERE i.status = 'pending' AND p.status = 'active' AND d.status = 'active'",
                    [],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i32>(1)?)),
                )
                .optional()?
                .and_then(|(date, count)| date.map(|d| (d, count)));

            let (months_to_payoff, payoff_date) = match payoff {
                Some((d, count)) if count > 0 => (Some(count), Some(parse_date(&d))),
                _ => (None, None),
            };

            let horizon = (Utc::now().date_naive() + Duration::days(62)).format("%Y-%m-%d").to_string();
            let mut stmt = conn.prepare(
                "SELECT i.id, d.id, d.name, i.due_date, i.amount, p.title
                 FROM repayment_installments i
                 JOIN repayment_plans p ON p.id = i.plan_id
                 JOIN debts d ON d.id = p.debt_id
                 WHERE i.status = 'pending' AND p.status = 'active' AND d.status = 'active'
                   AND i.due_date <= ?1
                 ORDER BY i.due_date ASC",
            )?;
            let upcoming = stmt
                .query_map(params![horizon], |row| {
                    Ok(UpcomingInstallment {
                        installment_id: row.get(0)?,
                        debt_id: row.get(1)?,
                        debt_name: row.get(2)?,
                        due_date: parse_date(&row.get::<_, String>(3)?),
                        amount: row.get(4)?,
                        plan_title: row.get(5)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(DebtOverview {
                total_principal,
                total_remaining,
                active_count,
                monthly_obligation,
                paid_principal,
                paid_interest,
                remaining_interest_planned,
                remaining_total_planned: if remaining_total_planned > 0.0 {
                    remaining_total_planned
                } else {
                    total_remaining
                },
                months_to_payoff,
                payoff_date,
                upcoming,
            })
        })
    }

    pub fn list(&self) -> AppResult<Vec<Debt>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, creditor, principal, remaining, annual_rate,
                        start_date, due_date, status, note, created_at, updated_at
                 FROM debts
                 ORDER BY
                    CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                    updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_debt_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn get(&self, id: &str) -> AppResult<Debt> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT id, name, creditor, principal, remaining, annual_rate,
                        start_date, due_date, status, note, created_at, updated_at
                 FROM debts WHERE id = ?1",
                params![id],
                map_debt_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("debt {id}")))
        })
    }

    pub fn detail(&self, id: &str) -> AppResult<DebtDetail> {
        let _ = self.complete_past_due_installments();
        let _ = self.sync_remaining(id);
        let debt = self.get(id)?;
        let payments = self.list_payments(id)?;
        let plans = self.list_plans(id)?;
        let metrics = self.metrics_for(id)?;
        Ok(DebtDetail {
            debt,
            payments,
            plans,
            metrics,
        })
    }

    pub fn metrics_for(&self, debt_id: &str) -> AppResult<DebtMetrics> {
        let debt = self.get(debt_id)?;
        self.db.with_conn(|conn| {
            let (paid_principal, paid_interest): (f64, f64) = conn.query_row(
                "SELECT
                    COALESCE(SUM(COALESCE(principal_amount, amount)), 0),
                    COALESCE(SUM(COALESCE(interest_amount, 0)), 0)
                 FROM debt_payments WHERE debt_id = ?1",
                params![debt_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;

            let (remaining_interest_planned, remaining_total_planned, months, payoff): (
                f64,
                f64,
                i32,
                Option<String>,
            ) = conn.query_row(
                "SELECT
                    COALESCE(SUM(COALESCE(i.interest_amount, 0)), 0),
                    COALESCE(SUM(i.amount), 0),
                    COUNT(*),
                    MAX(i.due_date)
                 FROM repayment_installments i
                 JOIN repayment_plans p ON p.id = i.plan_id
                 WHERE p.debt_id = ?1 AND i.status = 'pending' AND p.status = 'active'",
                params![debt_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )?;

            let next = conn
                .query_row(
                    "SELECT i.amount, i.due_date
                     FROM repayment_installments i
                     JOIN repayment_plans p ON p.id = i.plan_id
                     WHERE p.debt_id = ?1 AND i.status = 'pending' AND p.status = 'active'
                     ORDER BY i.due_date ASC LIMIT 1",
                    params![debt_id],
                    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;

            let remaining_principal = debt.remaining.max(0.0);
            let progress_pct = if debt.principal <= 0.0 {
                100.0
            } else {
                (((debt.principal - remaining_principal) / debt.principal) * 100.0)
                    .clamp(0.0, 100.0)
            };

            Ok(DebtMetrics {
                paid_principal,
                paid_interest,
                remaining_principal,
                remaining_interest_planned,
                remaining_total_planned: if remaining_total_planned > 0.0 {
                    remaining_total_planned
                } else {
                    remaining_principal
                },
                months_to_payoff: if months > 0 { Some(months) } else { None },
                payoff_date: payoff.map(|d| parse_date(&d)),
                progress_pct,
                next_due_amount: next.as_ref().map(|n| n.0),
                next_due_date: next.map(|n| parse_date(&n.1)),
            })
        })
    }

    /// 用「开户剩余 − 已还本金」重算剩余本金。
    /// 已还本金来自还款流水；若分期已标记已付但缺少流水，会先补记再核算。
    pub fn sync_remaining(&self, debt_id: &str) -> AppResult<Debt> {
        self.ensure_opening_remaining(debt_id)?;
        self.backfill_orphan_paid_installments(debt_id)?;

        let debt = self.get(debt_id)?;
        let opening = self.opening_remaining_of(debt_id)?;
        let paid_principal = self.paid_principal_total(debt_id)?;
        let remaining = (opening - paid_principal).max(0.0).min(debt.principal);

        let status = if remaining <= 0.0 {
            DebtStatus::Paid
        } else if debt.status == DebtStatus::Paid {
            DebtStatus::Active
        } else {
            debt.status
        };
        if (remaining - debt.remaining).abs() < 0.005 && status == debt.status {
            return Ok(debt);
        }
        let now = Utc::now();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE debts SET remaining = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                params![remaining, status.as_str(), now.to_rfc3339(), debt_id],
            )?;
            Ok(())
        })?;
        self.get(debt_id)
    }

    fn paid_principal_total(&self, debt_id: &str) -> AppResult<f64> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(SUM(
                    CASE
                      WHEN COALESCE(principal_amount, 0) = 0
                           AND COALESCE(interest_amount, 0) = 0
                        THEN amount
                      ELSE COALESCE(principal_amount, 0)
                    END
                 ), 0)
                 FROM debt_payments WHERE debt_id = ?1",
                params![debt_id],
                |row| row.get(0),
            )
            .map_err(AppError::from)
        })
    }

    fn opening_remaining_of(&self, debt_id: &str) -> AppResult<f64> {
        self.db.with_conn(|conn| {
            let (principal, remaining, opening): (f64, f64, Option<f64>) = conn.query_row(
                "SELECT principal, remaining, opening_remaining FROM debts WHERE id = ?1",
                params![debt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            Ok(opening
                .unwrap_or(remaining)
                .clamp(0.0, principal))
        })
    }

    fn ensure_opening_remaining(&self, debt_id: &str) -> AppResult<()> {
        let needs: bool = self.db.with_conn(|conn| {
            let v: Option<f64> = conn.query_row(
                "SELECT opening_remaining FROM debts WHERE id = ?1",
                params![debt_id],
                |row| row.get(0),
            )?;
            Ok(v.is_none())
        })?;
        if !needs {
            return Ok(());
        }
        let debt = self.get(debt_id)?;
        let paid = self.paid_principal_total(debt_id)?;
        // 若 remaining 仍等于本金，视为开户剩余就是本金（即使已有未扣减的还款流水）
        let opening = if (debt.remaining - debt.principal).abs() < 0.01 {
            debt.principal
        } else {
            (debt.remaining + paid).min(debt.principal).max(0.0)
        };
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE debts SET opening_remaining = ?1 WHERE id = ?2",
                params![opening, debt_id],
            )?;
            Ok(())
        })
    }

    /// 已标记已付、但还款流水本金合计不足的分期：按差额补记，避免重复扣减。
    fn backfill_orphan_paid_installments(&self, debt_id: &str) -> AppResult<()> {
        let paid_payments = self.paid_principal_total(debt_id)?;
        let rows: Vec<(String, f64, f64, f64, Option<String>)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT i.id,
                        i.amount,
                        COALESCE(i.principal_amount, 0),
                        COALESCE(i.interest_amount, 0),
                        i.payment_id
                 FROM repayment_installments i
                 JOIN repayment_plans p ON p.id = i.plan_id
                 WHERE p.debt_id = ?1 AND i.status = ?2 AND p.status = ?3",
            )?;
            let mapped = stmt.query_map(
                params![
                    debt_id,
                    InstallmentStatus::Paid.as_str(),
                    PlanStatus::Active.as_str()
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, f64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )?;
            mapped.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;

        let mut paid_installments = 0.0;
        let mut orphan_ids: Vec<(String, f64, f64)> = Vec::new();
        for (id, amount, mut principal, interest, payment_id) in rows {
            if principal <= 0.0 && interest <= 0.0 && amount > 0.0 {
                principal = amount;
            }
            paid_installments += principal;

            let missing_payment = match payment_id.as_deref() {
                None => true,
                Some(pid) => {
                    let exists: i32 = self.db.with_conn(|conn| {
                        conn.query_row(
                            "SELECT COUNT(*) FROM debt_payments WHERE id = ?1",
                            params![pid],
                            |r| r.get(0),
                        )
                        .map_err(AppError::from)
                    })?;
                    exists == 0
                }
            };
            if missing_payment && principal > 0.0 {
                orphan_ids.push((id, principal, interest));
            }
        }

        let gap = paid_installments - paid_payments;
        if gap <= 0.05 || orphan_ids.is_empty() {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();
        let pay_id = Uuid::new_v4().to_string();
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO debt_payments
                 (id, debt_id, amount, paid_at, note, created_at, principal_amount, interest_amount, transaction_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
                params![
                    pay_id,
                    debt_id,
                    gap,
                    now,
                    "已付分期差额补记（本金核算）",
                    now,
                    gap,
                    0.0,
                ],
            )?;
            for (iid, principal, interest) in &orphan_ids {
                tx.execute(
                    "UPDATE repayment_installments SET payment_id = ?1 WHERE id = ?2",
                    params![pay_id, iid],
                )?;
                if *principal > 0.0 {
                    tx.execute(
                        "UPDATE repayment_installments
                         SET principal_amount = ?1, interest_amount = ?2
                         WHERE id = ?3
                           AND COALESCE(principal_amount, 0) = 0
                           AND COALESCE(interest_amount, 0) = 0",
                        params![principal, interest, iid],
                    )?;
                }
            }
            tx.commit()?;
            Ok(())
        })
    }

    pub fn calibrate_rate(
        &self,
        debt_id: &str,
        input: CalibrateRateInput,
    ) -> AppResult<CalibrateRateResult> {
        let debt = self.sync_remaining(debt_id)?;
        if debt.remaining <= 0.0 {
            return Err(AppError::Other("剩余本金为 0，无法校准利率".into()));
        }
        if input.monthly_interest < 0.0 {
            return Err(AppError::Other("月利息不能为负".into()));
        }
        let monthly_rate = input.monthly_interest / debt.remaining;
        let annual_rate = round4(monthly_rate * 12.0 * 100.0);
        self.update(
            debt_id,
            UpdateDebtInput {
                name: None,
                creditor: None,
                annual_rate: Some(annual_rate),
                note: None,
            },
        )?;
        Ok(CalibrateRateResult {
            annual_rate,
            monthly_rate: round6(monthly_rate * 100.0),
            remaining: debt.remaining,
        })
    }

    pub fn create(&self, input: CreateDebtInput) -> AppResult<Debt> {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::Other("外债名称不能为空".into()));
        }
        if input.principal <= 0.0 {
            return Err(AppError::Other("本金必须大于 0".into()));
        }
        let remaining = input.remaining.unwrap_or(input.principal).max(0.0);
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let status = if remaining <= 0.0 {
            DebtStatus::Paid
        } else {
            DebtStatus::Active
        };

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO debts
                 (id, name, creditor, principal, remaining, annual_rate, start_date, due_date, status, note, created_at, updated_at, opening_remaining)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    name,
                    input.creditor,
                    input.principal,
                    remaining,
                    input.annual_rate.unwrap_or(0.0),
                    input.start_date,
                    input.due_date,
                    status.as_str(),
                    input.note,
                    now.to_rfc3339(),
                    now.to_rfc3339(),
                    remaining,
                ],
            )?;
            upsert_search_index(
                &tx,
                "debt",
                &id,
                &name,
                &format!(
                    "{} {} {}",
                    input.creditor.clone().unwrap_or_default(),
                    input.note.clone().unwrap_or_default(),
                    remaining
                ),
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.get(&id)
    }

    pub fn update(&self, id: &str, input: UpdateDebtInput) -> AppResult<Debt> {
        let debt = self.get(id)?;
        let name = input
            .name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or(debt.name);
        let creditor = input.creditor.or(debt.creditor);
        let annual_rate = input.annual_rate.unwrap_or(debt.annual_rate).max(0.0);
        let note = input.note.or(debt.note);
        let now = Utc::now();

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "UPDATE debts
                 SET name = ?1, creditor = ?2, annual_rate = ?3, note = ?4, updated_at = ?5
                 WHERE id = ?6",
                params![
                    name,
                    creditor,
                    annual_rate,
                    note,
                    now.to_rfc3339(),
                    id
                ],
            )?;
            upsert_search_index(
                &tx,
                "debt",
                id,
                &name,
                &format!(
                    "{} {} {}",
                    creditor.clone().unwrap_or_default(),
                    note.clone().unwrap_or_default(),
                    debt.remaining
                ),
            )?;
            tx.commit()?;
            Ok(())
        })?;
        self.get(id)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM debts WHERE id = ?1", params![id])?;
            remove_search_index(&tx, "debt", id)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn add_payment(&self, debt_id: &str, input: CreateDebtPaymentInput) -> AppResult<Debt> {
        let principal = input.principal_amount.unwrap_or(0.0).max(0.0);
        let interest = input.interest_amount.unwrap_or(0.0).max(0.0);
        let total = if let Some(amount) = input.amount.filter(|a| *a > 0.0) {
            amount
        } else {
            principal + interest
        };
        if total <= 0.0 {
            return Err(AppError::Other("请填写还款本金和/或利息".into()));
        }
        // 若只填了总额未拆本息，整笔视作还本
        let (principal_part, interest_part) = if principal <= 0.0 && interest <= 0.0 {
            (total, 0.0)
        } else if principal + interest <= 0.0 {
            (total, 0.0)
        } else if (principal + interest - total).abs() > 0.05 && input.amount.is_some() {
            // 总额与拆分不一致时，以拆分为准重算总额
            (principal, interest)
        } else if principal > 0.0 || interest > 0.0 {
            (principal, interest)
        } else {
            (total, 0.0)
        };
        let total = (principal_part + interest_part).max(total);

        let debt = self.sync_remaining(debt_id)?;
        if input.calibrate_rate.unwrap_or(false) && interest_part > 0.0 && debt.remaining > 0.0 {
            let annual_rate = round4((interest_part / debt.remaining) * 12.0 * 100.0);
            let _ = self.update(
                debt_id,
                UpdateDebtInput {
                    name: None,
                    creditor: None,
                    annual_rate: Some(annual_rate),
                    note: None,
                },
            );
        }

        let note = input.note.or_else(|| {
            if interest_part > 0.0 && principal_part > 0.0 {
                Some(format!(
                    "本金 ¥{:.2} + 利息 ¥{:.2}",
                    principal_part, interest_part
                ))
            } else if interest_part > 0.0 {
                Some(format!("利息 ¥{:.2}", interest_part))
            } else {
                Some("手动还本".into())
            }
        });

        self.add_payment_split(
            debt_id,
            total,
            principal_part,
            interest_part,
            input.paid_at,
            note,
        )
    }

    /// Record a payment; only `principal_part` reduces remaining balance.
    /// Also mirrors an expense into the finance ledger under「外债还款」.
    fn add_payment_split(
        &self,
        debt_id: &str,
        total_amount: f64,
        principal_part: f64,
        interest_part: f64,
        paid_at: Option<String>,
        note: Option<String>,
    ) -> AppResult<Debt> {
        if total_amount <= 0.0 {
            return Err(AppError::Other("还款金额必须大于 0".into()));
        }
        let debt = self.get(debt_id)?;
        let payment_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let paid_at_dt = paid_at
            .as_deref()
            .and_then(parse_datetime_opt)
            .unwrap_or(now);
        let principal_part = principal_part.clamp(0.0, total_amount);
        let interest_part = interest_part.max(0.0);

        let finance = FinanceService::new(self.db);
        let tx = finance.create(CreateTransactionInput {
            amount: total_amount,
            transaction_type: Some(TransactionType::Expense),
            category: Some("外债还款".into()),
            account: None,
            merchant: Some(debt.name.clone()),
            note: Some(format!(
                "外债「{}」{}",
                debt.name,
                note.clone().unwrap_or_default()
            )),
            occurred_at: Some(paid_at_dt),
            tags: Some(vec!["外债".into(), debt.name.clone()]),
        })?;

        self.db.with_conn(|conn| {
            let txn = conn.unchecked_transaction()?;
            txn.execute(
                "INSERT INTO debt_payments
                 (id, debt_id, amount, paid_at, note, created_at, principal_amount, interest_amount, transaction_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    payment_id,
                    debt_id,
                    total_amount,
                    paid_at_dt.to_rfc3339(),
                    note,
                    now.to_rfc3339(),
                    principal_part,
                    interest_part,
                    tx.id,
                ],
            )?;
            let remaining = (debt.remaining - principal_part).max(0.0);
            let status = if remaining <= 0.0 {
                DebtStatus::Paid
            } else {
                debt.status
            };
            txn.execute(
                "UPDATE debts SET remaining = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                params![remaining, status.as_str(), now.to_rfc3339(), debt_id],
            )?;
            txn.commit()?;
            Ok(())
        })?;

        self.get(debt_id)
    }

    pub fn list_payments(&self, debt_id: &str) -> AppResult<Vec<DebtPayment>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, debt_id, amount, paid_at, note, created_at,
                        COALESCE(principal_amount, amount), COALESCE(interest_amount, 0), transaction_id
                 FROM debt_payments WHERE debt_id = ?1
                 ORDER BY paid_at DESC",
            )?;
            let rows = stmt.query_map(params![debt_id], |row| {
                Ok(DebtPayment {
                    id: row.get(0)?,
                    debt_id: row.get(1)?,
                    amount: row.get(2)?,
                    paid_at: parse_rfc3339(&row.get::<_, String>(3)?),
                    note: row.get(4)?,
                    created_at: parse_rfc3339(&row.get::<_, String>(5)?),
                    principal_amount: row.get(6)?,
                    interest_amount: row.get(7)?,
                    transaction_id: row.get(8)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn create_plan(
        &self,
        debt_id: &str,
        input: CreateRepaymentPlanInput,
    ) -> AppResult<RepaymentPlan> {
        let debt = self.get(debt_id)?;
        if debt.remaining <= 0.0 {
            return Err(AppError::Other("该外债已结清，无需还款计划".into()));
        }
        if input.term_months < 1 || input.term_months > 360 {
            return Err(AppError::Other("期数需在 1～360 个月之间".into()));
        }

        let mode = RepaymentMode::from_str(input.mode.as_deref().unwrap_or("equal_payment"));
        if debt.annual_rate <= 0.0 && matches!(mode, RepaymentMode::InterestBalloon) {
            return Err(AppError::Other(
                "先息后本需要年利率：请先在外债上填写年利率".into(),
            ));
        }

        let start = input
            .start_date
            .as_deref()
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap_or_else(|| Utc::now().date_naive());

        let schedule = build_schedule(
            mode.clone(),
            debt.remaining,
            debt.annual_rate,
            input.term_months,
            start,
        )?;
        let monthly_amount = schedule.monthly_amount;
        let title = input.title.unwrap_or_else(|| {
            format!(
                "{} · {}期 · {}",
                mode.label(),
                input.term_months,
                debt.name
            )
        });
        let plan_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        // 按计算结果如实写入每一期本金/利息/合计，全部待还；由用户按计划逐期还款。
        let installments = schedule
            .items
            .into_iter()
            .enumerate()
            .map(|(idx, item)| RepaymentInstallment {
                id: Uuid::new_v4().to_string(),
                plan_id: plan_id.clone(),
                sequence: (idx + 1) as i32,
                due_date: item.due_date,
                amount: round2(item.principal + item.interest),
                principal_amount: round2(item.principal),
                interest_amount: round2(item.interest),
                status: InstallmentStatus::Pending,
                paid_at: None,
                payment_id: None,
            })
            .collect::<Vec<_>>();

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "UPDATE repayment_plans SET status = 'cancelled' WHERE debt_id = ?1 AND status = 'active'",
                params![debt_id],
            )?;
            tx.execute(
                "INSERT INTO repayment_plans
                 (id, debt_id, title, monthly_amount, start_date, status, created_at, plan_mode, term_months)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    plan_id,
                    debt_id,
                    title,
                    monthly_amount,
                    start.to_string(),
                    PlanStatus::Active.as_str(),
                    now.to_rfc3339(),
                    mode.as_str(),
                    input.term_months,
                ],
            )?;
            for item in &installments {
                tx.execute(
                    "INSERT INTO repayment_installments
                     (id, plan_id, sequence, due_date, amount, status, paid_at, payment_id, principal_amount, interest_amount)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?8)",
                    params![
                        item.id,
                        item.plan_id,
                        item.sequence,
                        item.due_date.to_string(),
                        item.amount,
                        item.status.as_str(),
                        item.principal_amount,
                        item.interest_amount,
                    ],
                )?;
            }
            tx.commit()?;
            Ok(())
        })?;

        let plan = self.get_plan(&plan_id)?;
        let _ = self.sync_repayment_reminders();
        Ok(plan)
    }

    /// 不再自动把逾期分期记为已还；还款须按计划由用户确认「还这期」。
    pub fn complete_past_due_installments(&self) -> AppResult<u32> {
        Ok(0)
    }

    pub fn list_plans(&self, debt_id: &str) -> AppResult<Vec<RepaymentPlan>> {
        let ids: Vec<String> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM repayment_plans WHERE debt_id = ?1
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![debt_id], |row| row.get(0))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;
        let mut plans = Vec::new();
        for id in ids {
            plans.push(self.get_plan(&id)?);
        }
        Ok(plans)
    }

    pub fn get_plan(&self, plan_id: &str) -> AppResult<RepaymentPlan> {
        let _ = self.complete_past_due_installments();
        self.db.with_conn(|conn| {
            let plan = conn
                .query_row(
                    "SELECT id, debt_id, title, monthly_amount, start_date, status, created_at,
                            COALESCE(plan_mode, 'equal_payment'), COALESCE(term_months, 0)
                     FROM repayment_plans WHERE id = ?1",
                    params![plan_id],
                    |row| {
                        Ok(RepaymentPlan {
                            id: row.get(0)?,
                            debt_id: row.get(1)?,
                            title: row.get(2)?,
                            monthly_amount: row.get(3)?,
                            start_date: parse_date(&row.get::<_, String>(4)?),
                            status: PlanStatus::from_str(&row.get::<_, String>(5)?),
                            created_at: parse_rfc3339(&row.get::<_, String>(6)?),
                            plan_mode: RepaymentMode::from_str(&row.get::<_, String>(7)?),
                            term_months: row.get(8)?,
                            installments: vec![],
                        })
                    },
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound(format!("plan {plan_id}")))?;

            let mut stmt = conn.prepare(
                "SELECT id, plan_id, sequence, due_date, amount, status, paid_at, payment_id,
                        COALESCE(principal_amount, 0), COALESCE(interest_amount, 0)
                 FROM repayment_installments WHERE plan_id = ?1
                 ORDER BY sequence ASC",
            )?;
            let installments = stmt
                .query_map(params![plan_id], |row| {
                    Ok(RepaymentInstallment {
                        id: row.get(0)?,
                        plan_id: row.get(1)?,
                        sequence: row.get(2)?,
                        due_date: parse_date(&row.get::<_, String>(3)?),
                        amount: row.get(4)?,
                        status: InstallmentStatus::from_str(&row.get::<_, String>(5)?),
                        paid_at: row
                            .get::<_, Option<String>>(6)?
                            .map(|s| parse_rfc3339(&s)),
                        payment_id: row.get(7)?,
                        principal_amount: row.get(8)?,
                        interest_amount: row.get(9)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(RepaymentPlan {
                installments,
                ..plan
            })
        })
    }

    pub fn pay_installment(&self, installment_id: &str) -> AppResult<DebtDetail> {
        let (plan_id, debt_id, amount, principal_amount, interest_amount, status) =
            self.db.with_conn(|conn| {
                conn.query_row(
                    "SELECT i.plan_id, p.debt_id, i.amount,
                            COALESCE(i.principal_amount, 0),
                            COALESCE(i.interest_amount, 0),
                            i.status
                     FROM repayment_installments i
                     JOIN repayment_plans p ON p.id = i.plan_id
                     WHERE i.id = ?1",
                    params![installment_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, f64>(2)?,
                            row.get::<_, f64>(3)?,
                            row.get::<_, f64>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound(format!("installment {installment_id}")))
            })?;

        if status == "paid" {
            return self.detail(&debt_id);
        }
        if amount <= 0.0 {
            return Err(AppError::Other("分期金额无效".into()));
        }

        let note = if principal_amount <= 0.0 {
            "按计划还息"
        } else if interest_amount > 0.0 {
            "按计划还本息"
        } else {
            "按计划还本金"
        };

        let debt = self.add_payment_split(
            &debt_id,
            amount,
            principal_amount,
            interest_amount,
            None,
            Some(note.into()),
        )?;

        let payment_id = self
            .list_payments(&debt_id)?
            .into_iter()
            .next()
            .map(|p| p.id);

        let now = Utc::now();
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "UPDATE repayment_installments
                 SET status = ?1, paid_at = ?2, payment_id = ?3
                 WHERE id = ?4",
                params![
                    InstallmentStatus::Paid.as_str(),
                    now.to_rfc3339(),
                    payment_id,
                    installment_id
                ],
            )?;

            let pending: i32 = tx.query_row(
                "SELECT COUNT(*) FROM repayment_installments
                 WHERE plan_id = ?1 AND status = ?2",
                params![plan_id, InstallmentStatus::Pending.as_str()],
                |row| row.get(0),
            )?;
            if pending == 0 || debt.remaining <= 0.0 {
                tx.execute(
                    "UPDATE repayment_plans SET status = ?1 WHERE id = ?2",
                    params![PlanStatus::Completed.as_str(), plan_id],
                )?;
            }
            tx.commit()?;
            Ok(())
        })?;

        let detail = self.detail(&debt_id)?;
        let _ = self.sync_repayment_reminders();
        Ok(detail)
    }

    /// Ensure every pending installment has reminder tasks: 3 days before, 1 day before, due day 17:00.
    pub fn sync_repayment_reminders(&self) -> AppResult<()> {
        let tasks = TaskService::new(self.db);
        let pending: Vec<(String, String, NaiveDate, f64)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT i.id, d.name, i.due_date, i.amount
                 FROM repayment_installments i
                 JOIN repayment_plans p ON p.id = i.plan_id
                 JOIN debts d ON d.id = p.debt_id
                 WHERE i.status = 'pending' AND p.status = 'active' AND d.status = 'active'",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    parse_date(&row.get::<_, String>(2)?),
                    row.get::<_, f64>(3)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;

        let active_ids: std::collections::HashSet<String> =
            pending.iter().map(|(id, _, _, _)| id.clone()).collect();

        // Drop orphan reminder tasks whose installment is gone / paid.
        let orphan_tags: Vec<(String, String)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT tt.task_id, t.name
                 FROM task_tags tt
                 JOIN tags t ON t.id = tt.tag_id
                 WHERE t.name LIKE 'debt-remind:%'",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;
        for (task_id, tag) in orphan_tags {
            let installment_id = tag
                .strip_prefix("debt-remind:")
                .and_then(|rest| rest.split(':').next())
                .unwrap_or("");
            if installment_id.is_empty() || !active_ids.contains(installment_id) {
                let _ = tasks.delete(&task_id);
            }
        }

        let today = Local::now().date_naive();
        let horizon = today + Duration::days(31);

        // Migrate / remove legacy per-slot tags (…:d3|:d1|:d0).
        let legacy_tags: Vec<(String, String)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT tt.task_id, t.name
                 FROM task_tags tt
                 JOIN tags t ON t.id = tt.tag_id
                 WHERE t.name LIKE 'debt-remind:%:d3'
                    OR t.name LIKE 'debt-remind:%:d1'
                    OR t.name LIKE 'debt-remind:%:d0'",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })?;
        for (task_id, _) in legacy_tags {
            let _ = tasks.delete(&task_id);
        }

        for (installment_id, debt_name, due_date, amount) in pending {
            let tag = format!("debt-remind:{installment_id}");
            let due_tag = format!("debt-due:{due_date}");

            if due_date > horizon {
                if let Some(existing) = tasks.find_id_by_tag(&tag)? {
                    let _ = tasks.delete(&existing);
                }
                continue;
            }

            let days_left = (due_date - today).num_days();
            let priority = TaskPriority::from_days_until_due(days_left);

            let title = format!("还款提醒 · {debt_name} · ¥{amount:.2}");
            let description = Some(format!(
                "外债「{debt_name}」应还日 {due_date}，金额 ¥{amount:.2}。请按时还款。"
            ));
            let due_at = local_remind_at(due_date, 0);
            let tags = vec![
                tag.clone(),
                due_tag,
                "还款提醒".into(),
                "周期批量".into(),
            ];

            // Drop reminders whose due day already passed more than a day ago and still unpaid:
            // keep overdue tasks visible until paid (orphan cleanup handles paid).
            if days_left < -30 {
                if let Some(existing) = tasks.find_id_by_tag(&tag)? {
                    let _ = tasks.delete(&existing);
                }
                continue;
            }

            if let Some(existing_id) = tasks.find_id_by_tag(&tag)? {
                let existing = tasks.get(&existing_id)?;
                if existing.status == TaskStatus::Done || existing.status == TaskStatus::Cancelled {
                    continue;
                }
                let _ = tasks.update(
                    &existing_id,
                    UpdateTaskInput {
                        title: Some(title),
                        description,
                        due_at: Some(Some(due_at)),
                        priority: Some(priority),
                        tags: Some(tags),
                        status: None,
                    },
                );
            } else {
                let _ = tasks.create(CreateTaskInput {
                    title,
                    description,
                    priority: Some(priority),
                    due_at: Some(due_at),
                    tags: Some(tags),
                });
            }
        }
        Ok(())
    }
}

fn local_remind_at(due_date: NaiveDate, days_before: i64) -> DateTime<Utc> {
    let day = due_date - Duration::days(days_before);
    let naive = day.and_time(NaiveTime::from_hms_opt(17, 0, 0).unwrap());
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) | chrono::LocalResult::Ambiguous(dt, _) => {
            dt.with_timezone(&Utc)
        }
        chrono::LocalResult::None => Utc.from_utc_datetime(&naive),
    }
}

struct ScheduleItem {
    due_date: NaiveDate,
    principal: f64,
    interest: f64,
}

struct Schedule {
    monthly_amount: f64,
    items: Vec<ScheduleItem>,
}

fn build_schedule(
    mode: RepaymentMode,
    principal: f64,
    annual_rate: f64,
    term_months: i32,
    start: NaiveDate,
) -> AppResult<Schedule> {
    match mode {
        RepaymentMode::InterestBalloon => {
            build_interest_balloon(principal, annual_rate, term_months, start)
        }
        RepaymentMode::EqualPayment => {
            build_equal_payment(principal, annual_rate, term_months, start)
        }
    }
}

/// 先息后本：前 n-1 期只还利息，最后一期还利息 + 全部本金。
fn build_interest_balloon(
    principal: f64,
    annual_rate: f64,
    term_months: i32,
    start: NaiveDate,
) -> AppResult<Schedule> {
    let monthly_rate = annual_rate / 100.0 / 12.0;
    let interest = round2(principal * monthly_rate);
    if interest <= 0.0 {
        return Err(AppError::Other(
            "根据年利率算出的月利息为 0，请检查利率".into(),
        ));
    }
    let mut items = Vec::with_capacity(term_months as usize);
    let mut date = start;
    for seq in 1..=term_months {
        if seq < term_months {
            items.push(ScheduleItem {
                due_date: date,
                principal: 0.0,
                interest,
            });
        } else {
            items.push(ScheduleItem {
                due_date: date,
                principal: round2(principal),
                interest,
            });
        }
        date = add_months(date, 1);
    }
    Ok(Schedule {
        monthly_amount: interest,
        items,
    })
}

/// 等额本息：每月偿还相同的「利息 + 本金」总额。
fn build_equal_payment(
    principal: f64,
    annual_rate: f64,
    term_months: i32,
    start: NaiveDate,
) -> AppResult<Schedule> {
    let n = term_months as f64;
    let r = annual_rate / 100.0 / 12.0;
    let payment = if r.abs() < 1e-12 {
        round2(principal / n)
    } else {
        let factor = (1.0 + r).powf(n);
        round2(principal * r * factor / (factor - 1.0))
    };
    if payment <= 0.0 {
        return Err(AppError::Other("无法计算月供，请检查本金与期数".into()));
    }

    let mut balance = principal;
    let mut items = Vec::with_capacity(term_months as usize);
    let mut date = start;
    for seq in 1..=term_months {
        let interest = round2(balance * r);
        let mut principal_part = if seq == term_months {
            round2(balance)
        } else {
            round2((payment - interest).max(0.0))
        };
        if principal_part > balance {
            principal_part = round2(balance);
        }
        items.push(ScheduleItem {
            due_date: date,
            principal: principal_part,
            interest,
        });
        balance = (balance - principal_part).max(0.0);
        date = add_months(date, 1);
    }
    Ok(Schedule {
        monthly_amount: payment,
        items,
    })
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}

fn round6(v: f64) -> f64 {
    (v * 1_000_000.0).round() / 1_000_000.0
}

fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let mut year = date.year();
    let mut month = date.month() as i32 + months;
    while month > 12 {
        month -= 12;
        year += 1;
    }
    while month < 1 {
        month += 12;
        year -= 1;
    }
    let day = date.day().min(days_in_month(year, month as u32));
    NaiveDate::from_ymd_opt(year, month as u32, day).unwrap_or(date + Duration::days(30))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1).unwrap()
    };
    (next - Duration::days(1)).day()
}

fn map_debt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Debt> {
    Ok(Debt {
        id: row.get(0)?,
        name: row.get(1)?,
        creditor: row.get(2)?,
        principal: row.get(3)?,
        remaining: row.get(4)?,
        annual_rate: row.get(5)?,
        start_date: row
            .get::<_, Option<String>>(6)?
            .map(|s| parse_date(&s)),
        due_date: row
            .get::<_, Option<String>>(7)?
            .map(|s| parse_date(&s)),
        status: DebtStatus::from_str(&row.get::<_, String>(8)?),
        note: row.get(9)?,
        created_at: parse_rfc3339(&row.get::<_, String>(10)?),
        updated_at: parse_rfc3339(&row.get::<_, String>(11)?),
    })
}

fn parse_date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(&s[..10.min(s.len())], "%Y-%m-%d"))
        .unwrap_or_else(|_| Utc::now().date_naive())
}

fn parse_rfc3339(s: &str) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn parse_datetime_opt(s: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
        .or_else(|| {
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(12, 0, 0))
                .map(|d| d.and_utc())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn sync_repayment_reminders_creates_three_tasks() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "提醒贷".into(),
                creditor: None,
                principal: 3000.0,
                remaining: Some(3000.0),
                annual_rate: Some(6.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        let start = (Utc::now().date_naive() + Duration::days(10))
            .format("%Y-%m-%d")
            .to_string();
        let plan = svc
            .create_plan(
                &debt.id,
                CreateRepaymentPlanInput {
                    title: None,
                    mode: Some("equal_payment".into()),
                    term_months: 3,
                    start_date: Some(start),
                    monthly_amount: None,
                },
            )
            .unwrap();
        svc.sync_repayment_reminders().unwrap();
        let tasks = TaskService::new(&db).list(None).unwrap();
        let remind = tasks
            .iter()
            .filter(|t| t.tags.iter().any(|tg| tg.starts_with("debt-remind:")))
            .count();
        // One task per pending installment within ~1 month (not 3 text slots).
        assert!(remind >= 1, "expected at least 1 reminder task, got {remind}");
        let first_id = &plan.installments[0].id;
        let tag = format!("debt-remind:{first_id}");
        assert!(
            TaskService::new(&db).find_id_by_tag(&tag).unwrap().is_some(),
            "missing tag {tag}"
        );
        let task = TaskService::new(&db)
            .get(&TaskService::new(&db).find_id_by_tag(&tag).unwrap().unwrap())
            .unwrap();
        assert!(
            !task.title.contains("还有"),
            "title should not hardcode days-left text: {}",
            task.title
        );
    }

    #[test]
    fn equal_payment_reduces_principal() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "消费贷".into(),
                creditor: None,
                principal: 12000.0,
                remaining: Some(12000.0),
                annual_rate: Some(12.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        let plan = svc
            .create_plan(
                &debt.id,
                CreateRepaymentPlanInput {
                    title: None,
                    mode: Some("equal_payment".into()),
                    term_months: 12,
                    start_date: Some("2026-09-01".into()),
                    monthly_amount: None,
                },
            )
            .unwrap();
        assert_eq!(plan.installments.len(), 12);
        assert!(plan.installments[0].interest_amount > 0.0);
        assert!(plan.installments[0].principal_amount > 0.0);
        let before = debt.remaining;
        let detail = svc.pay_installment(&plan.installments[0].id).unwrap();
        let reduced = before - detail.debt.remaining;
        assert!((reduced - plan.installments[0].principal_amount).abs() < 0.02);
    }

    #[test]
    fn past_due_installments_remain_pending_until_paid() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d3.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "历史计划".into(),
                creditor: None,
                principal: 12000.0,
                remaining: Some(12000.0),
                annual_rate: Some(0.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        let plan = svc
            .create_plan(
                &debt.id,
                CreateRepaymentPlanInput {
                    title: None,
                    mode: Some("equal_payment".into()),
                    term_months: 3,
                    start_date: Some("2020-01-01".into()),
                    monthly_amount: None,
                },
            )
            .unwrap();
        // 历史起息也不自动结清，须用户按计划还款
        assert!(plan
            .installments
            .iter()
            .all(|i| i.status == InstallmentStatus::Pending));
        assert_eq!(plan.status, PlanStatus::Active);
        let again = svc.get(&debt.id).unwrap();
        assert!((again.remaining - 12000.0).abs() < 0.01);
        assert_eq!(again.status, DebtStatus::Active);
    }

    #[test]
    fn interest_balloon_interest_does_not_cut_principal() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d2.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "先息贷".into(),
                creditor: None,
                principal: 100000.0,
                remaining: Some(100000.0),
                annual_rate: Some(6.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        let plan = svc
            .create_plan(
                &debt.id,
                CreateRepaymentPlanInput {
                    title: None,
                    mode: Some("interest_balloon".into()),
                    term_months: 6,
                    start_date: Some("2026-09-01".into()),
                    monthly_amount: None,
                },
            )
            .unwrap();
        assert_eq!(plan.installments.len(), 6);
        assert_eq!(plan.installments[0].principal_amount, 0.0);
        assert!(plan.installments[0].interest_amount > 0.0);
        let detail = svc.pay_installment(&plan.installments[0].id).unwrap();
        assert!((detail.debt.remaining - 100000.0).abs() < 0.01);
    }

    #[test]
    fn interest_balloon_past_start_does_not_clear_principal() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d6.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "消费贷".into(),
                creditor: None,
                principal: 200000.0,
                remaining: Some(200000.0),
                annual_rate: Some(3.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        // 历史起息：末期还本到期日已过，也不应自动结清本金
        let plan = svc
            .create_plan(
                &debt.id,
                CreateRepaymentPlanInput {
                    title: None,
                    mode: Some("interest_balloon".into()),
                    term_months: 12,
                    start_date: Some("2025-01-06".into()),
                    monthly_amount: None,
                },
            )
            .unwrap();
        let balloon = plan.installments.last().unwrap();
        assert!(balloon.principal_amount > 1000.0);
        assert_eq!(balloon.status, InstallmentStatus::Pending);
        let again = svc.get(&debt.id).unwrap();
        assert_eq!(again.status, DebtStatus::Active);
        assert!((again.remaining - 200000.0).abs() < 0.01);
    }

    #[test]
    fn orphan_paid_installments_reduce_remaining() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d4.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "旧数据".into(),
                creditor: None,
                principal: 12000.0,
                remaining: Some(12000.0),
                annual_rate: Some(0.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        let plan = svc
            .create_plan(
                &debt.id,
                CreateRepaymentPlanInput {
                    title: None,
                    mode: Some("equal_payment".into()),
                    term_months: 3,
                    start_date: Some("2026-09-01".into()),
                    monthly_amount: None,
                },
            )
            .unwrap();
        // Simulate legacy bug: mark installment paid without payment / without reducing remaining.
        let iid = plan.installments[0].id.clone();
        let principal = plan.installments[0].principal_amount;
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE repayment_installments
                 SET status = 'paid', paid_at = ?1, payment_id = NULL
                 WHERE id = ?2",
                params![Utc::now().to_rfc3339(), iid],
            )?;
            conn.execute(
                "UPDATE debts SET remaining = principal WHERE id = ?1",
                params![debt.id],
            )?;
            Ok(())
        })
        .unwrap();

        let fixed = svc.sync_remaining(&debt.id).unwrap();
        assert!(
            (fixed.remaining - (12000.0 - principal)).abs() < 0.05,
            "remaining={}, expected ~{}",
            fixed.remaining,
            12000.0 - principal
        );
    }

    #[test]
    fn manual_payment_reduces_remaining() {
        let dir = TempDir::new().unwrap();
        let db = Database::new(&dir.path().join("d5.db")).unwrap();
        let svc = DebtService::new(&db);
        let debt = svc
            .create(CreateDebtInput {
                name: "手动还".into(),
                creditor: None,
                principal: 10000.0,
                remaining: Some(10000.0),
                annual_rate: Some(0.0),
                start_date: None,
                due_date: None,
                note: None,
            })
            .unwrap();
        let after = svc
            .add_payment(
                &debt.id,
                CreateDebtPaymentInput {
                    amount: Some(1500.0),
                    principal_amount: None,
                    interest_amount: None,
                    paid_at: None,
                    note: Some("提前还本".into()),
                    calibrate_rate: None,
                },
            )
            .unwrap();
        assert!((after.remaining - 8500.0).abs() < 0.01);
        let synced = svc.sync_remaining(&debt.id).unwrap();
        assert!((synced.remaining - 8500.0).abs() < 0.01);
    }
}
