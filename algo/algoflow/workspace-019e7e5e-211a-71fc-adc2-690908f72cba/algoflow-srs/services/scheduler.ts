/**
 * ============================================================================
 * AlgoFlow Spaced Repetition — SchedulerService
 * ============================================================================
 *
 * Orchestrates the review cycle:
 *   1. Query problems due today (or overdue) for a user
 *   2. Compute priority scores for queue ordering
 *   3. Update schedule after each review
 *   4. Log to review history
 *
 * Uses parameterized queries throughout (no SQL injection surface).
 * All date math is UTC to avoid timezone issues.
 * ============================================================================
 */

import {
  computeNextReviewFromDB,
  computePriority,
  todayUTC,
  formatDateUTC,
  type Rating,
  type Difficulty,
} from "./sm2";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DueProblem {
  problemId: number;
  externalId: string;
  platform: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  url: string | null;
  easeFactor: number;
  intervalDays: number;
  repetitionCount: number;
  streakCorrect: number;
  nextReviewDate: string;     // YYYY-MM-DD
  daysOverdue: number;
  priority: number;           // computed score
  lastRating: number | null;
  totalReviews: number;
}

export interface ReviewSubmission {
  userId: number;
  problemId: number;
  rating: Rating;
  timeSpentMs?: number;
}

export interface ReviewResult {
  success: boolean;
  nextReviewDate: string;
  intervalDays: number;
  easeFactor: number;
  wasCorrect: boolean;
}

export interface DailyStats {
  reviewed: number;
  correct: number;
  incorrect: number;
  newProblems: number;
  avgEaseFactor: number;
}

// ─── Database interface (abstracted for testability) ─────────────────────────

export interface DatabaseAdapter {
  query(sql: string, params: any[]): Promise<{ rows: any[] }>;
}

// ─── SchedulerService ───────────────────────────────────────────────────────

export class SchedulerService {
  private db: DatabaseAdapter;

  constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  /**
   * Get all problems due today (or overdue) for a user, ordered by priority.
   *
   * Uses the idx_review_priority index for fast retrieval.
   * Results are enriched with priority scores computed in application code.
   */
  async getDueProblems(userId: number, limit = 50): Promise<DueProblem[]> {
    const today = formatDateUTC(todayUTC());

    const result = await this.db.query(
      `SELECT
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
        rs.streak_correct,
        rs.next_review_date,
        rs.total_reviews,
        rs.last_rating,
        (CURRENT_DATE - rs.next_review_date) AS days_overdue
      FROM review_schedule rs
      JOIN problems p ON p.id = rs.problem_id
      WHERE rs.user_id = $1
        AND rs.next_review_date <= $2::date
      ORDER BY rs.next_review_date ASC, rs.ease_factor ASC
      LIMIT $3`,
      [userId, today, limit]
    );

    // Enrich with priority scores
    const problems: DueProblem[] = result.rows.map((row) => {
      const nextReviewDate = new Date(row.next_review_date);
      const priority = computePriority(
        nextReviewDate,
        row.ease_factor,
        row.streak_correct,
        row.last_rating
      );

      return {
        problemId: row.problem_id,
        externalId: row.external_id,
        platform: row.platform,
        title: row.title,
        difficulty: (row.difficulty as Difficulty) || "Med",
        tags: row.tags || [],
        url: row.url,
        easeFactor: row.ease_factor,
        intervalDays: row.interval_days,
        repetitionCount: row.repetition_count,
        streakCorrect: row.streak_correct,
        nextReviewDate: row.next_review_date.toISOString().slice(0, 10),
        daysOverdue: parseInt(row.days_overdue, 10),
        priority,
        lastRating: row.last_rating,
        totalReviews: row.total_reviews,
      };
    });

    // Sort by priority (highest first)
    problems.sort((a, b) => b.priority - a.priority);

    return problems;
  }

  /**
   * Submit a review rating for a problem.
   *
   * This is the core write path:
   *   1. Read current SM-2 state
   *   2. Compute next review via SM-2 algorithm
   *   3. Update review_schedule
   *   4. Insert into review_history
   *
   * All in a single transaction.
   */
  async submitReview(submission: ReviewSubmission): Promise<ReviewResult> {
    const { userId, problemId, rating, timeSpentMs } = submission;
    const today = formatDateUTC(todayUTC());

    // Begin transaction
    await this.db.query("BEGIN", []);

    try {
      // Read current state (single row, O(1) via unique index)
      const current = await this.db.query(
        `SELECT ease_factor, interval_days, repetition_count, streak_correct
         FROM review_schedule
         WHERE user_id = $1 AND problem_id = $2
         FOR UPDATE`,                              -- row-level lock
        [userId, problemId]
      );

      if (current.rows.length === 0) {
        // First review for this problem — create the schedule entry
        const result = await this._createFirstReview(submission);
        await this.db.query("COMMIT", []);
        return result;
      }

      const row = current.rows[0];

      // Get problem difficulty
      const probResult = await this.db.query(
        `SELECT difficulty FROM problems WHERE id = $1`,
        [problemId]
      );
      const difficulty: Difficulty = probResult.rows[0]?.difficulty || "Med";

      // Compute next review
      const result = computeNextReviewFromDB(
        row.ease_factor,
        row.interval_days,
        row.repetition_count,
        row.streak_correct,
        rating,
        difficulty
      );

      // Update schedule (atomic)
      await this.db.query(
        `UPDATE review_schedule SET
          ease_factor = $1,
          interval_days = $2,
          repetition_count = $3,
          streak_correct = $4,
          next_review_date = $5::date,
          last_review_date = $6::date,
          last_rating = $7,
          total_reviews = total_reviews + 1,
          updated_at = NOW()
        WHERE user_id = $8 AND problem_id = $9`,
        [
          result.easeFactor,
          result.intervalDays,
          result.repetitionCount,
          result.streakCorrect,
          formatDateUTC(result.nextReviewDate),
          today,
          rating,
          userId,
          problemId,
        ]
      );

      // Insert history (append-only)
      await this.db.query(
        `INSERT INTO review_history
          (user_id, problem_id, rating, ease_before, interval_before,
           ease_after, interval_after, time_spent_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          problemId,
          rating,
          row.ease_factor,
          row.interval_days,
          result.easeFactor,
          result.intervalDays,
          timeSpentMs || null,
        ]
      );

      await this.db.query("COMMIT", []);

      return {
        success: true,
        nextReviewDate: formatDateUTC(result.nextReviewDate),
        intervalDays: result.intervalDays,
        easeFactor: result.easeFactor,
        wasCorrect: result.wasCorrect,
      };
    } catch (err) {
      await this.db.query("ROLLBACK", []);
      throw err;
    }
  }

  /**
   * Add a problem to the user's review schedule (first encounter).
   */
  async addProblem(
    userId: number,
    problemId: number
  ): Promise<void> {
    const today = formatDateUTC(todayUTC());

    await this.db.query(
      `INSERT INTO review_schedule
        (user_id, problem_id, ease_factor, interval_days, repetition_count,
         next_review_date, streak_correct)
      VALUES ($1, $2, 2.5, 1, 0, $3::date, 0)
      ON CONFLICT (user_id, problem_id) DO NOTHING`,
      [userId, problemId, today]
    );
  }

  /**
   * Get daily statistics for a user.
   */
  async getDailyStats(userId: number, date?: string): Promise<DailyStats> {
    const targetDate = date || formatDateUTC(todayUTC());

    const result = await this.db.query(
      `SELECT
        COUNT(*) AS reviewed,
        COUNT(*) FILTER (WHERE rating >= 3) AS correct,
        COUNT(*) FILTER (WHERE rating < 3) AS incorrect,
        AVG(ease_after) AS avg_ease
      FROM review_history
      WHERE user_id = $1
        AND reviewed_at::date = $2::date`,
      [userId, targetDate]
    );

    const row = result.rows[0] || {};

    // New problems added today
    const newResult = await this.db.query(
      `SELECT COUNT(*) AS count
       FROM review_schedule
       WHERE user_id = $1
         AND created_at::date = $2::date`,
      [userId, targetDate]
    );

    return {
      reviewed: parseInt(row.reviewed, 10) || 0,
      correct: parseInt(row.correct, 10) || 0,
      incorrect: parseInt(row.incorrect, 10) || 0,
      newProblems: parseInt(newResult.rows[0]?.count, 10) || 0,
      avgEaseFactor: parseFloat(row.avg_ease) || 2.5,
    };
  }

  /**
   * Get review forecast: how many problems are due each day for the next N days.
   */
  async getForecast(userId: number, days = 14): Promise<{ date: string; count: number }[]> {
    const today = todayUTC();

    const result = await this.db.query(
      `SELECT
        next_review_date::date AS review_date,
        COUNT(*) AS count
      FROM review_schedule
      WHERE user_id = $1
        AND next_review_date >= $2::date
        AND next_review_date < ($2::date + $3::int)
      GROUP BY next_review_date::date
      ORDER BY next_review_date::date`,
      [userId, formatDateUTC(today), days]
    );

    return result.rows.map((row) => ({
      date: row.review_date.toISOString().slice(0, 10),
      count: parseInt(row.count, 10),
    }));
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async _createFirstReview(
    submission: ReviewSubmission
  ): Promise<ReviewResult> {
    const { userId, problemId, rating, timeSpentMs } = submission;

    const probResult = await this.db.query(
      `SELECT difficulty FROM problems WHERE id = $1`,
      [problemId]
    );
    const difficulty: Difficulty = probResult.rows[0]?.difficulty || "Med";

    const result = computeNextReviewFromDB(2.5, 1, 0, 0, rating, difficulty);
    const today = formatDateUTC(todayUTC());

    await this.db.query(
      `INSERT INTO review_schedule
        (user_id, problem_id, ease_factor, interval_days, repetition_count,
         next_review_date, last_review_date, last_rating, streak_correct, total_reviews)
      VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, 1)
      ON CONFLICT (user_id, problem_id) DO UPDATE SET
        ease_factor = EXCLUDED.ease_factor,
        interval_days = EXCLUDED.interval_days,
        repetition_count = EXCLUDED.repetition_count,
        next_review_date = EXCLUDED.next_review_date,
        last_review_date = EXCLUDED.last_review_date,
        last_rating = EXCLUDED.last_rating,
        streak_correct = EXCLUDED.streak_correct,
        total_reviews = review_schedule.total_reviews + 1`,
      [
        userId, problemId,
        result.easeFactor, result.intervalDays, result.repetitionCount,
        formatDateUTC(result.nextReviewDate), today,
        rating, result.streakCorrect,
      ]
    );

    await this.db.query(
      `INSERT INTO review_history
        (user_id, problem_id, rating, ease_before, interval_before,
         ease_after, interval_after, time_spent_ms)
      VALUES ($1, $2, $3, 2.5, 1, $4, $5, $6)`,
      [userId, problemId, rating, result.easeFactor, result.intervalDays, timeSpentMs || null]
    );

    return {
      success: true,
      nextReviewDate: formatDateUTC(result.nextReviewDate),
      intervalDays: result.intervalDays,
      easeFactor: result.easeFactor,
      wasCorrect: result.wasCorrect,
    };
  }
}
