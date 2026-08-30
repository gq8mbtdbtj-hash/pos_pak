package core

import (
	"database/sql"
	"time"
)

// Task mirrors models/task.rs (camelCase JSON).
type Task struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description *string    `json:"description,omitempty"`
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	DueAt       *time.Time `json:"dueAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	Tags        []string   `json:"tags"`
}

// CreateTaskInput / UpdateTaskInput carry optional fields; UpdateTaskInput.DueAt
// uses a double-optional (present-but-null clears the due date).
type CreateTaskInput struct {
	Title       string     `json:"title"`
	Description *string    `json:"description,omitempty"`
	Priority    *string    `json:"priority,omitempty"`
	DueAt       *time.Time `json:"dueAt,omitempty"`
	Tags        *[]string  `json:"tags,omitempty"`
}

func priorityFromDaysUntilDue(daysLeft int) string {
	if daysLeft <= 1 {
		return "high"
	}
	return "low"
}

type taskService struct{ db *DB }

func newTaskService(db *DB) *taskService { return &taskService{db: db} }

func (s *taskService) create(in CreateTaskInput) (Task, error) {
	id := newID()
	now := nowUTC()
	priority := "medium"
	if in.Priority != nil && *in.Priority != "" {
		priority = normalizePriority(*in.Priority)
	}
	tags := []string{}
	if in.Tags != nil {
		tags = *in.Tags
	}
	var dueAt any
	if in.DueAt != nil {
		dueAt = rfc3339(*in.DueAt)
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO tasks (id, title, description, status, priority, due_at, created_at)
		 VALUES (?, ?, ?, 'todo', ?, ?, ?)`,
		id, in.Title, in.Description, priority, dueAt, rfc3339(now)); err != nil {
		return Task{}, err
	}
	if err := setEntityTags(tx, "task_tags", "task_id", id, tags); err != nil {
		return Task{}, err
	}
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	if err := upsertSearchIndex(tx, "task", id, in.Title, desc); err != nil {
		return Task{}, err
	}
	if err := tx.Commit(); err != nil {
		return Task{}, err
	}
	return s.get(id)
}

func (s *taskService) get(id string) (Task, error) {
	var (
		t                   Task
		desc, dueAt, comp   sql.NullString
		status, priority    string
		created             string
	)
	err := s.db.sql.QueryRow(
		`SELECT id, title, description, status, priority, due_at, created_at, completed_at
		 FROM tasks WHERE id = ?`, id).
		Scan(&t.ID, &t.Title, &desc, &status, &priority, &dueAt, &created, &comp)
	if err == sql.ErrNoRows {
		return Task{}, notFound("task " + id)
	}
	if err != nil {
		return Task{}, err
	}
	t.Description = nullStr(desc)
	t.Status = status
	t.Priority = priority
	t.DueAt = nullTime(dueAt)
	t.CreatedAt = parseRFC3339(created)
	t.CompletedAt = nullTime(comp)
	tags, err := getEntityTags(s.db.sql, "task_tags", "task_id", id)
	if err != nil {
		return Task{}, err
	}
	t.Tags = tags
	return t, nil
}

func (s *taskService) list(statusFilter *string) ([]Task, error) {
	var rows *sql.Rows
	var err error
	if statusFilter != nil {
		rows, err = s.db.sql.Query(
			`SELECT id, title, description, status, priority, due_at, created_at, completed_at
			 FROM tasks WHERE status = ? ORDER BY created_at DESC`, *statusFilter)
	} else {
		rows, err = s.db.sql.Query(
			`SELECT id, title, description, status, priority, due_at, created_at, completed_at
			 FROM tasks ORDER BY created_at DESC`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	var ids []string
	var staged []Task
	for rows.Next() {
		var (
			t                Task
			desc, dueAt, comp sql.NullString
			status, priority string
			created          string
		)
		if err := rows.Scan(&t.ID, &t.Title, &desc, &status, &priority, &dueAt, &created, &comp); err != nil {
			return nil, err
		}
		t.Description = nullStr(desc)
		t.Status = status
		t.Priority = priority
		t.DueAt = nullTime(dueAt)
		t.CreatedAt = parseRFC3339(created)
		t.CompletedAt = nullTime(comp)
		staged = append(staged, t)
		ids = append(ids, t.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, t := range staged {
		tags, err := getEntityTags(s.db.sql, "task_tags", "task_id", t.ID)
		if err != nil {
			return nil, err
		}
		t.Tags = tags
		out = append(out, t)
	}
	return out, nil
}

func (s *taskService) listToday() ([]Task, error) {
	all, err := s.list(nil)
	if err != nil {
		return nil, err
	}
	today := nowUTC().Truncate(24 * time.Hour)
	out := []Task{}
	for _, t := range all {
		if t.Status == "done" || t.Status == "cancelled" {
			continue
		}
		if t.DueAt == nil || !dateAfter(*t.DueAt, today) {
			out = append(out, t)
		}
	}
	return out, nil
}

// dateAfter reports whether a's UTC date is strictly after b's UTC date.
func dateAfter(a, b time.Time) bool {
	ad := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	bd := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, time.UTC)
	return ad.After(bd)
}

// UpdateTaskInput uses tri-state pointers decoded manually in rpc.go so that
// "due_at present but null" clears the date. Here nil means "leave unchanged".
type UpdateTaskInput struct {
	Title       *string
	Description *string
	descSet     bool
	Status      *string
	Priority    *string
	DueAt       *time.Time
	dueSet      bool
	Tags        *[]string
}

func (s *taskService) update(id string, in UpdateTaskInput) (Task, error) {
	existing, err := s.get(id)
	if err != nil {
		return Task{}, err
	}
	title := existing.Title
	if in.Title != nil {
		title = *in.Title
	}
	desc := existing.Description
	if in.descSet {
		desc = in.Description
	}
	prevStatus := existing.Status
	status := existing.Status
	if in.Status != nil {
		status = normalizeStatus(*in.Status)
	}
	priority := existing.Priority
	if in.Priority != nil {
		priority = normalizePriority(*in.Priority)
	}
	dueAt := existing.DueAt
	if in.dueSet {
		dueAt = in.DueAt
	}
	tags := existing.Tags
	if in.Tags != nil {
		tags = *in.Tags
	}
	var completed *time.Time
	switch {
	case status == "done" && prevStatus != "done":
		n := nowUTC()
		completed = &n
	case status != "done":
		completed = nil
	default:
		completed = existing.CompletedAt
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	var dueVal, compVal any
	if dueAt != nil {
		dueVal = rfc3339(*dueAt)
	}
	if completed != nil {
		compVal = rfc3339(*completed)
	}
	if _, err := tx.Exec(
		`UPDATE tasks SET title=?, description=?, status=?, priority=?, due_at=?, completed_at=? WHERE id=?`,
		title, desc, status, priority, dueVal, compVal, id); err != nil {
		return Task{}, err
	}
	if err := setEntityTags(tx, "task_tags", "task_id", id, tags); err != nil {
		return Task{}, err
	}
	d := ""
	if desc != nil {
		d = *desc
	}
	if err := upsertSearchIndex(tx, "task", id, title, d); err != nil {
		return Task{}, err
	}
	if err := tx.Commit(); err != nil {
		return Task{}, err
	}
	return s.get(id)
}

func (s *taskService) complete(id string) (Task, error) {
	done := "done"
	return s.update(id, UpdateTaskInput{Status: &done})
}

func (s *taskService) delete(id string) error {
	tx, err := s.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM tasks WHERE id = ?", id); err != nil {
		return err
	}
	if err := removeSearchIndex(tx, "task", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *taskService) findIDByTag(tag string) (string, bool, error) {
	var id string
	err := s.db.sql.QueryRow(
		`SELECT tt.task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name = ? LIMIT 1`, tag).
		Scan(&id)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

func (s *taskService) countTodayProgress() (int, int, error) {
	tasks, err := s.listToday()
	if err != nil {
		return 0, 0, err
	}
	total := len(tasks)
	done := 0
	for _, t := range tasks {
		if t.Status == "done" {
			done++
		}
	}
	return done, total, nil
}

func normalizeStatus(s string) string {
	switch s {
	case "doing", "done", "cancelled":
		return s
	default:
		return "todo"
	}
}

func normalizePriority(s string) string {
	switch s {
	case "low", "high":
		return s
	default:
		return "medium"
	}
}
