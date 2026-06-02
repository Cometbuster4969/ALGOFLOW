-- ============================================================================
-- AlgoFlow Spaced Repetition — PostgreSQL Schema
-- ============================================================================
--
-- Design goals:
--   1. O(1) lookup for "problems due today" via covering index
--   2. Timezone-agnostic: all dates stored as UTC DATE (not TIMESTAMP)
--   3. Separate table for review history to support analytics
--   4. Composite index on (user_id, next_review_date) for the hot query
-- ============================================================================

-- ─── Problems table (reference) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS problems (
    id              BIGSERIAL PRIMARY KEY,
    external_id     TEXT UNIQUE NOT NULL,          -- e.g. "lc:two-sum" or "cf:1800A"
    platform        TEXT NOT NULL CHECK (platform IN ('leetcode', 'codeforces', 'atcoder', 'other')),
    title           TEXT NOT NULL,
    difficulty      TEXT CHECK (difficulty IN ('Easy', 'Med', 'Hard')),
    tags            TEXT[] DEFAULT '{}',           -- e.g. {'dp','graphs'}
    url             TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Review schedule (one row per user-problem pair) ────────────────────────

CREATE TABLE IF NOT EXISTS review_schedule (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    problem_id          BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,

    -- SM-2 algorithm state
    ease_factor         DOUBLE PRECISION NOT NULL DEFAULT 2.5,   -- EF ≥ 1.3
    interval_days       INTEGER NOT NULL DEFAULT 1,               -- I (days)
    repetition_count    INTEGER NOT NULL DEFAULT 0,               -- n

    -- Review scheduling
    next_review_date    DATE NOT NULL DEFAULT CURRENT_DATE,       -- always UTC
    last_review_date    DATE,
    last_rating         SMALLINT,                                 -- 1-5

    -- Metadata
    total_reviews       INTEGER NOT NULL DEFAULT 0,
    streak_correct      INTEGER NOT NULL DEFAULT 0,               -- consecutive q ≥ 3
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_problem UNIQUE (user_id, problem_id),
    CONSTRAINT chk_ease_factor CHECK (ease_factor >= 1.3),
    CONSTRAINT chk_interval CHECK (interval_days >= 1),
    CONSTRAINT chk_rating CHECK (last_rating IS NULL OR (last_rating >= 1 AND last_rating <= 5))
);

-- ─── Review history (append-only log for analytics) ─────────────────────────

CREATE TABLE IF NOT EXISTS review_history (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    problem_id      BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    rating          SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    ease_before     DOUBLE PRECISION NOT NULL,
    interval_before INTEGER NOT NULL,
    ease_after      DOUBLE PRECISION NOT NULL,
    interval_after  INTEGER NOT NULL,
    time_spent_ms   INTEGER,                     -- optional: time on problem
    reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES — optimized for the hot "problems due today" query
-- ═══════════════════════════════════════════════════════════════════════════

-- Primary lookup: "give me all problems due today (or earlier) for user X"
-- This is a covering index that includes the columns needed by the scheduler.
CREATE INDEX IF NOT EXISTS idx_review_due
    ON review_schedule (user_id, next_review_date)
    INCLUDE (problem_id, ease_factor, interval_days, repetition_count, streak_correct);

-- For the ORDER BY in the queue (overdue first, then by ease_factor ascending)
CREATE INDEX IF NOT EXISTS idx_review_priority
    ON review_schedule (user_id, next_review_date, ease_factor)
    WHERE next_review_date <= CURRENT_DATE;

-- History analytics: "show me all reviews for user X on problem Y"
CREATE INDEX IF NOT EXISTS idx_history_user_problem
    ON review_history (user_id, problem_id, reviewed_at DESC);

-- Daily stats aggregation
CREATE INDEX IF NOT EXISTS idx_history_date
    ON review_history (reviewed_at);

-- ─── Auto-update timestamp trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_review_schedule_updated
    BEFORE UPDATE ON review_schedule
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- ─── Helper view: problems due today with problem details ───────────────────

CREATE OR REPLACE VIEW v_problems_due_today AS
SELECT
    rs.user_id,
    rs.problem_id,
    p.external_id,
    p.platform,
    p.title,
    p.difficulty,
    p.tags,
    p.url,
    rs.ease_factor,
    rs.interval_days,
    rs.repetition_count,
    rs.next_review_date,
    rs.streak_correct,
    rs.total_reviews,
    rs.last_rating,
    CURRENT_DATE - rs.next_review_date AS days_overdue
FROM review_schedule rs
JOIN problems p ON p.id = rs.problem_id
WHERE rs.next_review_date <= CURRENT_DATE
ORDER BY rs.next_review_date ASC, rs.ease_factor ASC;
