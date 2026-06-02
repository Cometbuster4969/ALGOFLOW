-- AlgoFlow SQLite schema (local desktop MVP)

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS problems (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id     TEXT UNIQUE NOT NULL,
    platform        TEXT NOT NULL,
    title           TEXT NOT NULL,
    difficulty      TEXT,
    tags            TEXT DEFAULT '[]',
    url             TEXT,
    test_cases      TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL DEFAULT 1,
    name            TEXT NOT NULL,
    language        TEXT NOT NULL DEFAULT 'cpp',
    tags            TEXT DEFAULT '[]',
    body            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_user ON templates (user_id);
CREATE INDEX IF NOT EXISTS idx_templates_name ON templates (user_id, name);

CREATE TABLE IF NOT EXISTS review_schedule (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    problem_id          INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    ease_factor         REAL NOT NULL DEFAULT 2.5,
    interval_days       INTEGER NOT NULL DEFAULT 1,
    repetition_count    INTEGER NOT NULL DEFAULT 0,
    next_review_date    TEXT NOT NULL,
    last_review_date    TEXT,
    last_rating         INTEGER,
    total_reviews       INTEGER NOT NULL DEFAULT 0,
    streak_correct      INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, problem_id)
);

CREATE TABLE IF NOT EXISTS review_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    problem_id      INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    rating          INTEGER NOT NULL,
    ease_before     REAL NOT NULL,
    interval_before INTEGER NOT NULL,
    ease_after      REAL NOT NULL,
    interval_after  INTEGER NOT NULL,
    time_spent_ms   INTEGER,
    reviewed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_due
    ON review_schedule (user_id, next_review_date);

CREATE INDEX IF NOT EXISTS idx_history_user_problem
    ON review_history (user_id, problem_id, reviewed_at);
