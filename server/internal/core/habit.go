package core

import (
	"database/sql"
	"time"
)

// Habit legacy table support. The web UI drives habits through goals (kind=habit);
// these commands remain for API completeness.
type Habit struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Frequency string    `json:"frequency"`
	Target    int       `json:"target"`
	CreatedAt time.Time `json:"createdAt"`
	Enabled   bool      `json:"enabled"`
}

type HabitWithStats struct {
	Habit          Habit   `json:"habit"`
	Streak         int     `json:"streak"`
	TargetDays     int     `json:"targetDays"`
	Formed         bool    `json:"formed"`
	CompletionRate float64 `json:"completionRate"`
	CheckedToday   bool    `json:"checkedToday"`
}

type CreateHabitInput struct {
	Name      string  `json:"name"`
	Frequency *string `json:"frequency,omitempty"`
	Target    *int    `json:"target,omitempty"`
}

type habitService struct{ db *DB }

func newHabitService(db *DB) *habitService { return &habitService{db: db} }

func (s *habitService) create(in CreateHabitInput) (Habit, error) {
	id := newID()
	now := nowUTC()
	freq := "daily"
	if in.Frequency != nil {
		freq = *in.Frequency
	}
	target := 1
	if in.Target != nil {
		target = *in.Target
	}
	if _, err := s.db.sql.Exec(
		`INSERT INTO habits (id, name, frequency, target, created_at, enabled) VALUES (?, ?, ?, ?, ?, 1)`,
		id, in.Name, freq, target, rfc3339(now)); err != nil {
		return Habit{}, err
	}
	return Habit{ID: id, Name: in.Name, Frequency: freq, Target: target, CreatedAt: now, Enabled: true}, nil
}

func (s *habitService) listWithStats() ([]HabitWithStats, error) {
	rows, err := s.db.sql.Query(`SELECT id, name, frequency, target, created_at, enabled FROM habits WHERE enabled = 1 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HabitWithStats{}
	for rows.Next() {
		var (
			h       Habit
			created string
			enabled int
		)
		if err := rows.Scan(&h.ID, &h.Name, &h.Frequency, &h.Target, &created, &enabled); err != nil {
			return nil, err
		}
		h.CreatedAt = parseRFC3339(created)
		h.Enabled = enabled == 1
		out = append(out, HabitWithStats{Habit: h, TargetDays: checkinFormDays})
	}
	return out, rows.Err()
}

func (s *habitService) checkIn(id string) error {
	date := fmtDate(localToday())
	_, err := s.db.sql.Exec(
		`INSERT INTO habit_records (habit_id, date, completed, value) VALUES (?, ?, 1, 1)
		 ON CONFLICT(habit_id, date) DO UPDATE SET completed=1, value=1`, id, date)
	return err
}

func (s *habitService) uncheck(id string) error {
	_, err := s.db.sql.Exec(`DELETE FROM habit_records WHERE habit_id = ? AND date = ?`, id, fmtDate(localToday()))
	return err
}

func (s *habitService) delete(id string) error {
	_, err := s.db.sql.Exec(`DELETE FROM habits WHERE id = ?`, id)
	return err
}

var _ = sql.ErrNoRows
