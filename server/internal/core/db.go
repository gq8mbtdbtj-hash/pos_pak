package core

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

// DB wraps a single-connection SQLite handle. MaxOpenConns(1) serializes access,
// mirroring the desktop `Mutex<Connection>` and avoiding "database is locked".
type DB struct {
	sql *sql.DB
}

func openDB(path string) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", path)
	sdb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	sdb.SetMaxOpenConns(1)
	if err := sdb.Ping(); err != nil {
		sdb.Close()
		return nil, err
	}
	db := &DB{sql: sdb}
	if err := db.migrate(); err != nil {
		sdb.Close()
		return nil, err
	}
	if err := migrateGoalsAndHabits(db); err != nil {
		sdb.Close()
		return nil, err
	}
	return db, nil
}

func (d *DB) Close() error { return d.sql.Close() }

// checkpoint flushes the WAL so the main DB file is complete for sealing.
func (d *DB) checkpoint() error {
	_, err := d.sql.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
	return err
}

func (d *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
		status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium',
		due_at TEXT, created_at TEXT NOT NULL, completed_at TEXT
	);
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE
	);
	CREATE TABLE IF NOT EXISTS task_tags (
		task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (task_id, tag_id)
	);
	CREATE TABLE IF NOT EXISTS habits (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, frequency TEXT NOT NULL DEFAULT 'daily',
		target INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
	);
	CREATE TABLE IF NOT EXISTS habit_records (
		habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
		date TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, value REAL, note TEXT,
		PRIMARY KEY (habit_id, date)
	);
	CREATE TABLE IF NOT EXISTS transactions (
		id TEXT PRIMARY KEY, amount REAL NOT NULL, type TEXT NOT NULL DEFAULT 'expense',
		category TEXT NOT NULL, account TEXT, merchant TEXT, note TEXT,
		occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS transaction_tags (
		transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (transaction_id, tag_id)
	);
	CREATE TABLE IF NOT EXISTS quick_notes (
		id TEXT PRIMARY KEY, content TEXT NOT NULL, note_type TEXT, created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS quick_note_tags (
		quick_note_id TEXT NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (quick_note_id, tag_id)
	);
	CREATE TABLE IF NOT EXISTS knowledge_meta (
		file_path TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS knowledge_tags (
		file_path TEXT NOT NULL REFERENCES knowledge_meta(file_path) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (file_path, tag_id)
	);
	CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
		source_type, source_id, title, content, tokenize = 'unicode61'
	);
	CREATE TABLE IF NOT EXISTS debts (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, creditor TEXT, principal REAL NOT NULL,
		remaining REAL NOT NULL, annual_rate REAL NOT NULL DEFAULT 0, start_date TEXT, due_date TEXT,
		status TEXT NOT NULL DEFAULT 'active', note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		opening_remaining REAL
	);
	CREATE TABLE IF NOT EXISTS debt_payments (
		id TEXT PRIMARY KEY, debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
		amount REAL NOT NULL, paid_at TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
		principal_amount REAL NOT NULL DEFAULT 0, interest_amount REAL NOT NULL DEFAULT 0, transaction_id TEXT
	);
	CREATE TABLE IF NOT EXISTS repayment_plans (
		id TEXT PRIMARY KEY, debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
		title TEXT NOT NULL, monthly_amount REAL NOT NULL, start_date TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
		plan_mode TEXT NOT NULL DEFAULT 'equal_payment', term_months INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE IF NOT EXISTS repayment_installments (
		id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES repayment_plans(id) ON DELETE CASCADE,
		sequence INTEGER NOT NULL, due_date TEXT NOT NULL, amount REAL NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT, payment_id TEXT,
		principal_amount REAL NOT NULL DEFAULT 0, interest_amount REAL NOT NULL DEFAULT 0
	);
	CREATE TABLE IF NOT EXISTS goals (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT, target_date TEXT,
		kind TEXT NOT NULL DEFAULT 'plan', status TEXT NOT NULL DEFAULT 'active',
		progress INTEGER NOT NULL DEFAULT 0, start_value REAL, target_value REAL, unit TEXT,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS goal_milestones (
		id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
		title TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0,
		task_id TEXT, habit_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS goal_checkins (
		id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
		date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
		value REAL, created_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal_date ON goal_checkins(goal_id, date);
	CREATE TABLE IF NOT EXISTS pay_period_snapshots (
		id TEXT PRIMARY KEY, period_start TEXT NOT NULL UNIQUE, period_end TEXT NOT NULL,
		income REAL NOT NULL, expense REAL NOT NULL, net REAL NOT NULL,
		confirmed_at TEXT NOT NULL, note TEXT
	);
	`
	if _, err := d.sql.Exec(schema); err != nil {
		return err
	}
	return nil
}

// ---- Tag helpers (ported from database/mod.rs) ----

func ensureTag(tx *sql.Tx, name string) (int64, error) {
	if _, err := tx.Exec("INSERT OR IGNORE INTO tags(name) VALUES(?)", name); err != nil {
		return 0, err
	}
	var id int64
	err := tx.QueryRow("SELECT id FROM tags WHERE name = ?", name).Scan(&id)
	return id, err
}

func setEntityTags(tx *sql.Tx, table, entityCol, entityID string, tags []string) error {
	if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE %s = ?", table, entityCol), entityID); err != nil {
		return err
	}
	for _, t := range tags {
		tagID, err := ensureTag(tx, t)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(fmt.Sprintf("INSERT INTO %s (%s, tag_id) VALUES (?, ?)", table, entityCol), entityID, tagID); err != nil {
			return err
		}
	}
	return nil
}

func getEntityTags(q queryer, table, entityCol, entityID string) ([]string, error) {
	rows, err := q.Query(fmt.Sprintf(
		"SELECT t.name FROM tags t JOIN %s et ON et.tag_id = t.id WHERE et.%s = ? ORDER BY t.name",
		table, entityCol), entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func upsertSearchIndex(tx *sql.Tx, sourceType, sourceID, title, content string) error {
	if _, err := tx.Exec("DELETE FROM search_index WHERE source_type = ? AND source_id = ?", sourceType, sourceID); err != nil {
		return err
	}
	_, err := tx.Exec("INSERT INTO search_index (source_type, source_id, title, content) VALUES (?, ?, ?, ?)",
		sourceType, sourceID, title, content)
	return err
}

func removeSearchIndex(tx *sql.Tx, sourceType, sourceID string) error {
	_, err := tx.Exec("DELETE FROM search_index WHERE source_type = ? AND source_id = ?", sourceType, sourceID)
	return err
}

// queryer abstracts *sql.DB / *sql.Tx for read helpers.
type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func sortStrings(s []string) { sort.Strings(s) }

func placeholders(n int) string { return strings.TrimRight(strings.Repeat("?,", n), ",") }
