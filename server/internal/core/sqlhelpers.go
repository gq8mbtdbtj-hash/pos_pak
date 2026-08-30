package core

import (
	"database/sql"
	"fmt"
	"time"
)

// appErr is a plain user-facing error whose message is surfaced to the client.
type appErr struct{ msg string }

func (e appErr) Error() string { return e.msg }

func errf(format string, args ...any) error { return appErr{msg: fmt.Sprintf(format, args...)} }
func notFound(what string) error            { return appErr{msg: "未找到：" + what} }

func nullStr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	v := n.String
	return &v
}

func nullTime(n sql.NullString) *time.Time {
	if !n.Valid || n.String == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339Nano, n.String); err == nil {
		u := t.UTC()
		return &u
	}
	if t, err := time.Parse(time.RFC3339, n.String); err == nil {
		u := t.UTC()
		return &u
	}
	return nil
}

func nullFloat(n sql.NullFloat64) *float64 {
	if !n.Valid {
		return nil
	}
	v := n.Float64
	return &v
}

func strOr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}
