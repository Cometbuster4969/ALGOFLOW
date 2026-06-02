/**
 * AlgoFlow SM-2 (modified) — pure functions, ported from algoflow-srs/services/sm2.ts
 */

const MIN_EASE_FACTOR = 1.3;
const MAX_INTERVAL_DAYS = 365;
const DEFAULT_EASE_FACTOR = 2.5;

const DIFFICULTY_MULTIPLIER = {
  Easy: 1.0,
  Med: 1.0,
  Hard: 0.8,
};

const STREAK_BONUS_PER_STEP = 0.10;
const STREAK_BONUS_MAX = 0.50;

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function addDaysUTC(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function daysBetweenUTC(a, b) {
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((aUTC - bUTC) / 86_400_000);
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function computeNextReview(state, rating, problemDifficulty = "Med") {
  const { easeFactor, intervalDays, repetitionCount, streakCorrect } = state;
  const q = rating;
  const wasCorrect = q >= 3;

  const delta = 5 - q;
  let newEF = easeFactor + (0.1 - delta * (0.08 + delta * 0.02));
  newEF = Math.max(MIN_EASE_FACTOR, newEF);

  let newInterval;
  let newRepetitionCount;
  let newStreak;

  if (!wasCorrect) {
    newInterval = 1;
    newRepetitionCount = 0;
    newStreak = 0;
  } else {
    newRepetitionCount = repetitionCount + 1;
    newStreak = streakCorrect + 1;

    if (newRepetitionCount === 1) {
      newInterval = 1;
    } else if (newRepetitionCount === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(intervalDays * newEF);
    }

    const diffMultiplier = DIFFICULTY_MULTIPLIER[problemDifficulty] || 1;
    newInterval = Math.round(newInterval * diffMultiplier);

    if (newStreak >= 3) {
      const bonusSteps = Math.min(
        newStreak - 2,
        STREAK_BONUS_MAX / STREAK_BONUS_PER_STEP
      );
      const streakMultiplier = 1 + bonusSteps * STREAK_BONUS_PER_STEP;
      newInterval = Math.round(newInterval * streakMultiplier);
    }
  }

  newInterval = Math.max(1, Math.min(MAX_INTERVAL_DAYS, newInterval));
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

function computeNextReviewFromDB(
  easeFactor,
  intervalDays,
  repetitionCount,
  streakCorrect,
  rating,
  difficulty = "Med"
) {
  return computeNextReview(
    { easeFactor, intervalDays, repetitionCount, streakCorrect },
    rating,
    difficulty
  );
}

function computePriority(nextReviewDate, easeFactor, streakCorrect, lastRating) {
  const now = new Date();
  const overdueDays = -daysBetweenUTC(nextReviewDate, now);

  const overdueScore =
    overdueDays > 0
      ? 100 + Math.min(overdueDays * 15, 500)
      : Math.max(0, 50 + overdueDays * 10);

  const easePenalty = (3.0 - easeFactor) * 30;
  const lapseBoost = lastRating !== null && lastRating < 3 ? 50 : 0;
  const streakDiscount = Math.min(streakCorrect * 3, 30);

  return round(overdueScore + easePenalty + lapseBoost - streakDiscount, 2);
}

module.exports = {
  computeNextReview,
  computeNextReviewFromDB,
  computePriority,
  addDaysUTC,
  daysBetweenUTC,
  todayUTC,
  formatDateUTC,
  DEFAULT_EASE_FACTOR,
};
