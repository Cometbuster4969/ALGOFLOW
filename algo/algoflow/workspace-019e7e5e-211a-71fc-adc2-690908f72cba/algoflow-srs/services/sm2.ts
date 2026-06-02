/**
 * ============================================================================
 * AlgoFlow Spaced Repetition — SM-2 Algorithm (Modified)
 * ============================================================================
 *
 * Pure function implementation of SuperMemo-2 with AlgoFlow modifications:
 *
 *   • Rating scale: 1–5 (not SM-2's 0–5)
 *     1 = Total Lapse   — complete blackout, no recall
 *     2 = Near Lapse    — wrong answer, but recognized the problem
 *     3 = Significant   — wrong answer after serious effort
 *     4 = Minor Hesitate— correct with noticeable hesitation
 *     5 = Perfect       — instant, confident recall
 *
 *   • Passing threshold: q ≥ 3 (ratings 3,4,5 are "correct")
 *
 * Standard SM-2 formulas:
 *   EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
 *   If q < 3:  I = 1  (reset to 1 day)
 *   If n = 1:  I = 1
 *   If n = 2:  I = 6
 *   Else:      I = I * EF
 *
 * AlgoFlow modifications:
 *   • EF floor raised to 1.3 (from SM-2's 1.3 — same)
 *   • Interval cap at 365 days (prevents infinite growth)
 *   • Streak bonus: consecutive perfect ratings get 10% interval bonus
 *   • Difficulty modifier: Hard problems get 0.8× interval multiplier
 *
 * All functions are PURE — no side effects, no database calls.
 * ============================================================================
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface SM2State {
  /** Ease Factor (≥ 1.3). Higher = easier for the user. */
  easeFactor: number;
  /** Current interval in days. */
  intervalDays: number;
  /** Repetition count (number of consecutive correct reviews). */
  repetitionCount: number;
  /** Consecutive correct streak (q ≥ 3). */
  streakCorrect: number;
}

export interface SM2Result {
  /** Updated ease factor. */
  easeFactor: number;
  /** Updated interval in days. */
  intervalDays: number;
  /** Updated repetition count. */
  repetitionCount: number;
  /** Updated streak. */
  streakCorrect: number;
  /** The computed next review date (UTC). */
  nextReviewDate: Date;
  /** Whether the rating was "correct" (q ≥ 3). */
  wasCorrect: boolean;
}

export type Difficulty = "Easy" | "Med" | "Hard";

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_EASE_FACTOR = 1.3;
const MAX_INTERVAL_DAYS = 365;
const DEFAULT_EASE_FACTOR = 2.5;

/** Interval multipliers by problem difficulty. */
const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  Easy: 1.0,
  Med: 1.0,
  Hard: 0.8,   // Hard problems reviewed sooner
};

/** Streak bonus: 10% extra per consecutive correct after 3. */
const STREAK_BONUS_PER_STEP = 0.10;
const STREAK_BONUS_MAX = 0.50; // Cap at 50% bonus

// ─── Core SM-2 function ─────────────────────────────────────────────────────

/**
 * Compute the next SM-2 state given the current state and a user rating.
 *
 * @param state  Current SM-2 state (easeFactor, intervalDays, repetitionCount, streakCorrect)
 * @param rating User quality rating (1–5)
 * @param problemDifficulty Optional difficulty modifier
 * @returns      Updated state + next review date
 */
export function computeNextReview(
  state: SM2State,
  rating: Rating,
  problemDifficulty: Difficulty = "Med"
): SM2Result {
  const { easeFactor, intervalDays, repetitionCount, streakCorrect } = state;
  const q = rating;
  const wasCorrect = q >= 3;

  // ── Step 1: Update Ease Factor ───────────────────────────────────────

  // SM-2 EF formula: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
  const delta = 5 - q;
  let newEF = easeFactor + (0.1 - delta * (0.08 + delta * 0.02));
  newEF = Math.max(MIN_EASE_FACTOR, newEF);

  // ── Step 2: Update Interval ──────────────────────────────────────────

  let newInterval: number;
  let newRepetitionCount: number;
  let newStreak: number;

  if (!wasCorrect) {
    // Failed: reset to 1 day, reset repetition count
    newInterval = 1;
    newRepetitionCount = 0;
    newStreak = 0;
  } else {
    // Correct answer
    newRepetitionCount = repetitionCount + 1;
    newStreak = streakCorrect + 1;

    if (newRepetitionCount === 1) {
      newInterval = 1;
    } else if (newRepetitionCount === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(intervalDays * newEF);
    }

    // Apply difficulty modifier
    const diffMultiplier = DIFFICULTY_MULTIPLIER[problemDifficulty];
    newInterval = Math.round(newInterval * diffMultiplier);

    // Apply streak bonus (after 3+ consecutive correct)
    if (newStreak >= 3) {
      const bonusSteps = Math.min(newStreak - 2, STREAK_BONUS_MAX / STREAK_BONUS_PER_STEP);
      const streakMultiplier = 1 + bonusSteps * STREAK_BONUS_PER_STEP;
      newInterval = Math.round(newInterval * streakMultiplier);
    }
  }

  // Clamp interval
  newInterval = Math.max(1, Math.min(MAX_INTERVAL_DAYS, newInterval));

  // ── Step 3: Compute next review date (UTC) ───────────────────────────

  const nextReviewDate = addDaysUTC(new Date(), newInterval);

  return {
    easeFactor: round(newEF, 4),
    intervalDays: newInterval,
    repetitionCount: newRepetitionCount,
    streakCorrect: newStreak,
    nextReviewDate,
    wasCorrect,
  };
}

// ─── Convenience: create initial state for a new problem ────────────────────

export function createInitialState(): SM2State {
  return {
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 1,
    repetitionCount: 0,
    streakCorrect: 0,
  };
}

// ─── Convenience: compute from raw DB values ────────────────────────────────

export function computeNextReviewFromDB(
  easeFactor: number,
  intervalDays: number,
  repetitionCount: number,
  streakCorrect: number,
  rating: Rating,
  difficulty: Difficulty = "Med"
): SM2Result {
  return computeNextReview(
    { easeFactor, intervalDays, repetitionCount, streakCorrect },
    rating,
    difficulty
  );
}

// ─── Priority scoring (for queue ordering) ──────────────────────────────────

/**
 * Compute a priority score for the review queue.
 * Higher score = more urgent.
 *
 * Factors:
 *   • Days overdue (dominant factor)
 *   • Ease factor (lower EF = harder problem = higher priority)
 *   • Streak broken recently (boost priority)
 */
export function computePriority(
  nextReviewDate: Date,
  easeFactor: number,
  streakCorrect: number,
  lastRating: number | null
): number {
  const now = new Date();
  // Positive = overdue (in the past), Negative = due in the future
  const overdueDays = -daysBetweenUTC(nextReviewDate, now);

  // Overdue urgency (exponential curve — severely overdue problems spike)
  const overdueScore = overdueDays > 0
    ? 100 + Math.min(overdueDays * 15, 500)
    : Math.max(0, 50 + overdueDays * 10);

  // Ease penalty (lower EF → harder → higher priority)
  const easePenalty = (3.0 - easeFactor) * 30;

  // Recent lapse boost (if last rating was 1-2, boost priority)
  const lapseBoost = lastRating !== null && lastRating < 3 ? 50 : 0;

  // Streak discount (long streaks can afford to wait)
  const streakDiscount = Math.min(streakCorrect * 3, 30);

  return round(
    overdueScore + easePenalty + lapseBoost - streakDiscount,
    2
  );
}

// ─── Timezone-agnostic date math ────────────────────────────────────────────

/**
 * Add N days to a date using UTC arithmetic.
 * This avoids DST/timezone issues by working entirely in UTC.
 */
export function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  // Normalize to midnight UTC
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Compute the number of days between two dates (positive = a is after b).
 * Uses UTC to avoid timezone issues.
 */
export function daysBetweenUTC(a: Date, b: Date): number {
  const msPerDay = 86_400_000;
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((aUTC - bUTC) / msPerDay);
}

/**
 * Get today's date as a UTC Date (midnight UTC).
 */
export function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Format a Date as a YYYY-MM-DD string in UTC.
 */
export function formatDateUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
