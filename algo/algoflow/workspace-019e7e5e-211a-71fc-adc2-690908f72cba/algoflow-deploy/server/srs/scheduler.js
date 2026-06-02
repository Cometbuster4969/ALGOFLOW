/**
 * SchedulerService — SQLite-native port for unified AlgoFlow server.
 */

const {
  computeNextReviewFromDB,
  computePriority,
  todayUTC,
  formatDateUTC,
} = require("./sm2");

const DEFAULT_USER_ID = 1;

class SchedulerService {
  constructor(db) {
    this.db = db;
  }

  async getDueProblems(userId, limit = 50) {
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
        CAST(julianday(?) - julianday(rs.next_review_date) AS INTEGER) AS days_overdue
      FROM review_schedule rs
      JOIN problems p ON p.id = rs.problem_id
      WHERE rs.user_id = ?
        AND rs.next_review_date <= ?
      ORDER BY rs.next_review_date ASC, rs.ease_factor ASC
      LIMIT ?`,
      [today, userId, today, limit]
    );

    const problems = result.rows.map((row) => {
      const nextReviewDate = new Date(row.next_review_date + "T00:00:00Z");
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
        difficulty: row.difficulty || "Med",
        tags: row.tags || [],
        url: row.url,
        easeFactor: row.ease_factor,
        intervalDays: row.interval_days,
        repetitionCount: row.repetition_count,
        streakCorrect: row.streak_correct,
        nextReviewDate: row.next_review_date,
        daysOverdue: row.days_overdue,
        priority,
        lastRating: row.last_rating,
        totalReviews: row.total_reviews,
      };
    });

    problems.sort((a, b) => b.priority - a.priority);
    return problems;
  }

  async submitReview(submission) {
    const { userId, problemId, rating, timeSpentMs } = submission;
    const today = formatDateUTC(todayUTC());

    await this.db.query("BEGIN", []);

    try {
      const current = await this.db.query(
        `SELECT ease_factor, interval_days, repetition_count, streak_correct
         FROM review_schedule
         WHERE user_id = ? AND problem_id = ?`,
        [userId, problemId]
      );

      if (current.rows.length === 0) {
        const result = await this._createFirstReview(submission);
        await this.db.query("COMMIT", []);
        return result;
      }

      const row = current.rows[0];
      const probResult = await this.db.query(
        `SELECT difficulty FROM problems WHERE id = ?`,
        [problemId]
      );
      const difficulty = probResult.rows[0]?.difficulty || "Med";

      const result = computeNextReviewFromDB(
        row.ease_factor,
        row.interval_days,
        row.repetition_count,
        row.streak_correct,
        rating,
        difficulty
      );

      await this.db.query(
        `UPDATE review_schedule SET
          ease_factor = ?,
          interval_days = ?,
          repetition_count = ?,
          streak_correct = ?,
          next_review_date = ?,
          last_review_date = ?,
          last_rating = ?,
          total_reviews = total_reviews + 1,
          updated_at = datetime('now')
        WHERE user_id = ? AND problem_id = ?`,
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

      await this.db.query(
        `INSERT INTO review_history
          (user_id, problem_id, rating, ease_before, interval_before,
           ease_after, interval_after, time_spent_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

  async addProblem(userId, problemId) {
    const today = formatDateUTC(todayUTC());
    await this.db.query(
      `INSERT OR IGNORE INTO review_schedule
        (user_id, problem_id, ease_factor, interval_days, repetition_count,
         next_review_date, streak_correct)
      VALUES (?, ?, 2.5, 1, 0, ?, 0)`,
      [userId, problemId, today]
    );
  }

  async getDailyStats(userId, date) {
    const targetDate = date || formatDateUTC(todayUTC());

    const result = await this.db.query(
      `SELECT
        COUNT(*) AS reviewed,
        SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS correct,
        SUM(CASE WHEN rating < 3 THEN 1 ELSE 0 END) AS incorrect,
        AVG(ease_after) AS avg_ease
      FROM review_history
      WHERE user_id = ?
        AND date(reviewed_at) = ?`,
      [userId, targetDate]
    );

    const row = result.rows[0] || {};
    const newResult = await this.db.query(
      `SELECT COUNT(*) AS count
       FROM review_schedule
       WHERE user_id = ?
         AND date(created_at) = ?`,
      [userId, targetDate]
    );

    return {
      reviewed: Number(row.reviewed) || 0,
      correct: Number(row.correct) || 0,
      incorrect: Number(row.incorrect) || 0,
      newProblems: Number(newResult.rows[0]?.count) || 0,
      avgEaseFactor: parseFloat(row.avg_ease) || 2.5,
    };
  }

  async getForecast(userId, days = 14) {
    const today = formatDateUTC(todayUTC());
    const end = formatDateUTC(
      (() => {
        const d = todayUTC();
        d.setUTCDate(d.getUTCDate() + days);
        return d;
      })()
    );

    const result = await this.db.query(
      `SELECT next_review_date AS review_date, COUNT(*) AS count
      FROM review_schedule
      WHERE user_id = ?
        AND next_review_date >= ?
        AND next_review_date < ?
      GROUP BY next_review_date
      ORDER BY next_review_date`,
      [userId, today, end]
    );

    return result.rows.map((row) => ({
      date: row.review_date,
      count: Number(row.count),
    }));
  }

  async _createFirstReview(submission) {
    const { userId, problemId, rating, timeSpentMs } = submission;
    const probResult = await this.db.query(
      `SELECT difficulty FROM problems WHERE id = ?`,
      [problemId]
    );
    const difficulty = probResult.rows[0]?.difficulty || "Med";
    const result = computeNextReviewFromDB(2.5, 1, 0, 0, rating, difficulty);
    const today = formatDateUTC(todayUTC());

    await this.db.query(
      `INSERT INTO review_schedule
        (user_id, problem_id, ease_factor, interval_days, repetition_count,
         next_review_date, last_review_date, last_rating, streak_correct, total_reviews)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(user_id, problem_id) DO UPDATE SET
        ease_factor = excluded.ease_factor,
        interval_days = excluded.interval_days,
        repetition_count = excluded.repetition_count,
        next_review_date = excluded.next_review_date,
        last_review_date = excluded.last_review_date,
        last_rating = excluded.last_rating,
        streak_correct = excluded.streak_correct,
        total_reviews = review_schedule.total_reviews + 1`,
      [
        userId,
        problemId,
        result.easeFactor,
        result.intervalDays,
        result.repetitionCount,
        formatDateUTC(result.nextReviewDate),
        today,
        rating,
        result.streakCorrect,
      ]
    );

    await this.db.query(
      `INSERT INTO review_history
        (user_id, problem_id, rating, ease_before, interval_before,
         ease_after, interval_after, time_spent_ms)
      VALUES (?, ?, ?, 2.5, 1, ?, ?, ?)`,
      [
        userId,
        problemId,
        rating,
        result.easeFactor,
        result.intervalDays,
        timeSpentMs || null,
      ]
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

module.exports = { SchedulerService, DEFAULT_USER_ID };
