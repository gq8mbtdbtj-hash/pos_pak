package core

import (
	"database/sql"
	"encoding/json"
	"math"
	"strings"
	"time"
)

const checkinFormDays = 66

// ---- Models (aligned with models/goal.rs) ----

type Goal struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Note        *string   `json:"note,omitempty"`
	TargetDate  *string   `json:"targetDate,omitempty"`
	Kind        string    `json:"kind"`
	Status      string    `json:"status"`
	Progress    int       `json:"progress"`
	StartValue  *float64  `json:"startValue,omitempty"`
	TargetValue *float64  `json:"targetValue,omitempty"`
	Unit        *string   `json:"unit,omitempty"`
	CurrentValue *float64 `json:"currentValue,omitempty"`
	Gap         *float64  `json:"gap,omitempty"`
	Streak      *int      `json:"streak,omitempty"`
	Formed      *bool     `json:"formed,omitempty"`
	CheckedToday *bool    `json:"checkedToday,omitempty"`
	StreakAtRisk *bool    `json:"streakAtRisk,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type GoalMilestone struct {
	ID        string     `json:"id"`
	GoalID    string     `json:"goalId"`
	Title     string     `json:"title"`
	DueDate   *string    `json:"dueDate,omitempty"`
	Done      bool       `json:"done"`
	TaskID    *string    `json:"taskId,omitempty"`
	HabitID   *string    `json:"habitId,omitempty"`
	SortOrder int        `json:"sortOrder"`
	CreatedAt *time.Time `json:"createdAt,omitempty"`
}

type GoalCheckin struct {
	ID        string    `json:"id"`
	GoalID    string    `json:"goalId"`
	Date      string    `json:"date"`
	Note      string    `json:"note"`
	Value     float64   `json:"value"`
	CreatedAt time.Time `json:"createdAt"`
}

type GoalDetail struct {
	Goal         Goal            `json:"goal"`
	Milestones   []GoalMilestone `json:"milestones"`
	Checkins     []GoalCheckin   `json:"checkins"`
	CheckedToday bool            `json:"checkedToday"`
}

type CreateGoalInput struct {
	Title       string   `json:"title"`
	Note        *string  `json:"note,omitempty"`
	TargetDate  *string  `json:"targetDate,omitempty"`
	Kind        *string  `json:"kind,omitempty"`
	StartValue  *float64 `json:"startValue,omitempty"`
	TargetValue *float64 `json:"targetValue,omitempty"`
	Unit        *string  `json:"unit,omitempty"`
}

type CreateMilestoneInput struct {
	Title   string  `json:"title"`
	DueDate *string `json:"dueDate,omitempty"`
	TaskID  *string `json:"taskId,omitempty"`
	HabitID *string `json:"habitId,omitempty"`
	Progress *int   `json:"progress,omitempty"`
}

type CreateCheckinInput struct {
	Note     *string  `json:"note,omitempty"`
	Value    *float64 `json:"value,omitempty"`
	Progress *int     `json:"progress,omitempty"`
	Date     *string  `json:"date,omitempty"`
	At       *string  `json:"at,omitempty"`
}

// UpdateGoalInput handles the double-optional note/targetDate/unit fields.
type UpdateGoalInput struct {
	Title       *string
	Note        *string
	noteSet     bool
	TargetDate  *string
	targetSet   bool
	Status      *string
	Progress    *int
	StartValue  *float64
	TargetValue *float64
	Unit        *string
	unitSet     bool
}

func (u *UpdateGoalInput) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	if raw, ok := m["title"]; ok {
		_ = json.Unmarshal(raw, &u.Title)
	}
	if raw, ok := m["note"]; ok {
		u.noteSet = true
		_ = json.Unmarshal(raw, &u.Note)
	}
	if raw, ok := m["targetDate"]; ok {
		u.targetSet = true
		_ = json.Unmarshal(raw, &u.TargetDate)
	}
	if raw, ok := m["status"]; ok {
		_ = json.Unmarshal(raw, &u.Status)
	}
	if raw, ok := m["progress"]; ok {
		_ = json.Unmarshal(raw, &u.Progress)
	}
	if raw, ok := m["startValue"]; ok {
		_ = json.Unmarshal(raw, &u.StartValue)
	}
	if raw, ok := m["targetValue"]; ok {
		_ = json.Unmarshal(raw, &u.TargetValue)
	}
	if raw, ok := m["unit"]; ok {
		u.unitSet = true
		_ = json.Unmarshal(raw, &u.Unit)
	}
	return nil
}

type goalService struct{ db *DB }

func newGoalService(db *DB) *goalService { return &goalService{db: db} }

func normalizeGoalKind(s string) string {
	switch s {
	case "checkin", "habit":
		return s
	default:
		return "plan"
	}
}
func normalizeGoalStatus(s string) string {
	switch s {
	case "done", "paused":
		return s
	default:
		return "active"
	}
}
func usesDailyCheckins(kind string) bool { return kind == "habit" || kind == "checkin" }

func parseOptDateStr(s *string) *string {
	if s == nil {
		return nil
	}
	if t, ok := parseDateOpt(strings.TrimSpace(*s)); ok {
		v := fmtDate(t)
		return &v
	}
	return nil
}

func (s *goalService) create(in CreateGoalInput) (Goal, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return Goal{}, errf("标题不能为空")
	}
	kind := normalizeGoalKind(strOr(in.Kind, "plan"))
	var startValue, targetValue *float64
	var unit *string
	switch kind {
	case "checkin":
		if in.TargetValue == nil {
			return Goal{}, errf("目标打卡必须填写目标值")
		}
		targetValue = in.TargetValue
		if in.StartValue != nil && math.Abs(*in.StartValue-*in.TargetValue) >= 1e-12 {
			startValue = in.StartValue
		}
		unit = in.Unit
	case "habit":
		z := 0.0
		f := float64(checkinFormDays)
		startValue = &z
		targetValue = &f
		u := strOr(in.Unit, "天")
		unit = &u
	default: // plan
	}
	id := newID()
	now := nowUTC()
	target := parseOptDateStr(in.TargetDate)
	if _, err := s.db.sql.Exec(
		`INSERT INTO goals (id, title, note, target_date, kind, status, progress, start_value, target_value, unit, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?)`,
		id, title, in.Note, target, kind, startValue, targetValue, unit, rfc3339(now), rfc3339(now)); err != nil {
		return Goal{}, err
	}
	tx, err := s.db.sql.Begin()
	if err == nil {
		_ = upsertSearchIndex(tx, "goal", id, title, strOr(in.Note, ""))
		_ = tx.Commit()
	}
	_ = s.syncPlanReminders()
	return s.get(id)
}

func scanGoal(row interface {
	Scan(dest ...any) error
}) (Goal, error) {
	var (
		g                            Goal
		note, target, unit           sql.NullString
		startV, targetV              sql.NullFloat64
		kind, status, created, updat string
	)
	if err := row.Scan(&g.ID, &g.Title, &note, &target, &kind, &status, &g.Progress, &created, &updat, &startV, &targetV, &unit); err != nil {
		return Goal{}, err
	}
	g.Note = nullStr(note)
	if target.Valid && target.String != "" {
		if t, ok := parseDateOpt(target.String); ok {
			v := fmtDate(t)
			g.TargetDate = &v
		}
	}
	g.Kind = normalizeGoalKind(kind)
	g.Status = normalizeGoalStatus(status)
	g.CreatedAt = parseRFC3339(created)
	g.UpdatedAt = parseRFC3339(updat)
	g.StartValue = nullFloat(startV)
	g.TargetValue = nullFloat(targetV)
	g.Unit = nullStr(unit)
	return g, nil
}

const goalCols = `id, title, note, target_date, kind, status, progress, created_at, updated_at, start_value, target_value, unit`

func (s *goalService) get(id string) (Goal, error) {
	row := s.db.sql.QueryRow(`SELECT `+goalCols+` FROM goals WHERE id = ?`, id)
	g, err := scanGoal(row)
	if err == sql.ErrNoRows {
		return Goal{}, notFound("goal " + id)
	}
	if err != nil {
		return Goal{}, err
	}
	if err := s.enrichGoal(&g); err != nil {
		return Goal{}, err
	}
	return g, nil
}

func (s *goalService) list() ([]Goal, error) {
	rows, err := s.db.sql.Query(`SELECT ` + goalCols + ` FROM goals
		ORDER BY CASE kind WHEN 'habit' THEN 0 WHEN 'checkin' THEN 1 ELSE 2 END,
		         CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
		         updated_at DESC`)
	if err != nil {
		return nil, err
	}
	// Collect fully before enriching: per-row sub-queries can't run while the
	// result set holds the single pooled connection.
	var staged []Goal
	for rows.Next() {
		g, err := scanGoal(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		staged = append(staged, g)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	out := []Goal{}
	for i := range staged {
		if err := s.enrichGoal(&staged[i]); err != nil {
			return nil, err
		}
		out = append(out, staged[i])
	}
	return out, nil
}

func (s *goalService) detail(id string) (GoalDetail, error) {
	g, err := s.get(id)
	if err != nil {
		return GoalDetail{}, err
	}
	milestones := []GoalMilestone{}
	if g.Kind == "plan" {
		milestones, err = s.listMilestones(id)
		if err != nil {
			return GoalDetail{}, err
		}
	}
	checkins := []GoalCheckin{}
	if usesDailyCheckins(g.Kind) {
		checkins, err = s.listCheckins(id)
		if err != nil {
			return GoalDetail{}, err
		}
	}
	today := fmtDate(localToday())
	checkedToday := false
	for _, c := range checkins {
		if c.Date == today {
			checkedToday = true
			break
		}
	}
	return GoalDetail{Goal: g, Milestones: milestones, Checkins: checkins, CheckedToday: checkedToday}, nil
}

func (s *goalService) update(id string, in UpdateGoalInput) (Goal, error) {
	existing, err := s.get(id)
	if err != nil {
		return Goal{}, err
	}
	title := existing.Title
	if in.Title != nil {
		if t := strings.TrimSpace(*in.Title); t != "" {
			title = t
		}
	}
	note := existing.Note
	if in.noteSet {
		note = in.Note
	}
	target := existing.TargetDate
	if in.targetSet {
		target = parseOptDateStr(in.TargetDate)
	}
	status := existing.Status
	if in.Status != nil {
		status = normalizeGoalStatus(*in.Status)
	}
	progress := existing.Progress
	if in.Progress != nil {
		progress = clampInt(*in.Progress, 0, 100)
	}
	startValue := existing.StartValue
	if in.StartValue != nil {
		startValue = in.StartValue
	}
	targetValue := existing.TargetValue
	if in.TargetValue != nil {
		targetValue = in.TargetValue
	}
	unit := existing.Unit
	if in.unitSet {
		unit = in.Unit
	}
	now := nowUTC()
	if _, err := s.db.sql.Exec(
		`UPDATE goals SET title=?, note=?, target_date=?, status=?, progress=?, start_value=?, target_value=?, unit=?, updated_at=? WHERE id=?`,
		title, note, target, status, progress, startValue, targetValue, unit, rfc3339(now), id); err != nil {
		return Goal{}, err
	}
	tx, err := s.db.sql.Begin()
	if err == nil {
		_ = upsertSearchIndex(tx, "goal", id, title, strOr(note, ""))
		_ = tx.Commit()
	}
	_ = s.syncPlanReminders()
	return s.get(id)
}

func (s *goalService) delete(id string) error {
	tx, err := s.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tx.Exec("DELETE FROM goal_checkins WHERE goal_id = ?", id)
	tx.Exec("DELETE FROM goal_milestones WHERE goal_id = ?", id)
	tx.Exec("DELETE FROM goals WHERE id = ?", id)
	removeSearchIndex(tx, "goal", id)
	if err := tx.Commit(); err != nil {
		return err
	}
	_ = s.syncPlanReminders()
	return nil
}

func (s *goalService) listMilestones(goalID string) ([]GoalMilestone, error) {
	rows, err := s.db.sql.Query(
		`SELECT id, goal_id, title, due_date, done, task_id, habit_id, sort_order, created_at
		 FROM goal_milestones WHERE goal_id = ?
		 ORDER BY CASE WHEN due_date IS NULL OR TRIM(due_date) = '' THEN 1 ELSE 0 END, due_date ASC, sort_order ASC`, goalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GoalMilestone{}
	for rows.Next() {
		var (
			m                        GoalMilestone
			due, taskID, habitID, cr sql.NullString
			done                     int
		)
		if err := rows.Scan(&m.ID, &m.GoalID, &m.Title, &due, &done, &taskID, &habitID, &m.SortOrder, &cr); err != nil {
			return nil, err
		}
		if due.Valid && due.String != "" {
			if t, ok := parseDateOpt(due.String); ok {
				v := fmtDate(t)
				m.DueDate = &v
			}
		}
		m.Done = done == 1
		m.TaskID = nullStr(taskID)
		m.HabitID = nullStr(habitID)
		m.CreatedAt = nullTime(cr)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *goalService) addMilestone(goalID string, in CreateMilestoneInput) (GoalDetail, error) {
	g, err := s.get(goalID)
	if err != nil {
		return GoalDetail{}, err
	}
	if g.Kind != "plan" {
		return GoalDetail{}, errf("习惯与目标打卡请使用每日打卡，而不是里程碑")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return GoalDetail{}, errf("里程碑标题不能为空")
	}
	due := parseOptDateStr(in.DueDate)
	if due == nil {
		return GoalDetail{}, errf("请填写里程碑截止日")
	}
	id := newID()
	var sortOrder int
	s.db.sql.QueryRow("SELECT COALESCE(MAX(sort_order),0)+1 FROM goal_milestones WHERE goal_id = ?", goalID).Scan(&sortOrder)
	now := nowUTC()
	if _, err := s.db.sql.Exec(
		`INSERT INTO goal_milestones (id, goal_id, title, due_date, done, task_id, habit_id, sort_order, created_at)
		 VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
		id, goalID, title, *due, in.TaskID, in.HabitID, sortOrder, rfc3339(now)); err != nil {
		return GoalDetail{}, err
	}
	s.db.sql.Exec("UPDATE goals SET updated_at = ? WHERE id = ?", rfc3339(now), goalID)
	if err := s.recalcPlanProgress(goalID); err != nil {
		return GoalDetail{}, err
	}
	return s.detail(goalID)
}

func (s *goalService) setMilestoneDone(milestoneID string, done bool) (GoalDetail, error) {
	var goalID string
	err := s.db.sql.QueryRow("SELECT goal_id FROM goal_milestones WHERE id = ?", milestoneID).Scan(&goalID)
	if err == sql.ErrNoRows {
		return GoalDetail{}, notFound("milestone " + milestoneID)
	}
	if err != nil {
		return GoalDetail{}, err
	}
	d := 0
	if done {
		d = 1
	}
	s.db.sql.Exec("UPDATE goal_milestones SET done = ? WHERE id = ?", d, milestoneID)
	if err := s.recalcPlanProgress(goalID); err != nil {
		return GoalDetail{}, err
	}
	return s.detail(goalID)
}

func (s *goalService) deleteMilestone(milestoneID string) (GoalDetail, error) {
	var goalID string
	err := s.db.sql.QueryRow("SELECT goal_id FROM goal_milestones WHERE id = ?", milestoneID).Scan(&goalID)
	if err == sql.ErrNoRows {
		return GoalDetail{}, notFound("milestone " + milestoneID)
	}
	if err != nil {
		return GoalDetail{}, err
	}
	s.db.sql.Exec("DELETE FROM goal_milestones WHERE id = ?", milestoneID)
	if err := s.recalcPlanProgress(goalID); err != nil {
		return GoalDetail{}, err
	}
	return s.detail(goalID)
}

func (s *goalService) listCheckins(goalID string) ([]GoalCheckin, error) {
	rows, err := s.db.sql.Query(
		`SELECT id, goal_id, date, note, COALESCE(value, CAST(progress AS REAL)), created_at
		 FROM goal_checkins WHERE goal_id = ? ORDER BY created_at DESC, rowid DESC, date DESC`, goalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GoalCheckin{}
	for rows.Next() {
		var (
			c       GoalCheckin
			value   sql.NullFloat64
			created string
		)
		if err := rows.Scan(&c.ID, &c.GoalID, &c.Date, &c.Note, &value, &created); err != nil {
			return nil, err
		}
		if value.Valid {
			c.Value = value.Float64
		}
		if t, ok := parseDateOpt(c.Date); ok {
			c.Date = fmtDate(t)
		}
		c.CreatedAt = parseRFC3339(created)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *goalService) addCheckin(goalID string, in CreateCheckinInput) (GoalDetail, error) {
	g, err := s.get(goalID)
	if err != nil {
		return GoalDetail{}, err
	}
	if !usesDailyCheckins(g.Kind) {
		return GoalDetail{}, errf("计划请记录里程碑，而不是每日打卡")
	}
	atUTC, localDate := parseCheckinAt(in.At)
	dateStr := fmtDate(localDate)
	if d := parseOptDateStr(in.Date); d != nil {
		dateStr = *d
	}
	note := ""
	if in.Note != nil {
		note = strings.TrimSpace(*in.Note)
	}
	var value float64
	if g.Kind == "habit" {
		switch {
		case in.Value != nil:
			value = *in.Value
		case in.Progress != nil:
			value = float64(*in.Progress)
		default:
			value = 1.0
		}
	} else {
		switch {
		case in.Value != nil:
			value = *in.Value
		case in.Progress != nil:
			value = float64(*in.Progress)
		default:
			return GoalDetail{}, errf("请填写实测值")
		}
	}
	id := newID()
	atStr := rfc3339(atUTC)
	if g.Kind == "habit" {
		var existing string
		err := s.db.sql.QueryRow("SELECT id FROM goal_checkins WHERE goal_id = ? AND date = ? LIMIT 1", goalID, dateStr).Scan(&existing)
		if err == nil {
			s.db.sql.Exec("UPDATE goal_checkins SET note=?, progress=0, value=?, created_at=? WHERE id=?", note, value, atStr, existing)
		} else {
			s.db.sql.Exec("INSERT INTO goal_checkins (id, goal_id, date, note, progress, value, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
				id, goalID, dateStr, note, value, atStr)
		}
	} else {
		s.db.sql.Exec("INSERT INTO goal_checkins (id, goal_id, date, note, progress, value, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
			id, goalID, dateStr, note, value, atStr)
	}
	if g.Kind == "checkin" {
		s.syncStartFromFirstCheckin(goalID)
	}
	s.recalcCheckinProgress(goalID)
	return s.detail(goalID)
}

func (s *goalService) deleteCheckin(checkinID string) (GoalDetail, error) {
	var goalID string
	err := s.db.sql.QueryRow("SELECT goal_id FROM goal_checkins WHERE id = ?", checkinID).Scan(&goalID)
	if err == sql.ErrNoRows {
		return GoalDetail{}, notFound("checkin " + checkinID)
	}
	if err != nil {
		return GoalDetail{}, err
	}
	s.db.sql.Exec("DELETE FROM goal_checkins WHERE id = ?", checkinID)
	g, _ := s.get(goalID)
	if g.Kind == "checkin" {
		s.syncStartFromFirstCheckin(goalID)
	}
	s.recalcCheckinProgress(goalID)
	return s.detail(goalID)
}

// ---- progress + enrichment ----

func valueProgress(start, target, current float64) int {
	denom := target - start
	if math.Abs(denom) < 1e-12 {
		return 0
	}
	pct := (current - start) / denom * 100
	return clampInt(int(math.Round(pct)), 0, 100)
}

func (s *goalService) enrichGoal(g *Goal) error {
	switch g.Kind {
	case "plan":
		g.CurrentValue, g.Gap, g.Streak, g.Formed, g.CheckedToday, g.StreakAtRisk = nil, nil, nil, nil, nil, nil
		return nil
	case "habit":
		streak, err := s.calcStreak(g.ID)
		if err != nil {
			return err
		}
		g.Streak = &streak
		cv := float64(streak)
		g.CurrentValue = &cv
		gap := float64(maxInt(checkinFormDays-streak, 0))
		g.Gap = &gap
		prog := int(math.Round(float64(minInt(streak, checkinFormDays)) / float64(checkinFormDays) * 100))
		g.Progress = prog
		formed := streak >= checkinFormDays
		g.Formed = &formed
		today := localToday()
		yesterday := today.AddDate(0, 0, -1)
		checkedToday, err := s.hasCheckin(g.ID, today)
		if err != nil {
			return err
		}
		g.CheckedToday = &checkedToday
		checkedYest, err := s.hasCheckin(g.ID, yesterday)
		if err != nil {
			return err
		}
		atRisk := !checkedToday && !checkedYest && streak > 0 && !formed
		g.StreakAtRisk = &atRisk
		if g.StartValue == nil {
			z := 0.0
			g.StartValue = &z
		}
		if g.TargetValue == nil {
			f := float64(checkinFormDays)
			g.TargetValue = &f
		}
		return nil
	case "checkin":
		if g.TargetValue == nil || math.IsInf(*g.TargetValue, 0) {
			g.CurrentValue, g.Gap, g.Streak = nil, nil, nil
			f := false
			g.Formed = &f
			g.Progress = 0
			return s.setCheckedToday(g)
		}
		target := *g.TargetValue
		first, err := s.firstCheckinValue(g.ID)
		if err != nil {
			return err
		}
		if first == nil {
			g.CurrentValue, g.Gap, g.Streak = nil, nil, nil
			f := false
			g.Formed = &f
			g.Progress = 0
			return s.setCheckedToday(g)
		}
		start := *first
		g.StartValue = &start
		latest, err := s.latestCheckinValue(g.ID)
		if err != nil {
			return err
		}
		current := start
		if latest != nil {
			current = *latest
		}
		g.CurrentValue = &current
		toward := target - start
		var remaining float64
		if math.Abs(toward) < 1e-12 {
			remaining = target - current
		} else if toward > 0 {
			remaining = target - current
		} else {
			remaining = current - target
		}
		g.Gap = &remaining
		g.Progress = valueProgress(start, target, current)
		g.Streak = nil
		formed := g.Progress >= 100
		g.Formed = &formed
		return s.setCheckedToday(g)
	}
	return nil
}

func (s *goalService) setCheckedToday(g *Goal) error {
	checked, err := s.hasCheckin(g.ID, localToday())
	if err != nil {
		return err
	}
	g.CheckedToday = &checked
	return nil
}

func (s *goalService) latestCheckinValue(goalID string) (*float64, error) {
	var v sql.NullFloat64
	err := s.db.sql.QueryRow(
		`SELECT value FROM goal_checkins WHERE goal_id = ? AND value IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`, goalID).Scan(&v)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return nullFloat(v), nil
}

func (s *goalService) firstCheckinValue(goalID string) (*float64, error) {
	var v sql.NullFloat64
	err := s.db.sql.QueryRow(
		`SELECT value FROM goal_checkins WHERE goal_id = ? AND value IS NOT NULL ORDER BY created_at ASC, rowid ASC LIMIT 1`, goalID).Scan(&v)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return nullFloat(v), nil
}

func (s *goalService) syncStartFromFirstCheckin(goalID string) error {
	first, err := s.firstCheckinValue(goalID)
	if err != nil {
		return err
	}
	now := rfc3339(nowUTC())
	if first != nil {
		_, err = s.db.sql.Exec("UPDATE goals SET start_value=?, updated_at=? WHERE id=?", *first, now, goalID)
	} else {
		_, err = s.db.sql.Exec("UPDATE goals SET start_value=NULL, updated_at=? WHERE id=?", now, goalID)
	}
	return err
}

func (s *goalService) recalcPlanProgress(goalID string) error {
	var total, done int
	if err := s.db.sql.QueryRow(
		`SELECT COUNT(*), COALESCE(SUM(CASE WHEN done=1 THEN 1 ELSE 0 END),0) FROM goal_milestones WHERE goal_id = ?`, goalID).
		Scan(&total, &done); err != nil {
		return err
	}
	progress := 0
	if total > 0 {
		progress = int(math.Round(float64(done) / float64(total) * 100))
	}
	status := "active"
	if total > 0 && done == total {
		status = "done"
	}
	_, err := s.db.sql.Exec(
		`UPDATE goals SET progress=?, status=CASE WHEN status='paused' THEN status ELSE ? END, updated_at=? WHERE id=?`,
		progress, status, rfc3339(nowUTC()), goalID)
	return err
}

func (s *goalService) recalcCheckinProgress(goalID string) error {
	g, err := s.get(goalID)
	if err != nil {
		return err
	}
	status := g.Status
	if g.Kind == "habit" && g.Formed != nil && *g.Formed {
		status = "done"
	} else if g.Kind == "checkin" && g.Progress >= 100 {
		status = "done"
	}
	_, err = s.db.sql.Exec(
		`UPDATE goals SET progress=?, status=CASE WHEN status='paused' THEN status ELSE ? END, updated_at=? WHERE id=?`,
		g.Progress, status, rfc3339(nowUTC()), goalID)
	return err
}

func (s *goalService) calcStreak(goalID string) (int, error) {
	today := localToday()
	date := today
	streak := 0
	missRun := 0
	for i := 0; i < 400; i++ {
		checked, err := s.hasCheckin(goalID, date)
		if err != nil {
			return 0, err
		}
		if checked {
			streak++
			missRun = 0
			date = date.AddDate(0, 0, -1)
			continue
		}
		if streak == 0 && date.Equal(today) {
			date = date.AddDate(0, 0, -1)
			continue
		}
		missRun++
		if missRun >= 2 {
			break
		}
		date = date.AddDate(0, 0, -1)
	}
	return streak, nil
}

func (s *goalService) hasCheckin(goalID string, date time.Time) (bool, error) {
	var n int
	err := s.db.sql.QueryRow("SELECT COUNT(*) FROM goal_checkins WHERE goal_id = ? AND date = ?", goalID, fmtDate(date)).Scan(&n)
	return n > 0, err
}

func (s *goalService) todayCheckinProgress() (int, int, error) {
	goals, err := s.list()
	if err != nil {
		return 0, 0, err
	}
	today := fmtDate(localToday())
	total, done := 0, 0
	for _, g := range goals {
		if !usesDailyCheckins(g.Kind) || g.Status != "active" {
			continue
		}
		total++
		var n int
		s.db.sql.QueryRow("SELECT COUNT(*) FROM goal_checkins WHERE goal_id = ? AND date = ?", g.ID, today).Scan(&n)
		if n > 0 {
			done++
		}
	}
	return done, total, nil
}

// syncPlanReminders: one reminder task per active plan with a target date.
func (s *goalService) syncPlanReminders() error {
	tasks := newTaskService(s.db)
	type planRow struct {
		id, title string
		due       time.Time
	}
	rows, err := s.db.sql.Query(
		`SELECT id, title, target_date FROM goals
		 WHERE kind IN ('plan','normal') AND status='active' AND target_date IS NOT NULL AND TRIM(target_date) != ''`)
	if err != nil {
		return err
	}
	var plans []planRow
	for rows.Next() {
		var p planRow
		var ds string
		if err := rows.Scan(&p.id, &p.title, &ds); err != nil {
			rows.Close()
			return err
		}
		p.due = parseDate(ds)
		plans = append(plans, p)
	}
	rows.Close()

	activeKeys := map[string]bool{}
	for _, p := range plans {
		activeKeys["plan-remind:"+p.id] = true
	}
	orphans, err := s.tagTaskPairs("plan-remind:%")
	if err != nil {
		return err
	}
	for _, o := range orphans {
		if !activeKeys[o.tag] {
			tasks.delete(o.taskID)
		}
	}

	today := localToday()
	horizon := today.AddDate(0, 0, 31)
	for _, p := range plans {
		tag := "plan-remind:" + p.id
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
		taskTitle := "计划提醒 · " + p.title
		desc := "计划「" + p.title + "」截止日 " + fmtDate(p.due)
		dueAt := localNoon(p.due)
		tags := []string{tag, "计划提醒", "plan-due:" + fmtDate(p.due)}
		if id, ok, _ := tasks.findIDByTag(tag); ok {
			ex, err := tasks.get(id)
			if err == nil && (ex.Status == "done" || ex.Status == "cancelled") {
				continue
			}
			dp := desc
			tasks.update(id, UpdateTaskInput{
				Title: &taskTitle, Description: &dp, descSet: true,
				DueAt: &dueAt, dueSet: true, Priority: &priority, Tags: &tags,
			})
		} else {
			dp := desc
			tasks.create(CreateTaskInput{Title: taskTitle, Description: &dp, Priority: &priority, DueAt: &dueAt, Tags: &tags})
		}
	}
	return nil
}

type tagTaskPair struct{ taskID, tag string }

func (s *goalService) tagTaskPairs(like string) ([]tagTaskPair, error) {
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

func localNoon(day time.Time) time.Time {
	n := time.Date(day.Year(), day.Month(), day.Day(), 12, 0, 0, 0, time.Local)
	return n.UTC()
}

func parseCheckinAt(s *string) (time.Time, time.Time) {
	if s != nil {
		raw := strings.TrimSpace(*s)
		if raw != "" {
			if t, err := time.Parse(time.RFC3339, raw); err == nil {
				local := t.In(time.Local)
				trunc := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), 0, 0, 0, time.Local)
				return trunc.UTC(), trunc
			}
			for _, f := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05", "2006-01-02 15:04"} {
				if t, err := time.ParseInLocation(f, raw, time.Local); err == nil {
					trunc := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, time.Local)
					return trunc.UTC(), trunc
				}
			}
		}
	}
	now := time.Now()
	trunc := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, time.Local)
	return trunc.UTC(), trunc
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// migrateGoalsAndHabits ports the one-shot desktop migration (no-op on a fresh web DB).
func migrateGoalsAndHabits(db *DB) error {
	db.sql.Exec(`UPDATE goals SET kind='plan' WHERE kind='normal' OR kind IS NULL OR kind=''`)
	db.sql.Exec(`UPDATE goals SET kind='habit'
		WHERE kind='checkin' AND COALESCE(start_value,0)=0 AND COALESCE(target_value,0)=66
		  AND (unit IS NULL OR unit='' OR unit='天')`)
	return nil
}
