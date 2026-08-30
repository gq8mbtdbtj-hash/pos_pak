package core

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"math"
	"time"
)

// newID returns a random UUIDv4 string (no external dependency).
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func encodeB64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func decodeB64(s string) ([]byte, error) { return base64.StdEncoding.DecodeString(s) }

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round4(v float64) float64 { return math.Round(v*10000) / 10000 }
func round6(v float64) float64 { return math.Round(v*1_000_000) / 1_000_000 }

// nowRFC3339 formats the current UTC instant like chrono's to_rfc3339 (with nanos).
func nowUTC() time.Time { return time.Now().UTC() }

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

// parseRFC3339 tolerates the desktop's stored timestamps, falling back to now.
func parseRFC3339(s string) time.Time {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC()
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC()
	}
	return nowUTC()
}

func parseRFC3339Opt(s *string) *time.Time {
	if s == nil || *s == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339Nano, *s); err == nil {
		u := t.UTC()
		return &u
	}
	if t, err := time.Parse(time.RFC3339, *s); err == nil {
		u := t.UTC()
		return &u
	}
	return nil
}

const dateFmt = "2006-01-02"

// localToday returns today's date in the server's local timezone (Y-M-D at 00:00 local).
func localToday() time.Time {
	n := time.Now()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.Local)
}

// parseDate parses a Y-M-D string; on failure returns today (local).
func parseDate(s string) time.Time {
	if t, err := time.ParseInLocation(dateFmt, s, time.Local); err == nil {
		return t
	}
	if len(s) >= 10 {
		if t, err := time.ParseInLocation(dateFmt, s[:10], time.Local); err == nil {
			return t
		}
	}
	return localToday()
}

func parseDateOpt(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.ParseInLocation(dateFmt, s, time.Local); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func fmtDate(t time.Time) string { return t.Format(dateFmt) }

// addMonths advances a date by n months, clamping the day to the month length.
func addMonths(d time.Time, n int) time.Time {
	year := d.Year()
	month := int(d.Month()) + n
	for month > 12 {
		month -= 12
		year++
	}
	for month < 1 {
		month += 12
		year--
	}
	day := d.Day()
	if maxD := daysInMonth(year, month); day > maxD {
		day = maxD
	}
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.Local)
}

func daysInMonth(year, month int) int {
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.Local).Day()
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
