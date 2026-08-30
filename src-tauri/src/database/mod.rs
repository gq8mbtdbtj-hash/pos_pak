use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &Path) -> AppResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn with_conn<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&Connection) -> AppResult<T>,
    {
        let conn = self.conn.lock().map_err(|e| AppError::Other(e.to_string()))?;
        f(&conn)
    }

    /// Flush WAL so the main DB file is complete for encryption/export.
    pub fn checkpoint_file(db_path: &Path) -> AppResult<()> {
        if !db_path.exists() {
            return Ok(());
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }

    pub fn checkpoint(&self) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            Ok(())
        })
    }

    fn migrate(&self) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL DEFAULT 'todo',
                    priority TEXT NOT NULL DEFAULT 'medium',
                    due_at TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE
                );

                CREATE TABLE IF NOT EXISTS task_tags (
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (task_id, tag_id)
                );

                CREATE TABLE IF NOT EXISTS habits (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    frequency TEXT NOT NULL DEFAULT 'daily',
                    target INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS habit_records (
                    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
                    date TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0,
                    value REAL,
                    note TEXT,
                    PRIMARY KEY (habit_id, date)
                );

                CREATE TABLE IF NOT EXISTS transactions (
                    id TEXT PRIMARY KEY,
                    amount REAL NOT NULL,
                    type TEXT NOT NULL DEFAULT 'expense',
                    category TEXT NOT NULL,
                    account TEXT,
                    merchant TEXT,
                    note TEXT,
                    occurred_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS transaction_tags (
                    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (transaction_id, tag_id)
                );

                CREATE TABLE IF NOT EXISTS quick_notes (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    note_type TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS quick_note_tags (
                    quick_note_id TEXT NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (quick_note_id, tag_id)
                );

                CREATE TABLE IF NOT EXISTS knowledge_meta (
                    file_path TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_tags (
                    file_path TEXT NOT NULL REFERENCES knowledge_meta(file_path) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (file_path, tag_id)
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                    source_type,
                    source_id,
                    title,
                    content,
                    tokenize = 'unicode61'
                );

                CREATE TABLE IF NOT EXISTS debts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    creditor TEXT,
                    principal REAL NOT NULL,
                    remaining REAL NOT NULL,
                    annual_rate REAL NOT NULL DEFAULT 0,
                    start_date TEXT,
                    due_date TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    note TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS debt_payments (
                    id TEXT PRIMARY KEY,
                    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
                    amount REAL NOT NULL,
                    paid_at TEXT NOT NULL,
                    note TEXT,
                    created_at TEXT NOT NULL,
                    principal_amount REAL NOT NULL DEFAULT 0,
                    interest_amount REAL NOT NULL DEFAULT 0,
                    transaction_id TEXT
                );

                CREATE TABLE IF NOT EXISTS repayment_plans (
                    id TEXT PRIMARY KEY,
                    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    monthly_amount REAL NOT NULL,
                    start_date TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    plan_mode TEXT NOT NULL DEFAULT 'equal_payment',
                    term_months INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS repayment_installments (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL REFERENCES repayment_plans(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    due_date TEXT NOT NULL,
                    amount REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    paid_at TEXT,
                    payment_id TEXT,
                    principal_amount REAL NOT NULL DEFAULT 0,
                    interest_amount REAL NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS goals (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    note TEXT,
                    target_date TEXT,
                    kind TEXT NOT NULL DEFAULT 'plan',
                    status TEXT NOT NULL DEFAULT 'active',
                    progress INTEGER NOT NULL DEFAULT 0,
                    start_value REAL,
                    target_value REAL,
                    unit TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS goal_milestones (
                    id TEXT PRIMARY KEY,
                    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    due_date TEXT,
                    done INTEGER NOT NULL DEFAULT 0,
                    task_id TEXT,
                    habit_id TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS goal_checkins (
                    id TEXT PRIMARY KEY,
                    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                    date TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    progress INTEGER NOT NULL DEFAULT 0,
                    value REAL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal_date
                    ON goal_checkins(goal_id, date);
                ",
            )?;
            // Existing DBs created before plan modes / principal-interest split.
            let _ = conn.execute(
                "ALTER TABLE repayment_plans ADD COLUMN plan_mode TEXT NOT NULL DEFAULT 'equal_payment'",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE repayment_plans ADD COLUMN term_months INTEGER NOT NULL DEFAULT 0",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE repayment_installments ADD COLUMN principal_amount REAL NOT NULL DEFAULT 0",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE repayment_installments ADD COLUMN interest_amount REAL NOT NULL DEFAULT 0",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE debt_payments ADD COLUMN principal_amount REAL NOT NULL DEFAULT 0",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE debt_payments ADD COLUMN interest_amount REAL NOT NULL DEFAULT 0",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE debt_payments ADD COLUMN transaction_id TEXT",
                [],
            );
            // Snapshot of remaining at open (before subsequent principal repayments).
            let _ = conn.execute(
                "ALTER TABLE debts ADD COLUMN opening_remaining REAL",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE goals ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal'",
                [],
            );
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS goal_checkins (
                    id TEXT PRIMARY KEY,
                    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                    date TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    progress INTEGER NOT NULL DEFAULT 0,
                    value REAL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal_date
                    ON goal_checkins(goal_id, date);",
            )?;
            // Legacy rows: treat full amount as principal so repayment still reduces余额.
            conn.execute(
                "UPDATE repayment_installments
                 SET principal_amount = amount
                 WHERE COALESCE(principal_amount, 0) = 0
                   AND COALESCE(interest_amount, 0) = 0
                   AND amount > 0",
                [],
            )?;
            conn.execute(
                "UPDATE debt_payments
                 SET principal_amount = amount
                 WHERE COALESCE(principal_amount, 0) = 0
                   AND COALESCE(interest_amount, 0) = 0
                   AND amount > 0",
                [],
            )?;
            // Backfill opening_remaining once for existing debts.
            conn.execute(
                "UPDATE debts
                 SET opening_remaining = CASE
                   WHEN ABS(remaining - principal) < 0.01 THEN principal
                   ELSE MIN(
                     principal,
                     remaining + COALESCE((
                       SELECT SUM(
                         CASE
                           WHEN COALESCE(p.principal_amount, 0) = 0
                                AND COALESCE(p.interest_amount, 0) = 0
                             THEN p.amount
                           ELSE COALESCE(p.principal_amount, 0)
                         END
                       )
                       FROM debt_payments p WHERE p.debt_id = debts.id
                     ), 0)
                   )
                 END
                 WHERE opening_remaining IS NULL",
                [],
            )?;
            crate::services::goal::migrate_schema_and_habits(conn)?;
            Ok(())
        })
    }
}

pub fn ensure_tag(conn: &Connection, name: &str) -> AppResult<i64> {
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", params![name])?;
    let id: i64 = conn.query_row(
        "SELECT id FROM tags WHERE name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn set_entity_tags(
    conn: &Connection,
    table: &str,
    entity_col: &str,
    entity_id: &str,
    tags: &[String],
) -> AppResult<()> {
    conn.execute(
        &format!("DELETE FROM {table} WHERE {entity_col} = ?1"),
        params![entity_id],
    )?;
    for tag in tags {
        let tag_id = ensure_tag(conn, tag)?;
        conn.execute(
            &format!("INSERT INTO {table} ({entity_col}, tag_id) VALUES (?1, ?2)"),
            params![entity_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn get_entity_tags(conn: &Connection, table: &str, entity_col: &str, entity_id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT t.name FROM tags t
         JOIN {table} et ON et.tag_id = t.id
         WHERE et.{entity_col} = ?1
         ORDER BY t.name"
    ))?;
    let tags = stmt
        .query_map(params![entity_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(tags)
}

pub fn upsert_search_index(
    conn: &Connection,
    source_type: &str,
    source_id: &str,
    title: &str,
    content: &str,
) -> AppResult<()> {
    conn.execute(
        "DELETE FROM search_index WHERE source_type = ?1 AND source_id = ?2",
        params![source_type, source_id],
    )?;
    conn.execute(
        "INSERT INTO search_index (source_type, source_id, title, content) VALUES (?1, ?2, ?3, ?4)",
        params![source_type, source_id, title, content],
    )?;
    Ok(())
}

pub fn remove_search_index(conn: &Connection, source_type: &str, source_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM search_index WHERE source_type = ?1 AND source_id = ?2",
        params![source_type, source_id],
    )?;
    Ok(())
}
