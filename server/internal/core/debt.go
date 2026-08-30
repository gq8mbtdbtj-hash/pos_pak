package core

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"
)

// ---- Models (aligned with models/debt.rs / api.ts) ----

type Debt struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Creditor   *string   `json:"creditor,omitempty"`
	Principal  float64   `json:"principal"`
	Remaining  float64   `json:"remaining"`
	AnnualRate float64   `json:"annualRate"`
	StartDate  *string   `json:"startDate,omitempty"`
	DueDate    *string   `json:"dueDate,omitempty"`
	Status     string    `json:"status"`
	Note       *string   `json:"note,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type DebtPayment struct {
	ID              string    `json:"id"`
	DebtID          string    `json:"debtId"`
	Amount          float64   `json:"amount"`
	PrincipalAmount *float64  `json:"principalAmount,omitempty"`
	InterestAmount  *float64  `json:"interestAmount,omitempty"`
	PaidAt          time.Time `json:"paidAt"`
	Note            *string   `json:"note,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	TransactionID   *string   `json:"transactionId,omitempty"`
}

type RepaymentInstallment struct {
	ID              string     `json:"id"`
	PlanID          string     `json:"planId"`
	Sequence        int        `json:"sequence"`
	DueDate         string     `json:"dueDate"`
	Amount          float64    `json:"amount"`
	PrincipalAmount float64    `json:"principalAmount"`
	InterestAmount  float64    `json:"interestAmount"`
	Status          string     `json:"status"`
	PaidAt          *time.Time `json:"paidAt,omitempty"`
	PaymentID       *string    `json:"paymentId,omitempty"`
}

type RepaymentPlan struct {
	ID           string                 `json:"id"`
	DebtID       string                 `json:"debtId"`
	Title        string                 `json:"title"`
	MonthlyAmount float64               `json:"monthlyAmount"`
	StartDate    string                 `json:"startDate"`
	Status       string                 `json:"status"`
	CreatedAt    time.Time              `json:"createdAt"`
	PlanMode     string                 `json:"planMode"`
	TermMonths   int                    `json:"termMonths"`
	Installments []RepaymentInstallment `json:"installments"`
}

type UpcomingInstallment struct {
	InstallmentID string  `json:"installmentId"`
	DebtID        string  `json:"debtId"`
	DebtName      string  `json:"debtName"`
	DueDate       string  `json:"dueDate"`
	Amount        float64 `json:"amount"`
	PlanTitle     string  `json:"planTitle"`
}

type DebtMetrics struct {
	PaidPrincipal          float64  `json:"paidPrincipal"`
	PaidInterest           float64  `json:"paidInterest"`
	RemainingPrincipal     float64  `json:"remainingPrincipal"`
	RemainingInterestPlanned float64 `json:"remainingInterestPlanned"`
	RemainingTotalPlanned  float64  `json:"remainingTotalPlanned"`
	MonthsToPayoff         *int     `json:"monthsToPayoff,omitempty"`
	PayoffDate             *string  `json:"payoffDate,omitempty"`
	ProgressPct            float64  `json:"progressPct"`
	NextDueAmount          *float64 `json:"nextDueAmount,omitempty"`
	NextDueDate            *string  `json:"nextDueDate,omitempty"`
}

type DebtOverview struct {
	TotalPrincipal        float64               `json:"totalPrincipal"`
	TotalRemaining        float64               `json:"totalRemaining"`
	ActiveCount           int                   `json:"activeCount"`
	MonthlyObligation     float64               `json:"monthlyObligation"`
	PaidPrincipal         *float64              `json:"paidPrincipal,omitempty"`
	PaidInterest          *float64              `json:"paidInterest,omitempty"`
	RemainingInterestPlanned *float64           `json:"remainingInterestPlanned,omitempty"`
	RemainingTotalPlanned *float64              `json:"remainingTotalPlanned,omitempty"`
	MonthsToPayoff        *int                  `json:"monthsToPayoff,omitempty"`
	PayoffDate            *string               `json:"payoffDate,omitempty"`
	Upcoming              []UpcomingInstallment `json:"upcoming"`
}

type DebtDetail struct {
	Debt     Debt          `json:"debt"`
	Payments []DebtPayment `json:"payments"`
	Plans    []RepaymentPlan `json:"plans"`
	Metrics  *DebtMetrics  `json:"metrics,omitempty"`
}

type CreateDebtInput struct {
	Name       string   `json:"name"`
	Creditor   *string  `json:"creditor,omitempty"`
	Principal  float64  `json:"principal"`
	Remaining  *float64 `json:"remaining,omitempty"`
	AnnualRate *float64 `json:"annualRate,omitempty"`
	StartDate  *string  `json:"startDate,omitempty"`
	DueDate    *string  `json:"dueDate,omitempty"`
	Note       *string  `json:"note,omitempty"`
}

type UpdateDebtInput struct {
	Name       *string  `json:"name,omitempty"`
	Creditor   *string  `json:"creditor,omitempty"`
	AnnualRate *float64 `json:"annualRate,omitempty"`
	Note       *string  `json:"note,omitempty"`
}

type CreateDebtPaymentInput struct {
	Amount          *float64 `json:"amount,omitempty"`
	PrincipalAmount *float64 `json:"principalAmount,omitempty"`
	InterestAmount  *float64 `json:"interestAmount,omitempty"`
	PaidAt          *string  `json:"paidAt,omitempty"`
	Note            *string  `json:"note,omitempty"`
	CalibrateRate   *bool    `json:"calibrateRate,omitempty"`
}

type CalibrateRateInput struct {
	MonthlyInterest float64 `json:"monthlyInterest"`
}

type CalibrateRateResult struct {
	AnnualRate  float64 `json:"annualRate"`
	MonthlyRate float64 `json:"monthlyRate"`
	Remaining   float64 `json:"remaining"`
}

type CreateRepaymentPlanInput struct {
	Title         *string  `json:"title,omitempty"`
	Mode          *string  `json:"mode,omitempty"`
	TermMonths    int      `json:"termMonths"`
	StartDate     *string  `json:"startDate,omitempty"`
	MonthlyAmount *float64 `json:"monthlyAmount,omitempty"`
}

type debtService struct{ db *DB }

func newDebtService(db *DB) *debtService { return &debtService{db: db} }

func normalizeDebtStatus(s string) string {
	switch s {
	case "paid", "paused":
		return s
	default:
		return "active"
	}
}
func normalizePlanMode(s string) string {
	if s == "interest_balloon" {
		return "interest_balloon"
	}
	return "equal_payment"
}
func planModeLabel(m string) string {
	if m == "interest_balloon" {
		return "先息后本"
	}
	return "等额本息"
}

const debtCols = `id, name, creditor, principal, remaining, annual_rate, start_date, due_date, status, note, created_at, updated_at`

func scanDebt(row interface{ Scan(dest ...any) error }) (Debt, error) {
	var (
		d                              Debt
		creditor, start, due, note     sql.NullString
		status, created, updated       string
	)
	if err := row.Scan(&d.ID, &d.Name, &creditor, &d.Principal, &d.Remaining, &d.AnnualRate, &start, &due, &status, &note, &created, &updated); err != nil {
		return Debt{}, err
	}
	d.Creditor = nullStr(creditor)
	d.StartDate = dateStrPtr(start)
	d.DueDate = dateStrPtr(due)
	d.Status = normalizeDebtStatus(status)
	d.Note = nullStr(note)
	d.CreatedAt = parseRFC3339(created)
	d.UpdatedAt = parseRFC3339(updated)
	return d, nil
}

func dateStrPtr(n sql.NullString) *string {
	if !n.Valid || n.String == "" {
		return nil
	}
	v := fmtDate(parseDate(n.String))
	return &v
}

func (s *debtService) get(id string) (Debt, error) {
	row := s.db.sql.QueryRow(`SELECT `+debtCols+` FROM debts WHERE id = ?`, id)
	d, err := scanDebt(row)
	if err == sql.ErrNoRows {
		return Debt{}, notFound("debt " + id)
	}
	return d, err
}

func (s *debtService) list() ([]Debt, error) {
	rows, err := s.db.sql.Query(`SELECT ` + debtCols + ` FROM debts
		ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Debt{}
	for rows.Next() {
		d, err := scanDebt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *debtService) overview() (DebtOverview, error) {
	if list, err := s.list(); err == nil {
		for _, d := range list {
			s.syncRemaining(d.ID)
		}
	}
	var ov DebtOverview
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(principal),0),
		        COALESCE(SUM(CASE WHEN status='active' THEN remaining ELSE 0 END),0),
		        COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0)
		 FROM debts`).Scan(&ov.TotalPrincipal, &ov.TotalRemaining, &ov.ActiveCount); err != nil {
		return ov, err
	}
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(monthly_amount),0) FROM repayment_plans WHERE status='active'`).Scan(&ov.MonthlyObligation); err != nil {
		return ov, err
	}
	var paidPrincipal, paidInterest float64
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(COALESCE(principal_amount, amount)),0), COALESCE(SUM(COALESCE(interest_amount,0)),0)
		 FROM debt_payments`).Scan(&paidPrincipal, &paidInterest); err != nil {
		return ov, err
	}
	ov.PaidPrincipal = &paidPrincipal
	ov.PaidInterest = &paidInterest
	var remInterest, remTotal float64
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(COALESCE(i.interest_amount,0)),0), COALESCE(SUM(i.amount),0)
		 FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id JOIN debts d ON d.id=p.debt_id
		 WHERE i.status='pending' AND p.status='active' AND d.status='active'`).Scan(&remInterest, &remTotal); err != nil {
		return ov, err
	}
	ov.RemainingInterestPlanned = &remInterest
	if remTotal > 0 {
		ov.RemainingTotalPlanned = &remTotal
	} else {
		ov.RemainingTotalPlanned = &ov.TotalRemaining
	}
	var maxDue sql.NullString
	var cnt int
	if err := s.db.sql.QueryRow(
		`SELECT MAX(i.due_date), COUNT(*)
		 FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id JOIN debts d ON d.id=p.debt_id
		 WHERE i.status='pending' AND p.status='active' AND d.status='active'`).Scan(&maxDue, &cnt); err != nil {
		return ov, err
	}
	if cnt > 0 && maxDue.Valid {
		ov.MonthsToPayoff = &cnt
		pd := fmtDate(parseDate(maxDue.String))
		ov.PayoffDate = &pd
	}
	horizon := fmtDate(nowUTC().AddDate(0, 0, 62))
	rows, err := s.db.sql.Query(
		`SELECT i.id, d.id, d.name, i.due_date, i.amount, p.title
		 FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id JOIN debts d ON d.id=p.debt_id
		 WHERE i.status='pending' AND p.status='active' AND d.status='active' AND i.due_date <= ?
		 ORDER BY i.due_date ASC`, horizon)
	if err != nil {
		return ov, err
	}
	defer rows.Close()
	ov.Upcoming = []UpcomingInstallment{}
	for rows.Next() {
		var u UpcomingInstallment
		var dd string
		if err := rows.Scan(&u.InstallmentID, &u.DebtID, &u.DebtName, &dd, &u.Amount, &u.PlanTitle); err != nil {
			return ov, err
		}
		u.DueDate = fmtDate(parseDate(dd))
		ov.Upcoming = append(ov.Upcoming, u)
	}
	return ov, rows.Err()
}

func (s *debtService) detail(id string) (DebtDetail, error) {
	s.syncRemaining(id)
	debt, err := s.get(id)
	if err != nil {
		return DebtDetail{}, err
	}
	payments, err := s.listPayments(id)
	if err != nil {
		return DebtDetail{}, err
	}
	plans, err := s.listPlans(id)
	if err != nil {
		return DebtDetail{}, err
	}
	metrics, err := s.metricsFor(id)
	if err != nil {
		return DebtDetail{}, err
	}
	return DebtDetail{Debt: debt, Payments: payments, Plans: plans, Metrics: &metrics}, nil
}

func (s *debtService) metricsFor(debtID string) (DebtMetrics, error) {
	debt, err := s.get(debtID)
	if err != nil {
		return DebtMetrics{}, err
	}
	var m DebtMetrics
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(COALESCE(principal_amount, amount)),0), COALESCE(SUM(COALESCE(interest_amount,0)),0)
		 FROM debt_payments WHERE debt_id = ?`, debtID).Scan(&m.PaidPrincipal, &m.PaidInterest); err != nil {
		return m, err
	}
	var remInterest, remTotal float64
	var months int
	var payoff sql.NullString
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(COALESCE(i.interest_amount,0)),0), COALESCE(SUM(i.amount),0), COUNT(*), MAX(i.due_date)
		 FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id
		 WHERE p.debt_id = ? AND i.status='pending' AND p.status='active'`, debtID).
		Scan(&remInterest, &remTotal, &months, &payoff); err != nil {
		return m, err
	}
	var nextAmt sql.NullFloat64
	var nextDue sql.NullString
	s.db.sql.QueryRow(
		`SELECT i.amount, i.due_date FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id
		 WHERE p.debt_id = ? AND i.status='pending' AND p.status='active' ORDER BY i.due_date ASC LIMIT 1`, debtID).
		Scan(&nextAmt, &nextDue)

	remPrincipal := math.Max(debt.Remaining, 0)
	m.RemainingPrincipal = remPrincipal
	m.RemainingInterestPlanned = remInterest
	if remTotal > 0 {
		m.RemainingTotalPlanned = remTotal
	} else {
		m.RemainingTotalPlanned = remPrincipal
	}
	if debt.Principal <= 0 {
		m.ProgressPct = 100
	} else {
		m.ProgressPct = math.Max(0, math.Min(100, (debt.Principal-remPrincipal)/debt.Principal*100))
	}
	if months > 0 {
		m.MonthsToPayoff = &months
	}
	if payoff.Valid {
		pd := fmtDate(parseDate(payoff.String))
		m.PayoffDate = &pd
	}
	if nextAmt.Valid {
		v := nextAmt.Float64
		m.NextDueAmount = &v
	}
	if nextDue.Valid {
		nd := fmtDate(parseDate(nextDue.String))
		m.NextDueDate = &nd
	}
	return m, nil
}

func (s *debtService) paidPrincipalTotal(debtID string) (float64, error) {
	var v float64
	err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(CASE WHEN COALESCE(principal_amount,0)=0 AND COALESCE(interest_amount,0)=0 THEN amount ELSE COALESCE(principal_amount,0) END),0)
		 FROM debt_payments WHERE debt_id = ?`, debtID).Scan(&v)
	return v, err
}

func (s *debtService) openingRemainingOf(debtID string) (float64, error) {
	var principal, remaining float64
	var opening sql.NullFloat64
	if err := s.db.sql.QueryRow(
		`SELECT principal, remaining, opening_remaining FROM debts WHERE id = ?`, debtID).
		Scan(&principal, &remaining, &opening); err != nil {
		return 0, err
	}
	o := remaining
	if opening.Valid {
		o = opening.Float64
	}
	return math.Max(0, math.Min(o, principal)), nil
}

func (s *debtService) ensureOpeningRemaining(debtID string) error {
	var opening sql.NullFloat64
	if err := s.db.sql.QueryRow(`SELECT opening_remaining FROM debts WHERE id = ?`, debtID).Scan(&opening); err != nil {
		return err
	}
	if opening.Valid {
		return nil
	}
	debt, err := s.get(debtID)
	if err != nil {
		return err
	}
	paid, err := s.paidPrincipalTotal(debtID)
	if err != nil {
		return err
	}
	var o float64
	if math.Abs(debt.Remaining-debt.Principal) < 0.01 {
		o = debt.Principal
	} else {
		o = math.Max(0, math.Min(debt.Remaining+paid, debt.Principal))
	}
	_, err = s.db.sql.Exec(`UPDATE debts SET opening_remaining = ? WHERE id = ?`, o, debtID)
	return err
}

func (s *debtService) syncRemaining(debtID string) (Debt, error) {
	if err := s.ensureOpeningRemaining(debtID); err != nil {
		return Debt{}, err
	}
	debt, err := s.get(debtID)
	if err != nil {
		return Debt{}, err
	}
	opening, err := s.openingRemainingOf(debtID)
	if err != nil {
		return Debt{}, err
	}
	paidPrincipal, err := s.paidPrincipalTotal(debtID)
	if err != nil {
		return Debt{}, err
	}
	remaining := math.Min(math.Max(opening-paidPrincipal, 0), debt.Principal)
	status := debt.Status
	if remaining <= 0 {
		status = "paid"
	} else if debt.Status == "paid" {
		status = "active"
	}
	if math.Abs(remaining-debt.Remaining) < 0.005 && status == debt.Status {
		return debt, nil
	}
	_, err = s.db.sql.Exec(`UPDATE debts SET remaining=?, status=?, updated_at=? WHERE id=?`,
		remaining, status, rfc3339(nowUTC()), debtID)
	if err != nil {
		return Debt{}, err
	}
	return s.get(debtID)
}

func (s *debtService) create(in CreateDebtInput) (Debt, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Debt{}, errf("外债名称不能为空")
	}
	if in.Principal <= 0 {
		return Debt{}, errf("本金必须大于 0")
	}
	remaining := in.Principal
	if in.Remaining != nil {
		remaining = math.Max(*in.Remaining, 0)
	}
	id := newID()
	now := nowUTC()
	status := "active"
	if remaining <= 0 {
		status = "paid"
	}
	rate := 0.0
	if in.AnnualRate != nil {
		rate = *in.AnnualRate
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return Debt{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO debts (id, name, creditor, principal, remaining, annual_rate, start_date, due_date, status, note, created_at, updated_at, opening_remaining)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, name, in.Creditor, in.Principal, remaining, rate, in.StartDate, in.DueDate, status, in.Note, rfc3339(now), rfc3339(now), remaining); err != nil {
		return Debt{}, err
	}
	content := fmt.Sprintf("%s %s %v", strOr(in.Creditor, ""), strOr(in.Note, ""), remaining)
	if err := upsertSearchIndex(tx, "debt", id, name, content); err != nil {
		return Debt{}, err
	}
	if err := tx.Commit(); err != nil {
		return Debt{}, err
	}
	return s.get(id)
}

func (s *debtService) update(id string, in UpdateDebtInput) (Debt, error) {
	debt, err := s.get(id)
	if err != nil {
		return Debt{}, err
	}
	name := debt.Name
	if in.Name != nil {
		if t := strings.TrimSpace(*in.Name); t != "" {
			name = t
		}
	}
	creditor := debt.Creditor
	if in.Creditor != nil {
		creditor = in.Creditor
	}
	rate := debt.AnnualRate
	if in.AnnualRate != nil {
		rate = math.Max(*in.AnnualRate, 0)
	}
	note := debt.Note
	if in.Note != nil {
		note = in.Note
	}
	now := nowUTC()
	tx, err := s.db.sql.Begin()
	if err != nil {
		return Debt{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`UPDATE debts SET name=?, creditor=?, annual_rate=?, note=?, updated_at=? WHERE id=?`,
		name, creditor, rate, note, rfc3339(now), id); err != nil {
		return Debt{}, err
	}
	content := fmt.Sprintf("%s %s %v", strOr(creditor, ""), strOr(note, ""), debt.Remaining)
	if err := upsertSearchIndex(tx, "debt", id, name, content); err != nil {
		return Debt{}, err
	}
	if err := tx.Commit(); err != nil {
		return Debt{}, err
	}
	return s.get(id)
}

func (s *debtService) delete(id string) error {
	tx, err := s.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tx.Exec("DELETE FROM debts WHERE id = ?", id)
	removeSearchIndex(tx, "debt", id)
	return tx.Commit()
}

func (s *debtService) calibrateRate(debtID string, in CalibrateRateInput) (CalibrateRateResult, error) {
	debt, err := s.syncRemaining(debtID)
	if err != nil {
		return CalibrateRateResult{}, err
	}
	if debt.Remaining <= 0 {
		return CalibrateRateResult{}, errf("剩余本金为 0，无法校准利率")
	}
	if in.MonthlyInterest < 0 {
		return CalibrateRateResult{}, errf("月利息不能为负")
	}
	monthlyRate := in.MonthlyInterest / debt.Remaining
	annualRate := round4(monthlyRate * 12 * 100)
	if _, err := s.update(debtID, UpdateDebtInput{AnnualRate: &annualRate}); err != nil {
		return CalibrateRateResult{}, err
	}
	return CalibrateRateResult{AnnualRate: annualRate, MonthlyRate: round6(monthlyRate * 100), Remaining: debt.Remaining}, nil
}

func (s *debtService) addPayment(debtID string, in CreateDebtPaymentInput) (Debt, error) {
	principal := math.Max(deref(in.PrincipalAmount), 0)
	interest := math.Max(deref(in.InterestAmount), 0)
	total := principal + interest
	if in.Amount != nil && *in.Amount > 0 {
		total = *in.Amount
	}
	if total <= 0 {
		return Debt{}, errf("请填写还款本金和/或利息")
	}
	var principalPart, interestPart float64
	switch {
	case principal <= 0 && interest <= 0:
		principalPart, interestPart = total, 0
	case math.Abs(principal+interest-total) > 0.05 && in.Amount != nil:
		principalPart, interestPart = principal, interest
	case principal > 0 || interest > 0:
		principalPart, interestPart = principal, interest
	default:
		principalPart, interestPart = total, 0
	}
	total = math.Max(principalPart+interestPart, total)

	debt, err := s.syncRemaining(debtID)
	if err != nil {
		return Debt{}, err
	}
	if in.CalibrateRate != nil && *in.CalibrateRate && interestPart > 0 && debt.Remaining > 0 {
		annualRate := round4(interestPart / debt.Remaining * 12 * 100)
		s.update(debtID, UpdateDebtInput{AnnualRate: &annualRate})
	}
	note := in.Note
	if note == nil {
		var n string
		if interestPart > 0 && principalPart > 0 {
			n = fmt.Sprintf("本金 ¥%.2f + 利息 ¥%.2f", principalPart, interestPart)
		} else if interestPart > 0 {
			n = fmt.Sprintf("利息 ¥%.2f", interestPart)
		} else {
			n = "手动还本"
		}
		note = &n
	}
	return s.addPaymentSplit(debtID, total, principalPart, interestPart, in.PaidAt, note)
}

func (s *debtService) addPaymentSplit(debtID string, totalAmount, principalPart, interestPart float64, paidAt, note *string) (Debt, error) {
	if totalAmount <= 0 {
		return Debt{}, errf("还款金额必须大于 0")
	}
	debt, err := s.get(debtID)
	if err != nil {
		return Debt{}, err
	}
	paymentID := newID()
	now := nowUTC()
	paidAtDT := now
	if paidAt != nil {
		if t := parseDatetimeOpt(*paidAt); t != nil {
			paidAtDT = *t
		}
	}
	principalPart = math.Max(0, math.Min(principalPart, totalAmount))
	interestPart = math.Max(interestPart, 0)

	fin := newFinanceService(s.db)
	merchant := debt.Name
	txNote := fmt.Sprintf("外债「%s」%s", debt.Name, strOr(note, ""))
	tags := []string{"外债", debt.Name}
	expenseType := "expense"
	cat := "外债还款"
	tx, err := fin.create(CreateTransactionInput{
		Amount: totalAmount, TransactionType: &expenseType, Category: &cat,
		Merchant: &merchant, Note: &txNote, OccurredAt: &paidAtDT, Tags: &tags,
	})
	if err != nil {
		return Debt{}, err
	}

	dtx, err := s.db.sql.Begin()
	if err != nil {
		return Debt{}, err
	}
	defer dtx.Rollback()
	if _, err := dtx.Exec(
		`INSERT INTO debt_payments (id, debt_id, amount, paid_at, note, created_at, principal_amount, interest_amount, transaction_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		paymentID, debtID, totalAmount, rfc3339(paidAtDT), note, rfc3339(now), principalPart, interestPart, tx.ID); err != nil {
		return Debt{}, err
	}
	remaining := math.Max(debt.Remaining-principalPart, 0)
	status := debt.Status
	if remaining <= 0 {
		status = "paid"
	}
	if _, err := dtx.Exec(`UPDATE debts SET remaining=?, status=?, updated_at=? WHERE id=?`,
		remaining, status, rfc3339(now), debtID); err != nil {
		return Debt{}, err
	}
	if err := dtx.Commit(); err != nil {
		return Debt{}, err
	}
	return s.get(debtID)
}

func (s *debtService) listPayments(debtID string) ([]DebtPayment, error) {
	rows, err := s.db.sql.Query(
		`SELECT id, debt_id, amount, paid_at, note, created_at, COALESCE(principal_amount, amount), COALESCE(interest_amount,0), transaction_id
		 FROM debt_payments WHERE debt_id = ? ORDER BY paid_at DESC`, debtID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DebtPayment{}
	for rows.Next() {
		var (
			p           DebtPayment
			note, txID  sql.NullString
			paidAt, cr  string
			princ, intr float64
		)
		if err := rows.Scan(&p.ID, &p.DebtID, &p.Amount, &paidAt, &note, &cr, &princ, &intr, &txID); err != nil {
			return nil, err
		}
		p.PaidAt = parseRFC3339(paidAt)
		p.Note = nullStr(note)
		p.CreatedAt = parseRFC3339(cr)
		p.PrincipalAmount = &princ
		p.InterestAmount = &intr
		p.TransactionID = nullStr(txID)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *debtService) listPlans(debtID string) ([]RepaymentPlan, error) {
	rows, err := s.db.sql.Query(`SELECT id FROM repayment_plans WHERE debt_id = ? ORDER BY created_at DESC`, debtID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := []RepaymentPlan{}
	for _, id := range ids {
		p, err := s.getPlan(id)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *debtService) getPlan(planID string) (RepaymentPlan, error) {
	var (
		p         RepaymentPlan
		startDate string
		created   string
		mode      string
	)
	err := s.db.sql.QueryRow(
		`SELECT id, debt_id, title, monthly_amount, start_date, status, created_at, COALESCE(plan_mode,'equal_payment'), COALESCE(term_months,0)
		 FROM repayment_plans WHERE id = ?`, planID).
		Scan(&p.ID, &p.DebtID, &p.Title, &p.MonthlyAmount, &startDate, &p.Status, &created, &mode, &p.TermMonths)
	if err == sql.ErrNoRows {
		return RepaymentPlan{}, notFound("plan " + planID)
	}
	if err != nil {
		return RepaymentPlan{}, err
	}
	p.StartDate = fmtDate(parseDate(startDate))
	p.CreatedAt = parseRFC3339(created)
	p.PlanMode = normalizePlanMode(mode)
	rows, err := s.db.sql.Query(
		`SELECT id, plan_id, sequence, due_date, amount, status, paid_at, payment_id, COALESCE(principal_amount,0), COALESCE(interest_amount,0)
		 FROM repayment_installments WHERE plan_id = ? ORDER BY sequence ASC`, planID)
	if err != nil {
		return RepaymentPlan{}, err
	}
	defer rows.Close()
	p.Installments = []RepaymentInstallment{}
	for rows.Next() {
		var (
			it            RepaymentInstallment
			due           string
			paidAt, payID sql.NullString
		)
		if err := rows.Scan(&it.ID, &it.PlanID, &it.Sequence, &due, &it.Amount, &it.Status, &paidAt, &payID, &it.PrincipalAmount, &it.InterestAmount); err != nil {
			return RepaymentPlan{}, err
		}
		it.DueDate = fmtDate(parseDate(due))
		it.PaidAt = nullTime(paidAt)
		it.PaymentID = nullStr(payID)
		p.Installments = append(p.Installments, it)
	}
	return p, rows.Err()
}

type scheduleItem struct {
	dueDate   time.Time
	principal float64
	interest  float64
}

func buildSchedule(mode string, principal, annualRate float64, termMonths int, start time.Time) (float64, []scheduleItem, error) {
	if mode == "interest_balloon" {
		monthlyRate := annualRate / 100 / 12
		interest := round2(principal * monthlyRate)
		if interest <= 0 {
			return 0, nil, errf("根据年利率算出的月利息为 0，请检查利率")
		}
		var items []scheduleItem
		date := start
		for seq := 1; seq <= termMonths; seq++ {
			if seq < termMonths {
				items = append(items, scheduleItem{dueDate: date, principal: 0, interest: interest})
			} else {
				items = append(items, scheduleItem{dueDate: date, principal: round2(principal), interest: interest})
			}
			date = addMonths(date, 1)
		}
		return interest, items, nil
	}
	// equal_payment
	n := float64(termMonths)
	r := annualRate / 100 / 12
	var payment float64
	if math.Abs(r) < 1e-12 {
		payment = round2(principal / n)
	} else {
		factor := math.Pow(1+r, n)
		payment = round2(principal * r * factor / (factor - 1))
	}
	if payment <= 0 {
		return 0, nil, errf("无法计算月供，请检查本金与期数")
	}
	balance := principal
	var items []scheduleItem
	date := start
	for seq := 1; seq <= termMonths; seq++ {
		interest := round2(balance * r)
		var principalPart float64
		if seq == termMonths {
			principalPart = round2(balance)
		} else {
			principalPart = round2(math.Max(payment-interest, 0))
		}
		if principalPart > balance {
			principalPart = round2(balance)
		}
		items = append(items, scheduleItem{dueDate: date, principal: principalPart, interest: interest})
		balance = math.Max(balance-principalPart, 0)
		date = addMonths(date, 1)
	}
	return payment, items, nil
}

func (s *debtService) createPlan(debtID string, in CreateRepaymentPlanInput) (RepaymentPlan, error) {
	debt, err := s.get(debtID)
	if err != nil {
		return RepaymentPlan{}, err
	}
	if debt.Remaining <= 0 {
		return RepaymentPlan{}, errf("该外债已结清，无需还款计划")
	}
	if in.TermMonths < 1 || in.TermMonths > 360 {
		return RepaymentPlan{}, errf("期数需在 1～360 个月之间")
	}
	mode := normalizePlanMode(strOr(in.Mode, "equal_payment"))
	if debt.AnnualRate <= 0 && mode == "interest_balloon" {
		return RepaymentPlan{}, errf("先息后本需要年利率：请先在外债上填写年利率")
	}
	start := localToday()
	if in.StartDate != nil {
		if t, ok := parseDateOpt(*in.StartDate); ok {
			start = t
		}
	}
	monthlyAmount, items, err := buildSchedule(mode, debt.Remaining, debt.AnnualRate, in.TermMonths, start)
	if err != nil {
		return RepaymentPlan{}, err
	}
	title := strOr(in.Title, "")
	if title == "" {
		title = fmt.Sprintf("%s · %d期 · %s", planModeLabel(mode), in.TermMonths, debt.Name)
	}
	planID := newID()
	now := nowUTC()
	tx, err := s.db.sql.Begin()
	if err != nil {
		return RepaymentPlan{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE repayment_plans SET status='cancelled' WHERE debt_id=? AND status='active'`, debtID); err != nil {
		return RepaymentPlan{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO repayment_plans (id, debt_id, title, monthly_amount, start_date, status, created_at, plan_mode, term_months)
		 VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
		planID, debtID, title, monthlyAmount, fmtDate(start), rfc3339(now), mode, in.TermMonths); err != nil {
		return RepaymentPlan{}, err
	}
	for idx, item := range items {
		if _, err := tx.Exec(
			`INSERT INTO repayment_installments (id, plan_id, sequence, due_date, amount, status, paid_at, payment_id, principal_amount, interest_amount)
			 VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
			newID(), planID, idx+1, fmtDate(item.dueDate), round2(item.principal+item.interest), round2(item.principal), round2(item.interest)); err != nil {
			return RepaymentPlan{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return RepaymentPlan{}, err
	}
	plan, err := s.getPlan(planID)
	if err != nil {
		return RepaymentPlan{}, err
	}
	s.syncRepaymentReminders()
	return plan, nil
}

func (s *debtService) payInstallment(installmentID string) (DebtDetail, error) {
	var (
		planID, debtID, status  string
		amount, princ, intr     float64
	)
	err := s.db.sql.QueryRow(
		`SELECT i.plan_id, p.debt_id, i.amount, COALESCE(i.principal_amount,0), COALESCE(i.interest_amount,0), i.status
		 FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id WHERE i.id = ?`, installmentID).
		Scan(&planID, &debtID, &amount, &princ, &intr, &status)
	if err == sql.ErrNoRows {
		return DebtDetail{}, notFound("installment " + installmentID)
	}
	if err != nil {
		return DebtDetail{}, err
	}
	if status == "paid" {
		return s.detail(debtID)
	}
	if amount <= 0 {
		return DebtDetail{}, errf("分期金额无效")
	}
	note := "按计划还本金"
	if princ <= 0 {
		note = "按计划还息"
	} else if intr > 0 {
		note = "按计划还本息"
	}
	debt, err := s.addPaymentSplit(debtID, amount, princ, intr, nil, &note)
	if err != nil {
		return DebtDetail{}, err
	}
	var paymentID *string
	if pays, err := s.listPayments(debtID); err == nil && len(pays) > 0 {
		paymentID = &pays[0].ID
	}
	now := nowUTC()
	tx, err := s.db.sql.Begin()
	if err != nil {
		return DebtDetail{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE repayment_installments SET status='paid', paid_at=?, payment_id=? WHERE id=?`,
		rfc3339(now), paymentID, installmentID); err != nil {
		return DebtDetail{}, err
	}
	var pending int
	tx.QueryRow(`SELECT COUNT(*) FROM repayment_installments WHERE plan_id=? AND status='pending'`, planID).Scan(&pending)
	if pending == 0 || debt.Remaining <= 0 {
		tx.Exec(`UPDATE repayment_plans SET status='completed' WHERE id=?`, planID)
	}
	if err := tx.Commit(); err != nil {
		return DebtDetail{}, err
	}
	detail, err := s.detail(debtID)
	if err != nil {
		return DebtDetail{}, err
	}
	s.syncRepaymentReminders()
	return detail, nil
}

// syncRepaymentReminders: one reminder task per pending installment within ~1 month.
func (s *debtService) syncRepaymentReminders() error {
	tasks := newTaskService(s.db)
	type pend struct {
		id, name string
		due      time.Time
		amount   float64
	}
	rows, err := s.db.sql.Query(
		`SELECT i.id, d.name, i.due_date, i.amount
		 FROM repayment_installments i JOIN repayment_plans p ON p.id=i.plan_id JOIN debts d ON d.id=p.debt_id
		 WHERE i.status='pending' AND p.status='active' AND d.status='active'`)
	if err != nil {
		return err
	}
	var pending []pend
	for rows.Next() {
		var p pend
		var dd string
		if err := rows.Scan(&p.id, &p.name, &dd, &p.amount); err != nil {
			rows.Close()
			return err
		}
		p.due = parseDate(dd)
		pending = append(pending, p)
	}
	rows.Close()

	activeIDs := map[string]bool{}
	for _, p := range pending {
		activeIDs[p.id] = true
	}
	// Drop orphan reminders.
	orphans, err := s.tagPairs("debt-remind:%")
	if err != nil {
		return err
	}
	for _, o := range orphans {
		iid := strings.TrimPrefix(o.tag, "debt-remind:")
		if idx := strings.IndexByte(iid, ':'); idx >= 0 {
			iid = iid[:idx]
		}
		if iid == "" || !activeIDs[iid] {
			tasks.delete(o.taskID)
		}
	}

	today := localToday()
	horizon := today.AddDate(0, 0, 31)
	for _, p := range pending {
		tag := "debt-remind:" + p.id
		dueTag := "debt-due:" + fmtDate(p.due)
		if p.due.After(horizon) {
			if id, ok, _ := tasks.findIDByTag(tag); ok {
				tasks.delete(id)
			}
			continue
		}
		daysLeft := int(p.due.Sub(today).Hours() / 24)
		if daysLeft < -30 {
			if id, ok, _ := tasks.findIDByTag(tag); ok {
				tasks.delete(id)
			}
			continue
		}
		priority := priorityFromDaysUntilDue(daysLeft)
		title := fmt.Sprintf("还款提醒 · %s · ¥%.2f", p.name, p.amount)
		desc := fmt.Sprintf("外债「%s」应还日 %s，金额 ¥%.2f。请按时还款。", p.name, fmtDate(p.due), p.amount)
		dueAt := localRemindAt(p.due)
		tags := []string{tag, dueTag, "还款提醒", "周期批量"}
		if id, ok, _ := tasks.findIDByTag(tag); ok {
			ex, err := tasks.get(id)
			if err == nil && (ex.Status == "done" || ex.Status == "cancelled") {
				continue
			}
			dp := desc
			tasks.update(id, UpdateTaskInput{Title: &title, Description: &dp, descSet: true, DueAt: &dueAt, dueSet: true, Priority: &priority, Tags: &tags})
		} else {
			dp := desc
			tasks.create(CreateTaskInput{Title: title, Description: &dp, Priority: &priority, DueAt: &dueAt, Tags: &tags})
		}
	}
	return nil
}

func (s *debtService) tagPairs(like string) ([]tagTaskPair, error) {
	rows, err := s.db.sql.Query(
		`SELECT tt.task_id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name LIKE ?`, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []tagTaskPair
	for rows.Next() {
		var p tagTaskPair
		if err := rows.Scan(&p.taskID, &p.tag); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func localRemindAt(due time.Time) time.Time {
	n := time.Date(due.Year(), due.Month(), due.Day(), 17, 0, 0, 0, time.Local)
	return n.UTC()
}

func deref(v any, def ...float64) float64 {
	switch x := v.(type) {
	case *float64:
		if x != nil {
			return *x
		}
	}
	if len(def) > 0 {
		return def[0]
	}
	return 0
}

func parseDatetimeOpt(s string) *time.Time {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		u := t.UTC()
		return &u
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		u := t.UTC()
		return &u
	}
	if t, ok := parseDateOpt(s); ok {
		u := time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.UTC)
		return &u
	}
	return nil
}
