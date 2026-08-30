package core

import (
	"database/sql"
	"time"
)

// QuickNote mirrors models/quick_note.rs.
type QuickNote struct {
	ID        string    `json:"id"`
	Content   string    `json:"content"`
	NoteType  *string   `json:"noteType,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	Tags      []string  `json:"tags"`
}

type CreateQuickNoteInput struct {
	Content  string    `json:"content"`
	NoteType *string   `json:"noteType,omitempty"`
	Tags     *[]string `json:"tags,omitempty"`
}

type quickNoteService struct{ db *DB }

func newQuickNoteService(db *DB) *quickNoteService { return &quickNoteService{db: db} }

func (s *quickNoteService) create(in CreateQuickNoteInput) (QuickNote, error) {
	id := newID()
	now := nowUTC()
	tags := []string{}
	if in.Tags != nil {
		tags = *in.Tags
	}
	tx, err := s.db.sql.Begin()
	if err != nil {
		return QuickNote{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO quick_notes (id, content, note_type, created_at) VALUES (?, ?, ?, ?)`,
		id, in.Content, in.NoteType, rfc3339(now)); err != nil {
		return QuickNote{}, err
	}
	if err := setEntityTags(tx, "quick_note_tags", "quick_note_id", id, tags); err != nil {
		return QuickNote{}, err
	}
	if err := upsertSearchIndex(tx, "quick_note", id, "Quick Note", in.Content); err != nil {
		return QuickNote{}, err
	}
	if err := tx.Commit(); err != nil {
		return QuickNote{}, err
	}
	return s.get(id)
}

func (s *quickNoteService) get(id string) (QuickNote, error) {
	var (
		n        QuickNote
		noteType sql.NullString
		created  string
	)
	err := s.db.sql.QueryRow(
		`SELECT id, content, note_type, created_at FROM quick_notes WHERE id = ?`, id).
		Scan(&n.ID, &n.Content, &noteType, &created)
	if err == sql.ErrNoRows {
		return QuickNote{}, notFound("quick note " + id)
	}
	if err != nil {
		return QuickNote{}, err
	}
	n.NoteType = nullStr(noteType)
	n.CreatedAt = parseRFC3339(created)
	tags, err := getEntityTags(s.db.sql, "quick_note_tags", "quick_note_id", id)
	if err != nil {
		return QuickNote{}, err
	}
	n.Tags = tags
	return n, nil
}

func (s *quickNoteService) list(limit *int) ([]QuickNote, error) {
	q := `SELECT id, content, note_type, created_at FROM quick_notes ORDER BY created_at DESC`
	var args []any
	if limit != nil {
		q += ` LIMIT ?`
		args = append(args, *limit)
	}
	rows, err := s.db.sql.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type staged struct {
		n QuickNote
	}
	var items []QuickNote
	for rows.Next() {
		var (
			n        QuickNote
			noteType sql.NullString
			created  string
		)
		if err := rows.Scan(&n.ID, &n.Content, &noteType, &created); err != nil {
			return nil, err
		}
		n.NoteType = nullStr(noteType)
		n.CreatedAt = parseRFC3339(created)
		items = append(items, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []QuickNote{}
	for _, n := range items {
		tags, err := getEntityTags(s.db.sql, "quick_note_tags", "quick_note_id", n.ID)
		if err != nil {
			return nil, err
		}
		n.Tags = tags
		out = append(out, n)
	}
	return out, nil
}

func (s *quickNoteService) delete(id string) error {
	tx, err := s.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM quick_notes WHERE id = ?", id); err != nil {
		return err
	}
	if err := removeSearchIndex(tx, "quick_note", id); err != nil {
		return err
	}
	return tx.Commit()
}
