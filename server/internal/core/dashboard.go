package core

type DashboardStats struct {
	TasksDone              int      `json:"tasksDone"`
	TasksTotal             int      `json:"tasksTotal"`
	HabitsDone             int      `json:"habitsDone"`
	HabitsTotal            int      `json:"habitsTotal"`
	TodaySpending          float64  `json:"todaySpending"`
	MonthIncome            float64  `json:"monthIncome"`
	MonthExpense           float64  `json:"monthExpense"`
	MonthNet               float64  `json:"monthNet"`
	PayPeriodIncome        float64  `json:"payPeriodIncome"`
	PayPeriodExpense       float64  `json:"payPeriodExpense"`
	PayPeriodLabel         string   `json:"payPeriodLabel"`
	PayPeriodEffective     float64  `json:"payPeriodEffective"`
	PayPeriodOpening       *float64 `json:"payPeriodOpening"`
	PayPeriodOpeningMissing bool    `json:"payPeriodOpeningMissing"`
	PayPeriodDueThisPeriod float64  `json:"payPeriodDueThisPeriod"`
	PayPeriodAfterDebts    float64  `json:"payPeriodAfterDebts"`
	DebtRemaining          float64  `json:"debtRemaining"`
	DebtMonthlyObligation  float64  `json:"debtMonthlyObligation"`
	MonthsToPayoff         *int     `json:"monthsToPayoff,omitempty"`
	PayoffDate             *string  `json:"payoffDate,omitempty"`
}

func dashboard(db *DB, payday int) (DashboardStats, error) {
	taskSvc := newTaskService(db)
	goalSvc := newGoalService(db)
	finSvc := newFinanceService(db)
	debtSvc := newDebtService(db)

	tasksDone, tasksTotal, err := taskSvc.countTodayProgress()
	if err != nil {
		return DashboardStats{}, err
	}
	habitsDone, habitsTotal, err := goalSvc.todayCheckinProgress()
	if err != nil {
		return DashboardStats{}, err
	}
	todaySpending, err := finSvc.todaySpending()
	if err != nil {
		return DashboardStats{}, err
	}
	fin, err := finSvc.summary(payday)
	if err != nil {
		return DashboardStats{}, err
	}
	ov, err := debtSvc.overview()
	if err != nil {
		return DashboardStats{}, err
	}
	_ = debtSvc.syncRepaymentReminders()
	_ = goalSvc.syncPlanReminders()

	return DashboardStats{
		TasksDone:               tasksDone,
		TasksTotal:              tasksTotal,
		HabitsDone:              habitsDone,
		HabitsTotal:             habitsTotal,
		TodaySpending:           todaySpending,
		MonthIncome:             fin.Month.Income,
		MonthExpense:            fin.Month.Expense,
		MonthNet:                fin.Month.Income - fin.Month.Expense,
		PayPeriodIncome:         fin.PayPeriod.Income,
		PayPeriodExpense:        fin.PayPeriod.Expense,
		PayPeriodLabel:          fin.PayPeriodLabel,
		PayPeriodEffective:      fin.PayPeriodGlance.Effective,
		PayPeriodOpening:        fin.PayPeriodGlance.Opening,
		PayPeriodOpeningMissing: fin.PayPeriodGlance.OpeningMissing,
		PayPeriodDueThisPeriod:  fin.PayPeriodGlance.DueThisPeriod,
		PayPeriodAfterDebts:     fin.PayPeriodGlance.AfterDebts,
		DebtRemaining:           ov.TotalRemaining,
		DebtMonthlyObligation:   ov.MonthlyObligation,
		MonthsToPayoff:          ov.MonthsToPayoff,
		PayoffDate:              ov.PayoffDate,
	}, nil
}
