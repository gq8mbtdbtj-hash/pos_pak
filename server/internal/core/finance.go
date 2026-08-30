package core

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---- Models (camelCase, aligned with models/finance.rs) ----

type Transaction struct {
	ID              string    `json:"id"`
	Amount          float64   `json:"amount"`
	TransactionType string    `json:"transactionType"`
	Category        string    `json:"category"`
	Account         *string   `json:"account,omitempty"`
	Merchant        *string   `json:"merchant,omitempty"`
	Note            *string   `json:"note,omitempty"`
	OccurredAt      time.Time `json:"occurredAt"`
	CreatedAt       time.Time `json:"createdAt"`
	Tags            []string  `json:"tags"`
}

type MoneyFlow struct {
	Income  float64 `json:"income"`
	Expense float64 `json:"expense"`
}

type TxHighlight struct {
	ID         string    `json:"id"`
	Amount     float64   `json:"amount"`
	Category   string    `json:"category"`
	Label      string    `json:"label"`
	OccurredAt time.Time `json:"occurredAt"`
}

type ChartBucket struct {
	Label      string        `json:"label"`
	Income     float64       `json:"income"`
	Expense    float64       `json:"expense"`
	TopIncome  []TxHighlight `json:"topIncome"`
	TopExpense []TxHighlight `json:"topExpense"`
}

type CategorySum struct {
	Category string        `json:"category"`
	Amount   float64       `json:"amount"`
	Top      []TxHighlight `json:"top"`
}

type PayPeriodGlance struct {
	Opening           *float64 `json:"opening"`
	OpeningPeriodLabel *string `json:"openingPeriodLabel"`
	OpeningMissing    bool     `json:"openingMissing"`
	PeriodFlow        float64  `json:"periodFlow"`
	Effective         float64  `json:"effective"`
	DueThisPeriod     float64  `json:"dueThisPeriod"`
	AfterDebts        float64  `json:"afterDebts"`
}

type PayPeriodPending struct {
	PeriodStart string  `json:"periodStart"`
	PeriodEnd   string  `json:"periodEnd"`
	PeriodLabel string  `json:"periodLabel"`
	Income      float64 `json:"income"`
	Expense     float64 `json:"expense"`
	Net         float64 `json:"net"`
}

type PayPeriodSnapshot struct {
	ID          string    `json:"id"`
	PeriodStart string    `json:"periodStart"`
	PeriodEnd   string    `json:"periodEnd"`
	PeriodLabel string    `json:"periodLabel"`
	Income      float64   `json:"income"`
	Expense     float64   `json:"expense"`
	Net         float64   `json:"net"`
	ConfirmedAt time.Time `json:"confirmedAt"`
	Note        *string   `json:"note,omitempty"`
}

type FinanceSummary struct {
	Today               MoneyFlow           `json:"today"`
	Week                MoneyFlow           `json:"week"`
	Month               MoneyFlow           `json:"month"`
	PayPeriod           MoneyFlow           `json:"payPeriod"`
	PayPeriodLabel      string              `json:"payPeriodLabel"`
	PayPeriodGlance     PayPeriodGlance     `json:"payPeriodGlance"`
	ByCategory          []CategorySum       `json:"byCategory"`
	CategoryDay         []CategorySum       `json:"categoryDay"`
	CategoryWeek        []CategorySum       `json:"categoryWeek"`
	CategoryMonth       []CategorySum       `json:"categoryMonth"`
	ChartDay            []ChartBucket       `json:"chartDay"`
	ChartWeek           []ChartBucket       `json:"chartWeek"`
	ChartMonth          []ChartBucket       `json:"chartMonth"`
	DebtRepaymentMonth  float64             `json:"debtRepaymentMonth"`
	DebtRemaining       float64             `json:"debtRemaining"`
	DebtMonthlyObligation float64           `json:"debtMonthlyObligation"`
	PendingSnapshot     *PayPeriodPending   `json:"pendingSnapshot"`
	Snapshots           []PayPeriodSnapshot `json:"snapshots"`
}

type CreateTransactionInput struct {
	Amount          float64    `json:"amount"`
	TransactionType *string    `json:"transactionType,omitempty"`
	Category        *string    `json:"category,omitempty"`
	Account         *string    `json:"account,omitempty"`
	Merchant        *string    `json:"merchant,omitempty"`
	Note            *string    `json:"note,omitempty"`
	OccurredAt      *time.Time `json:"occurredAt,omitempty"`
	Tags            *[]string  `json:"tags,omitempty"`
}

type UpdateTransactionInput struct {
	Amount          *float64  `json:"amount,omitempty"`
	TransactionType *string   `json:"transactionType,omitempty"`
	Category        *string   `json:"category,omitempty"`
	Account         *string   `json:"account,omitempty"`
	Merchant        *string   `json:"merchant,omitempty"`
	Note            *string   `json:"note,omitempty"`
	Tags            *[]string `json:"tags,omitempty"`
}

var defaultCategories = []string{
	"餐饮", "交通", "通讯", "购物", "娱乐", "住房", "医疗", "学习", "旅行", "外债还款", "收入", "其他",
}

type financeService struct{ db *DB }

func newFinanceService(db *DB) *financeService { return &financeService{db: db} }

func normalizeTxType(s string) string {
	switch s {
	case "income", "transfer":
		return s
	default:
		return "expense"
	}
}

func (s *financeService) create(in CreateTransactionInput) (Transaction, error) {
	id := newID()
	now := nowUTC()
	txType := "expense"
	if in.TransactionType != nil {
		txType = normalizeTxType(*in.TransactionType)
	}
	category := "其他"
	if in.Category != nil && *in.Category != "" {
		category = *in.Category
	}
	occurred := now
	if in.OccurredAt != nil {
		occurred = in.OccurredAt.UTC()
	}
	tags := []string{}
	if in.Tags != nil {
		tags = *in.Tags
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return Transaction{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO transactions (id, amount, type, category, account, merchant, note, occurred_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Amount, txType, category, in.Account, in.Merchant, in.Note, rfc3339(occurred), rfc3339(now)); err != nil {
		return Transaction{}, err
	}
	if err := setEntityTags(tx, "transaction_tags", "transaction_id", id, tags); err != nil {
		return Transaction{}, err
	}
	searchContent := fmt.Sprintf("%s %s %s", category, strOr(in.Merchant, ""), strOr(in.Note, ""))
	if err := upsertSearchIndex(tx, "transaction", id, fmt.Sprintf("%s ¥%v", category, in.Amount), searchContent); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.get(id)
}

func (s *financeService) quickAdd(text string) (Transaction, error) {
	parsed := parseQuickFinances(text)
	if len(parsed) == 0 {
		return Transaction{}, errf("无法识别金额")
	}
	var last Transaction
	for _, in := range parsed {
		t, err := s.create(in)
		if err != nil {
			return Transaction{}, err
		}
		last = t
	}
	return last, nil
}

func (s *financeService) get(id string) (Transaction, error) {
	var (
		t                              Transaction
		account, merchant, note        sql.NullString
		occurred, created, txType, cat string
	)
	err := s.db.sql.QueryRow(
		`SELECT id, amount, type, category, account, merchant, note, occurred_at, created_at
		 FROM transactions WHERE id = ?`, id).
		Scan(&t.ID, &t.Amount, &txType, &cat, &account, &merchant, &note, &occurred, &created)
	if err == sql.ErrNoRows {
		return Transaction{}, notFound("transaction " + id)
	}
	if err != nil {
		return Transaction{}, err
	}
	t.TransactionType = normalizeTxType(txType)
	t.Category = cat
	t.Account = nullStr(account)
	t.Merchant = nullStr(merchant)
	t.Note = nullStr(note)
	t.OccurredAt = parseRFC3339(occurred)
	t.CreatedAt = parseRFC3339(created)
	tags, err := getEntityTags(s.db.sql, "transaction_tags", "transaction_id", id)
	if err != nil {
		return Transaction{}, err
	}
	t.Tags = tags
	return t, nil
}

func (s *financeService) list(limit *int) ([]Transaction, error) {
	q := `SELECT id, amount, type, category, account, merchant, note, occurred_at, created_at
	      FROM transactions ORDER BY occurred_at DESC`
	if limit != nil {
		q += fmt.Sprintf(" LIMIT %d", *limit)
	}
	rows, err := s.db.sql.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var staged []Transaction
	for rows.Next() {
		var (
			t                              Transaction
			account, merchant, note        sql.NullString
			occurred, created, txType, cat string
		)
		if err := rows.Scan(&t.ID, &t.Amount, &txType, &cat, &account, &merchant, &note, &occurred, &created); err != nil {
			return nil, err
		}
		t.TransactionType = normalizeTxType(txType)
		t.Category = cat
		t.Account = nullStr(account)
		t.Merchant = nullStr(merchant)
		t.Note = nullStr(note)
		t.OccurredAt = parseRFC3339(occurred)
		t.CreatedAt = parseRFC3339(created)
		staged = append(staged, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []Transaction{}
	for _, t := range staged {
		tags, err := getEntityTags(s.db.sql, "transaction_tags", "transaction_id", t.ID)
		if err != nil {
			return nil, err
		}
		t.Tags = tags
		out = append(out, t)
	}
	return out, nil
}

func (s *financeService) update(id string, in UpdateTransactionInput) (Transaction, error) {
	existing, err := s.get(id)
	if err != nil {
		return Transaction{}, err
	}
	amount := existing.Amount
	if in.Amount != nil {
		amount = *in.Amount
	}
	txType := existing.TransactionType
	if in.TransactionType != nil {
		txType = normalizeTxType(*in.TransactionType)
	}
	category := existing.Category
	if in.Category != nil {
		c := strings.TrimSpace(*in.Category)
		if c != "" {
			category = c
		}
	}
	account := existing.Account
	if in.Account != nil {
		account = in.Account
	}
	merchant := existing.Merchant
	if in.Merchant != nil {
		merchant = in.Merchant
	}
	note := existing.Note
	if in.Note != nil {
		note = in.Note
	}
	tags := existing.Tags
	if in.Tags != nil {
		tags = *in.Tags
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return Transaction{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`UPDATE transactions SET amount=?, type=?, category=?, account=?, merchant=?, note=? WHERE id=?`,
		amount, txType, category, account, merchant, note, id); err != nil {
		return Transaction{}, err
	}
	if err := setEntityTags(tx, "transaction_tags", "transaction_id", id, tags); err != nil {
		return Transaction{}, err
	}
	searchContent := fmt.Sprintf("%s %s %s", category, strOr(merchant, ""), strOr(note, ""))
	if err := upsertSearchIndex(tx, "transaction", id, fmt.Sprintf("%s ¥%v", category, amount), searchContent); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.get(id)
}

func (s *financeService) delete(id string) error {
	tx, err := s.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM transactions WHERE id = ?", id); err != nil {
		return err
	}
	if err := removeSearchIndex(tx, "transaction", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *financeService) listCategories() ([]string, error) {
	cats := append([]string{}, defaultCategories...)
	rows, err := s.db.sql.Query(
		`SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND TRIM(category) != '' ORDER BY category`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		found := false
		for _, x := range cats {
			if x == c {
				found = true
				break
			}
		}
		if !found {
			cats = append(cats, c)
		}
	}
	return cats, rows.Err()
}

// ---- date helpers over UTC instants used by summary ----

func utcMidnight(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func lastDayOfMonthUTC(t time.Time) time.Time {
	firstNext := time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	return firstNext.AddDate(0, 0, -1)
}

func (s *financeService) sumFlowSince(since string) (MoneyFlow, error) {
	var mf MoneyFlow
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='income' AND occurred_at >= ?`, since).
		Scan(&mf.Income); err != nil {
		return mf, err
	}
	err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='expense' AND occurred_at >= ?`, since).
		Scan(&mf.Expense)
	return mf, err
}

func (s *financeService) sumFlowBetween(start, end string) (MoneyFlow, error) {
	var mf MoneyFlow
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='income' AND occurred_at >= ? AND occurred_at < ?`,
		start, end).Scan(&mf.Income); err != nil {
		return mf, err
	}
	err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='expense' AND occurred_at >= ? AND occurred_at < ?`,
		start, end).Scan(&mf.Expense)
	return mf, err
}

func (s *financeService) todaySpending() (float64, error) {
	sum, err := s.summary(1)
	if err != nil {
		return 0, err
	}
	return sum.Today.Expense, nil
}

func (s *financeService) summary(payday int) (FinanceSummary, error) {
	payday = clampInt(payday, 1, 28)
	now := nowUTC()
	todayDate := utcMidnight(now)
	weekOffset := (int(todayDate.Weekday()) + 6) % 7
	weekStartDate := todayDate.AddDate(0, 0, -weekOffset)
	monthStartDate := time.Date(todayDate.Year(), todayDate.Month(), 1, 0, 0, 0, 0, time.UTC)
	tomorrow := todayDate.AddDate(0, 0, 1)
	weekEnd := weekStartDate.AddDate(0, 0, 7)
	monthEnd := lastDayOfMonthUTC(todayDate).AddDate(0, 0, 1)

	localNow := time.Now()
	localToday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.Local)
	periodStart, periodEnd := payPeriodBounds(localToday, payday)
	periodStartDT := time.Date(periodStart.Year(), periodStart.Month(), periodStart.Day(), 0, 0, 0, 0, time.UTC)
	periodEndDT := time.Date(periodEnd.Year(), periodEnd.Month(), periodEnd.Day(), 0, 0, 0, 0, time.UTC)
	payPeriodLabel := periodLabel(periodStart, periodEnd)

	todayFlow, err := s.sumFlowSince(rfc3339(todayDate))
	if err != nil {
		return FinanceSummary{}, err
	}
	weekFlow, err := s.sumFlowSince(rfc3339(weekStartDate))
	if err != nil {
		return FinanceSummary{}, err
	}
	monthFlow, err := s.sumFlowSince(rfc3339(monthStartDate))
	if err != nil {
		return FinanceSummary{}, err
	}
	payPeriod, err := s.sumFlowBetween(rfc3339(periodStartDT), rfc3339(periodEndDT))
	if err != nil {
		return FinanceSummary{}, err
	}

	categoryDay, err := s.categoryBreakdown(todayDate, tomorrow)
	if err != nil {
		return FinanceSummary{}, err
	}
	categoryWeek, err := s.categoryBreakdown(weekStartDate, weekEnd)
	if err != nil {
		return FinanceSummary{}, err
	}
	categoryMonth, err := s.categoryBreakdown(monthStartDate, monthEnd)
	if err != nil {
		return FinanceSummary{}, err
	}
	chartDay, err := s.chartHoursToday(todayDate)
	if err != nil {
		return FinanceSummary{}, err
	}
	chartWeek, err := s.chartDays(weekStartDate, 7)
	if err != nil {
		return FinanceSummary{}, err
	}
	daysInMon := int(lastDayOfMonthUTC(todayDate).Day())
	chartMonth, err := s.chartDays(monthStartDate, daysInMon)
	if err != nil {
		return FinanceSummary{}, err
	}

	var debtRepaymentMonth float64
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(amount),0) FROM transactions
		 WHERE type='expense' AND category='外债还款' AND occurred_at >= ? AND occurred_at < ?`,
		rfc3339(monthStartDate), rfc3339(monthEnd)).Scan(&debtRepaymentMonth); err != nil {
		return FinanceSummary{}, err
	}
	var debtRemaining, debtMonthly float64
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(remaining),0) FROM debts WHERE status='active'`).Scan(&debtRemaining); err != nil {
		return FinanceSummary{}, err
	}
	if err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(monthly_amount),0) FROM repayment_plans WHERE status='active'`).Scan(&debtMonthly); err != nil {
		return FinanceSummary{}, err
	}

	pending, snapshots, err := s.snapshotStatus(payday, localToday)
	if err != nil {
		return FinanceSummary{}, err
	}

	periodFlow := payPeriod.Income - payPeriod.Expense
	prevStart, _ := previousPayPeriod(localToday, payday)
	prevKey := fmtDate(prevStart)
	var opening *float64
	var openingLabel *string
	for i := range snapshots {
		if snapshots[i].PeriodStart == prevKey {
			v := snapshots[i].Net
			opening = &v
			l := snapshots[i].PeriodLabel
			openingLabel = &l
			break
		}
	}
	openingMissing := opening == nil
	openingVal := 0.0
	if opening != nil {
		openingVal = *opening
	}
	effective := openingVal + periodFlow
	dueThisPeriod, err := s.dueInstallmentsInPeriod(periodStart, periodEnd)
	if err != nil {
		return FinanceSummary{}, err
	}
	afterDebts := effective - dueThisPeriod

	return FinanceSummary{
		Today:          todayFlow,
		Week:           weekFlow,
		Month:          monthFlow,
		PayPeriod:      payPeriod,
		PayPeriodLabel: payPeriodLabel,
		PayPeriodGlance: PayPeriodGlance{
			Opening:            opening,
			OpeningPeriodLabel: openingLabel,
			OpeningMissing:     openingMissing,
			PeriodFlow:         periodFlow,
			Effective:          effective,
			DueThisPeriod:      dueThisPeriod,
			AfterDebts:         afterDebts,
		},
		ByCategory:            categoryMonth,
		CategoryDay:           categoryDay,
		CategoryWeek:          categoryWeek,
		CategoryMonth:         categoryMonth,
		ChartDay:              chartDay,
		ChartWeek:             chartWeek,
		ChartMonth:            chartMonth,
		DebtRepaymentMonth:    debtRepaymentMonth,
		DebtRemaining:         debtRemaining,
		DebtMonthlyObligation: debtMonthly,
		PendingSnapshot:       pending,
		Snapshots:             snapshots,
	}, nil
}

func (s *financeService) dueInstallmentsInPeriod(periodStart, periodEnd time.Time) (float64, error) {
	var v float64
	err := s.db.sql.QueryRow(
		`SELECT COALESCE(SUM(amount),0) FROM repayment_installments
		 WHERE status != 'paid' AND due_date >= ? AND due_date < ?`,
		fmtDate(periodStart), fmtDate(periodEnd)).Scan(&v)
	return v, err
}

type txRow struct {
	id         string
	amount     float64
	txType     string
	category   string
	merchant   *string
	note       *string
	occurredAt time.Time
}

func (r txRow) toHighlight() TxHighlight {
	label := r.category
	if r.merchant != nil && strings.TrimSpace(*r.merchant) != "" {
		label = *r.merchant
	} else if r.note != nil && strings.TrimSpace(*r.note) != "" {
		label = *r.note
	}
	return TxHighlight{ID: r.id, Amount: r.amount, Category: r.category, Label: label, OccurredAt: r.occurredAt}
}

func (s *financeService) listTxBetween(start, end time.Time) ([]txRow, error) {
	rows, err := s.db.sql.Query(
		`SELECT id, amount, type, category, merchant, note, occurred_at FROM transactions
		 WHERE occurred_at >= ? AND occurred_at < ?`, rfc3339(start), rfc3339(end))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []txRow
	for rows.Next() {
		var (
			r              txRow
			merchant, note sql.NullString
			occurred       string
		)
		if err := rows.Scan(&r.id, &r.amount, &r.txType, &r.category, &merchant, &note, &occurred); err != nil {
			return nil, err
		}
		r.merchant = nullStr(merchant)
		r.note = nullStr(note)
		r.occurredAt = parseRFC3339(occurred)
		out = append(out, r)
	}
	return out, rows.Err()
}

func pushTop(list []TxHighlight, item TxHighlight, limit int) []TxHighlight {
	list = append(list, item)
	sort.SliceStable(list, func(i, j int) bool { return list[i].Amount > list[j].Amount })
	if len(list) > limit {
		list = list[:limit]
	}
	return list
}

func (s *financeService) categoryBreakdown(start, end time.Time) ([]CategorySum, error) {
	rows, err := s.listTxBetween(start, end)
	if err != nil {
		return nil, err
	}
	type agg struct {
		amount float64
		top    []TxHighlight
	}
	m := map[string]*agg{}
	for _, r := range rows {
		if r.txType != "expense" {
			continue
		}
		a := m[r.category]
		if a == nil {
			a = &agg{}
			m[r.category] = a
		}
		a.amount += r.amount
		a.top = pushTop(a.top, r.toHighlight(), 12)
	}
	out := []CategorySum{}
	for cat, a := range m {
		top := a.top
		if top == nil {
			top = []TxHighlight{}
		}
		out = append(out, CategorySum{Category: cat, Amount: a.amount, Top: top})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Amount > out[j].Amount })
	return out, nil
}

func (s *financeService) chartHoursToday(day time.Time) ([]ChartBucket, error) {
	start := day
	end := day.AddDate(0, 0, 1)
	rows, err := s.listTxBetween(start, end)
	if err != nil {
		return nil, err
	}
	income := make([]float64, 24)
	expense := make([]float64, 24)
	topIncome := make([][]TxHighlight, 24)
	topExpense := make([][]TxHighlight, 24)
	for _, r := range rows {
		h := r.occurredAt.Hour()
		if h < 0 || h >= 24 {
			continue
		}
		switch r.txType {
		case "income":
			income[h] += r.amount
			topIncome[h] = pushTop(topIncome[h], r.toHighlight(), 12)
		case "expense":
			expense[h] += r.amount
			topExpense[h] = pushTop(topExpense[h], r.toHighlight(), 12)
		}
	}
	out := make([]ChartBucket, 24)
	for h := 0; h < 24; h++ {
		out[h] = ChartBucket{
			Label:      fmt.Sprintf("%02d", h),
			Income:     income[h],
			Expense:    expense[h],
			TopIncome:  orEmpty(topIncome[h]),
			TopExpense: orEmpty(topExpense[h]),
		}
	}
	return out, nil
}

func (s *financeService) chartDays(startDate time.Time, days int) ([]ChartBucket, error) {
	start := startDate
	end := startDate.AddDate(0, 0, days)
	rows, err := s.listTxBetween(start, end)
	if err != nil {
		return nil, err
	}
	income := make([]float64, days)
	expense := make([]float64, days)
	topIncome := make([][]TxHighlight, days)
	topExpense := make([][]TxHighlight, days)
	for _, r := range rows {
		offset := int(utcMidnight(r.occurredAt).Sub(startDate).Hours() / 24)
		if offset < 0 || offset >= days {
			continue
		}
		switch r.txType {
		case "income":
			income[offset] += r.amount
			topIncome[offset] = pushTop(topIncome[offset], r.toHighlight(), 12)
		case "expense":
			expense[offset] += r.amount
			topExpense[offset] = pushTop(topExpense[offset], r.toHighlight(), 12)
		}
	}
	out := make([]ChartBucket, days)
	for i := 0; i < days; i++ {
		d := startDate.AddDate(0, 0, i)
		out[i] = ChartBucket{
			Label:      fmt.Sprintf("%d/%d", int(d.Month()), d.Day()),
			Income:     income[i],
			Expense:    expense[i],
			TopIncome:  orEmpty(topIncome[i]),
			TopExpense: orEmpty(topExpense[i]),
		}
	}
	return out, nil
}

func orEmpty(l []TxHighlight) []TxHighlight {
	if l == nil {
		return []TxHighlight{}
	}
	return l
}

// ---- Snapshots ----

func (s *financeService) listSnapshots(limit int) ([]PayPeriodSnapshot, error) {
	rows, err := s.db.sql.Query(
		`SELECT id, period_start, period_end, income, expense, net, confirmed_at, note
		 FROM pay_period_snapshots ORDER BY period_start DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PayPeriodSnapshot{}
	for rows.Next() {
		var (
			snap      PayPeriodSnapshot
			note      sql.NullString
			confirmed string
		)
		if err := rows.Scan(&snap.ID, &snap.PeriodStart, &snap.PeriodEnd, &snap.Income, &snap.Expense, &snap.Net, &confirmed, &note); err != nil {
			return nil, err
		}
		startD := parseDate(snap.PeriodStart)
		endD := parseDate(snap.PeriodEnd)
		snap.PeriodLabel = periodLabel(startD, endD)
		snap.ConfirmedAt = parseRFC3339(confirmed)
		snap.Note = nullStr(note)
		out = append(out, snap)
	}
	return out, rows.Err()
}

func (s *financeService) snapshotStatus(payday int, today time.Time) (*PayPeriodPending, []PayPeriodSnapshot, error) {
	prevStart, prevEnd := previousPayPeriod(today, payday)
	snapshots, err := s.listSnapshots(12)
	if err != nil {
		return nil, nil, err
	}
	prevKey := fmtDate(prevStart)
	confirmed := false
	for _, sn := range snapshots {
		if sn.PeriodStart == prevKey {
			confirmed = true
			break
		}
	}
	if confirmed {
		return nil, snapshots, nil
	}
	startDT := time.Date(prevStart.Year(), prevStart.Month(), prevStart.Day(), 0, 0, 0, 0, time.UTC)
	endDT := time.Date(prevEnd.Year(), prevEnd.Month(), prevEnd.Day(), 0, 0, 0, 0, time.UTC)
	flow, err := s.sumFlowBetween(rfc3339(startDT), rfc3339(endDT))
	if err != nil {
		return nil, nil, err
	}
	pending := &PayPeriodPending{
		PeriodStart: prevKey,
		PeriodEnd:   fmtDate(prevEnd),
		PeriodLabel: periodLabel(prevStart, prevEnd),
		Income:      flow.Income,
		Expense:     flow.Expense,
		Net:         flow.Income - flow.Expense,
	}
	return pending, snapshots, nil
}

func (s *financeService) confirmPreviousSnapshot(payday int, net *float64, note *string) (PayPeriodSnapshot, error) {
	payday = clampInt(payday, 1, 28)
	today := time.Now()
	localToday := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.Local)
	prevStart, prevEnd := previousPayPeriod(localToday, payday)
	startKey := fmtDate(prevStart)
	startDT := time.Date(prevStart.Year(), prevStart.Month(), prevStart.Day(), 0, 0, 0, 0, time.UTC)
	endDT := time.Date(prevEnd.Year(), prevEnd.Month(), prevEnd.Day(), 0, 0, 0, 0, time.UTC)
	flow, err := s.sumFlowBetween(rfc3339(startDT), rfc3339(endDT))
	if err != nil {
		return PayPeriodSnapshot{}, err
	}
	netVal := flow.Income - flow.Expense
	if net != nil {
		netVal = *net
	}
	noteVal := cleanNote(note)
	now := nowUTC()
	existing, err := s.listSnapshots(24)
	if err != nil {
		return PayPeriodSnapshot{}, err
	}
	for _, sn := range existing {
		if sn.PeriodStart == startKey {
			return s.writeSnapshotUpdate(sn.ID, flow.Income, flow.Expense, netVal, noteVal, now, sn.PeriodStart, sn.PeriodEnd, sn.PeriodLabel)
		}
	}
	id := newID()
	endKey := fmtDate(prevEnd)
	if _, err := s.db.sql.Exec(
		`INSERT INTO pay_period_snapshots (id, period_start, period_end, income, expense, net, confirmed_at, note)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, startKey, endKey, flow.Income, flow.Expense, netVal, rfc3339(now), noteVal); err != nil {
		return PayPeriodSnapshot{}, err
	}
	return PayPeriodSnapshot{
		ID: id, PeriodStart: startKey, PeriodEnd: endKey, PeriodLabel: periodLabel(prevStart, prevEnd),
		Income: flow.Income, Expense: flow.Expense, Net: netVal, ConfirmedAt: now, Note: noteVal,
	}, nil
}

func (s *financeService) updateSnapshot(id string, net *float64, note *string) (PayPeriodSnapshot, error) {
	existing, err := s.listSnapshots(120)
	if err != nil {
		return PayPeriodSnapshot{}, err
	}
	var found *PayPeriodSnapshot
	for i := range existing {
		if existing[i].ID == id {
			found = &existing[i]
			break
		}
	}
	if found == nil {
		return PayPeriodSnapshot{}, notFound("pay period snapshot " + id)
	}
	netVal := found.Net
	if net != nil {
		netVal = *net
	}
	noteVal := found.Note
	if note != nil {
		noteVal = cleanNote(note)
	}
	return s.writeSnapshotUpdate(id, found.Income, found.Expense, netVal, noteVal, nowUTC(),
		found.PeriodStart, found.PeriodEnd, found.PeriodLabel)
}

func (s *financeService) writeSnapshotUpdate(id string, income, expense, net float64, note *string, confirmedAt time.Time, periodStart, periodEnd, periodLabelStr string) (PayPeriodSnapshot, error) {
	res, err := s.db.sql.Exec(
		`UPDATE pay_period_snapshots SET income=?, expense=?, net=?, confirmed_at=?, note=? WHERE id=?`,
		income, expense, net, rfc3339(confirmedAt), note, id)
	if err != nil {
		return PayPeriodSnapshot{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return PayPeriodSnapshot{}, notFound("pay period snapshot " + id)
	}
	return PayPeriodSnapshot{
		ID: id, PeriodStart: periodStart, PeriodEnd: periodEnd, PeriodLabel: periodLabelStr,
		Income: income, Expense: expense, Net: net, ConfirmedAt: confirmedAt, Note: note,
	}, nil
}

func cleanNote(note *string) *string {
	if note == nil {
		return nil
	}
	t := strings.TrimSpace(*note)
	if t == "" {
		return nil
	}
	return &t
}

// ---- Pay period math (ported from finance.rs) ----

func clampDayInMonth(year int, month time.Month, day int) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.Local).Day()
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, time.Local)
}

func payPeriodBounds(today time.Time, payday int) (time.Time, time.Time) {
	payday = clampInt(payday, 1, 28)
	thisMonthPay := clampDayInMonth(today.Year(), today.Month(), payday)
	if !today.Before(thisMonthPay) {
		var next time.Time
		if today.Month() == time.December {
			next = clampDayInMonth(today.Year()+1, time.January, payday)
		} else {
			next = clampDayInMonth(today.Year(), today.Month()+1, payday)
		}
		return thisMonthPay, next
	}
	var prev time.Time
	if today.Month() == time.January {
		prev = clampDayInMonth(today.Year()-1, time.December, payday)
	} else {
		prev = clampDayInMonth(today.Year(), today.Month()-1, payday)
	}
	return prev, thisMonthPay
}

func previousPayPeriod(today time.Time, payday int) (time.Time, time.Time) {
	start, _ := payPeriodBounds(today, payday)
	return payPeriodBounds(start.AddDate(0, 0, -1), payday)
}

func periodLabel(start, end time.Time) string {
	last := end.AddDate(0, 0, -1)
	return fmt.Sprintf("%d/%d – %d/%d", int(start.Month()), start.Day(), int(last.Month()), last.Day())
}

// ---- Quick finance parser (ported from finance.rs) ----

var incomeKeywords = []string{
	"卖掉", "卖了", "出售", "售出", "卖出", "转卖", "卖", "收入", "进账", "入账", "工资",
	"薪水", "薪资", "奖金", "收到", "收款", "回款", "赚了", "赚", "盈利", "退款", "报销",
}
var expenseKeywords = []string{"买了", "买", "花了", "花", "付了", "付", "支出", "消费"}

func lastKeywordEnd(label string, keywords []string) (int, bool) {
	best := -1
	for _, kw := range keywords {
		if i := strings.LastIndex(label, kw); i >= 0 {
			if end := i + len(kw); end > best {
				best = end
			}
		}
	}
	return best, best >= 0
}

func guessType(label string) string {
	incomeAt, hasIncome := lastKeywordEnd(label, incomeKeywords)
	expenseAt, hasExpense := lastKeywordEnd(label, expenseKeywords)
	if hasIncome && hasExpense && expenseAt > incomeAt {
		return "expense"
	}
	if hasIncome {
		return "income"
	}
	return "expense"
}

func guessCategory(label, txType string) string {
	if txType == "income" {
		return "收入"
	}
	rules := [][2]string{
		{"咖啡", "餐饮"}, {"饭", "餐饮"}, {"午", "餐饮"}, {"餐", "餐饮"}, {"吃", "餐饮"},
		{"地铁", "交通"}, {"公交", "交通"}, {"打车", "交通"}, {"出租", "交通"},
		{"电信", "通讯"}, {"联通", "通讯"}, {"移动", "通讯"}, {"话费", "通讯"}, {"流量", "通讯"},
		{"宽带", "通讯"}, {"网费", "通讯"}, {"通讯", "通讯"},
		{"书", "学习"}, {"买", "购物"},
	}
	for _, r := range rules {
		if strings.Contains(label, r[0]) {
			return r[1]
		}
	}
	return "其他"
}

func normalizeLabel(s string) string {
	return strings.TrimFunc(strings.TrimSpace(s), func(c rune) bool {
		return strings.ContainsRune("，,。、；;：: \t", c)
	})
}

type amountHit struct {
	start  int
	end    int
	amount float64
}

func isTimeOrDateUnit(r rune, ok bool) bool {
	if !ok {
		return false
	}
	switch r {
	case '点', '时', '分', '秒', '月', '日', '号', '年', ':':
		return true
	}
	return false
}

func isClockMinute(chars []rune, start int) bool {
	k := start
	for k > 0 && (chars[k-1] == ' ' || chars[k-1] == '\t' || chars[k-1] == '\n') {
		k--
	}
	return k > 0 && chars[k-1] == '点'
}

func findAmountHits(chars []rune) []amountHit {
	var hits []amountHit
	i := 0
	for i < len(chars) {
		start := i
		cursor := i
		if chars[cursor] == '¥' || chars[cursor] == '$' {
			if cursor+1 < len(chars) && isASCIIDigit(chars[cursor+1]) {
				cursor++
			} else {
				i++
				continue
			}
		}
		if !isASCIIDigit(chars[cursor]) {
			i++
			continue
		}
		digitStart := cursor
		for cursor < len(chars) && isASCIIDigit(chars[cursor]) {
			cursor++
		}
		if cursor < len(chars) && chars[cursor] == '.' {
			frac := cursor + 1
			if frac < len(chars) && isASCIIDigit(chars[frac]) {
				cursor = frac
				for cursor < len(chars) && isASCIIDigit(chars[cursor]) {
					cursor++
				}
			}
		}
		digitEnd := cursor
		end := digitEnd
		if end < len(chars) && chars[end] == '元' {
			end++
		}
		var nextR rune
		nextOK := end < len(chars)
		if nextOK {
			nextR = chars[end]
		}
		if isTimeOrDateUnit(nextR, nextOK) || isClockMinute(chars, start) {
			i = digitEnd
			continue
		}
		numStr := string(chars[digitStart:digitEnd])
		if amount, err := strconv.ParseFloat(numStr, 64); err == nil && amount > 0 {
			hits = append(hits, amountHit{start: start, end: end, amount: amount})
		}
		i = end
	}
	return hits
}

func isASCIIDigit(r rune) bool { return r >= '0' && r <= '9' }

func extractAmountSegments(text string) []struct {
	label  string
	amount float64
} {
	chars := []rune(text)
	hits := findAmountHits(chars)
	var results []struct {
		label  string
		amount float64
	}
	prev := 0
	for _, hit := range hits {
		label := string(chars[prev:hit.start])
		results = append(results, struct {
			label  string
			amount float64
		}{normalizeLabel(label), hit.amount})
		prev = hit.end
	}
	return results
}

func parseQuickFinances(text string) []CreateTransactionInput {
	var out []CreateTransactionInput
	for _, seg := range extractAmountSegments(text) {
		if seg.amount <= 0 {
			continue
		}
		txType := guessType(seg.label)
		category := guessCategory(seg.label, txType)
		var note *string
		if seg.label != "" {
			l := seg.label
			note = &l
		}
		merchant := note
		out = append(out, CreateTransactionInput{
			Amount:          seg.amount,
			TransactionType: &txType,
			Category:        &category,
			Merchant:        merchant,
			Note:            note,
		})
	}
	return out
}
