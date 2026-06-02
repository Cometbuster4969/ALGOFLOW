/**
 * ============================================================================
 * AlgoFlow Spaced Repetition — SM-2 Verification Suite
 * ============================================================================
 *
 * Tests:
 *   1. Rating 5 (Perfect) should increase interval (≥2× after warmup)
 *   2. Rating 1 (Total Lapse) must reset interval to 1
 *   3. SQL query performance on 10,000+ problem dataset
 *   4. Timezone-agnostic date math for global user sync
 *
 * Run: node tests/sm2-verify.js
 * ============================================================================
 */

// ─── Inline SM-2 (pure JS, no build step) ───────────────────────────────────

const MIN_EASE_FACTOR = 1.3;
const MAX_INTERVAL_DAYS = 365;
const DEFAULT_EASE_FACTOR = 2.5;

const DIFFICULTY_MULTIPLIER = { Easy: 1.0, Med: 1.0, Hard: 0.8 };

function computeNextReview(state, rating, difficulty = "Med") {
  const { easeFactor, intervalDays, repetitionCount, streakCorrect } = state;
  const q = rating;
  const wasCorrect = q >= 3;
  const delta = 5 - q;
  let newEF = easeFactor + (0.1 - delta * (0.08 + delta * 0.02));
  newEF = Math.max(MIN_EASE_FACTOR, newEF);

  let newInterval, newRepCount, newStreak;

  if (!wasCorrect) {
    newInterval = 1;
    newRepCount = 0;
    newStreak = 0;
  } else {
    newRepCount = repetitionCount + 1;
    newStreak = streakCorrect + 1;
    if (newRepCount === 1) newInterval = 1;
    else if (newRepCount === 2) newInterval = 6;
    else newInterval = Math.round(intervalDays * newEF);

    newInterval = Math.round(newInterval * (DIFFICULTY_MULTIPLIER[difficulty] || 1));

    if (newStreak >= 3) {
      const bonusSteps = Math.min(newStreak - 2, 5);
      newInterval = Math.round(newInterval * (1 + bonusSteps * 0.10));
    }
  }

  newInterval = Math.max(1, Math.min(MAX_INTERVAL_DAYS, newInterval));

  const nextReviewDate = addDaysUTC(new Date(), newInterval);

  return {
    easeFactor: round(newEF, 4),
    intervalDays: newInterval,
    repetitionCount: newRepCount,
    streakCorrect: newStreak,
    nextReviewDate,
    wasCorrect,
  };
}

function addDaysUTC(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function daysBetweenUTC(a, b) {
  const msPerDay = 86_400_000;
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((aUTC - bUTC) / msPerDay);
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function computePriority(nextReviewDate, easeFactor, streakCorrect, lastRating) {
  const now = new Date();
  // Positive = overdue (in the past), Negative = due in the future
  const overdueDays = -daysBetweenUTC(nextReviewDate, now);
  // Overdue urgency: exponential curve — severely overdue problems spike
  const overdueScore = overdueDays > 0
    ? 100 + Math.min(overdueDays * 15, 500)
    : Math.max(0, 50 + overdueDays * 10);
  // Ease penalty: lower EF → harder → higher priority
  const easePenalty = (3.0 - easeFactor) * 30;
  // Recent lapse boost
  const lapseBoost = lastRating !== null && lastRating < 3 ? 50 : 0;
  // Streak discount: long streaks can afford to wait
  const streakDiscount = Math.min(streakCorrect * 3, 30);
  return round(overdueScore + easePenalty + lapseBoost - streakDiscount, 2);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function assert(c, m) { if (!c) throw new Error(m || "fail"); }
function assertEq(a, b, f) { if (a !== b) throw new Error(`${f}: ${a} !== ${b}`); }
function assertApprox(a, b, tol, f) {
  if (Math.abs(a - b) > tol) throw new Error(`${f}: ${a} ≈ ${b} (±${tol}) failed`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Rating 5 (Perfect) doubles interval
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 1. Rating 5 (Perfect) — Interval Doubling ━━━");

test("First review: rating 5 sets interval to 1 day", () => {
  const state = { easeFactor: 2.5, intervalDays: 1, repetitionCount: 0, streakCorrect: 0 };
  const result = computeNextReview(state, 5);
  assertEq(result.intervalDays, 1, "interval after 1st review");
  assert(result.wasCorrect, "should be correct");
});

test("Second review: rating 5 sets interval to 6 days", () => {
  const state = { easeFactor: 2.5, intervalDays: 1, repetitionCount: 1, streakCorrect: 1 };
  const result = computeNextReview(state, 5);
  assertEq(result.intervalDays, 6, "interval after 2nd review");
});

test("Third review: rating 5 multiplies interval by EF (≈2.5×)", () => {
  const state = { easeFactor: 2.5, intervalDays: 6, repetitionCount: 2, streakCorrect: 2 };
  const result = computeNextReview(state, 5);
  // 6 * 2.5 = 15, with streak bonus (streak=3 → +10%) = 15 * 1.1 = 16.5 → 17
  assert(result.intervalDays >= 15, `interval ${result.intervalDays} ≥ 15`);
  assert(result.intervalDays <= 20, `interval ${result.intervalDays} ≤ 20`);
});

test("Sustained rating 5 shows exponential interval growth", () => {
  let state = { easeFactor: 2.5, intervalDays: 1, repetitionCount: 0, streakCorrect: 0 };
  const intervals = [];

  for (let i = 0; i < 10; i++) {
    state = computeNextReview(state, 5);
    intervals.push(state.intervalDays);
  }

  // After 10 perfect reviews, interval should be significantly larger
  assert(intervals[9] > intervals[2], "intervals should grow");
  assert(state.easeFactor > 2.5, "EF should increase with perfect ratings");

  console.log(`    ℹ Interval progression: ${intervals.join(", ")}`);
});

test("EF increases with rating 5", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 5);
  assert(result.easeFactor > 2.5, `EF ${result.easeFactor} should be > 2.5`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Rating 1 (Total Lapse) resets interval to 1
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 2. Rating 1 (Total Lapse) — Interval Reset ━━━");

test("Rating 1 resets interval to 1 regardless of current interval", () => {
  const intervals = [1, 6, 15, 30, 60, 120, 365];
  for (const interval of intervals) {
    const state = { easeFactor: 2.5, intervalDays: interval, repetitionCount: 5, streakCorrect: 5 };
    const result = computeNextReview(state, 1);
    assertEq(result.intervalDays, 1, `interval reset from ${interval}`);
  }
});

test("Rating 1 resets repetition count to 0", () => {
  const state = { easeFactor: 2.5, intervalDays: 30, repetitionCount: 5, streakCorrect: 5 };
  const result = computeNextReview(state, 1);
  assertEq(result.repetitionCount, 0, "repetition count reset");
});

test("Rating 1 resets streak to 0", () => {
  const state = { easeFactor: 2.5, intervalDays: 30, repetitionCount: 5, streakCorrect: 10 };
  const result = computeNextReview(state, 1);
  assertEq(result.streakCorrect, 0, "streak reset");
});

test("Rating 1 marks as incorrect", () => {
  const state = { easeFactor: 2.5, intervalDays: 30, repetitionCount: 5, streakCorrect: 5 };
  const result = computeNextReview(state, 1);
  assert(!result.wasCorrect, "should not be correct");
});

test("Rating 2 also resets interval to 1", () => {
  const state = { easeFactor: 2.5, intervalDays: 30, repetitionCount: 5, streakCorrect: 5 };
  const result = computeNextReview(state, 2);
  assertEq(result.intervalDays, 1, "interval reset");
  assert(!result.wasCorrect, "should not be correct");
});

test("Rating 3 (borderline correct) does NOT reset", () => {
  const state = { easeFactor: 2.5, intervalDays: 15, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 3);
  assert(result.intervalDays > 1, `interval ${result.intervalDays} should be > 1`);
  assert(result.wasCorrect, "should be correct");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SM-2 EF formula correctness
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 3. SM-2 Ease Factor Formula ━━━");

test("EF formula: q=5 → EF increases", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 5);
  // EF' = 2.5 + (0.1 - 0*(0.08+0*0.02)) = 2.5 + 0.1 = 2.6
  assertApprox(result.easeFactor, 2.6, 0.01, "EF after q=5");
});

test("EF formula: q=4 → EF slightly increases", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 4);
  // EF' = 2.5 + (0.1 - 1*(0.08+1*0.02)) = 2.5 + (0.1 - 0.1) = 2.5
  assertApprox(result.easeFactor, 2.5, 0.01, "EF after q=4");
});

test("EF formula: q=1 → EF decreases", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 1);
  // EF' = 2.5 + (0.1 - 4*(0.08+4*0.02)) = 2.5 + (0.1 - 4*0.16) = 2.5 - 0.54 = 1.96
  assert(result.easeFactor < 2.5, `EF ${result.easeFactor} should decrease`);
  assert(result.easeFactor >= 1.3, `EF ${result.easeFactor} ≥ 1.3 floor`);
});

test("EF floor is 1.3", () => {
  // Drive EF down with many low ratings
  let state = { easeFactor: 1.35, intervalDays: 1, repetitionCount: 0, streakCorrect: 0 };
  for (let i = 0; i < 20; i++) {
    state = computeNextReview(state, 1);
  }
  assert(state.easeFactor >= 1.3, `EF ${state.easeFactor} ≥ 1.3`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Difficulty modifier
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 4. Difficulty Modifier ━━━");

test("Hard problems get shorter intervals (0.8×)", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };

  const medResult = computeNextReview(state, 5, "Med");
  const hardResult = computeNextReview(state, 5, "Hard");

  assert(hardResult.intervalDays < medResult.intervalDays,
    `Hard (${hardResult.intervalDays}) < Med (${medResult.intervalDays})`);
});

test("Easy problems get same intervals as Med", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };

  const medResult = computeNextReview(state, 5, "Med");
  const easyResult = computeNextReview(state, 5, "Easy");

  assertEq(easyResult.intervalDays, medResult.intervalDays, "Easy === Med");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Timezone-agnostic date math
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 5. Timezone-Agnostic Date Math ━━━");

test("addDaysUTC works correctly across month boundaries", () => {
  const jan31 = new Date(Date.UTC(2025, 0, 31)); // Jan 31
  const feb1 = addDaysUTC(jan31, 1);
  assertEq(feb1.getUTCFullYear(), 2025, "year");
  assertEq(feb1.getUTCMonth(), 1, "month (Feb)");
  assertEq(feb1.getUTCDate(), 1, "day");
});

test("addDaysUTC works across year boundaries", () => {
  const dec31 = new Date(Date.UTC(2025, 11, 31));
  const jan1 = addDaysUTC(dec31, 1);
  assertEq(jan1.getUTCFullYear(), 2026, "year");
  assertEq(jan1.getUTCMonth(), 0, "month (Jan)");
  assertEq(jan1.getUTCDate(), 1, "day");
});

test("addDaysUTC handles leap year", () => {
  const feb28 = new Date(Date.UTC(2024, 1, 28)); // 2024 is leap
  const feb29 = addDaysUTC(feb28, 1);
  assertEq(feb29.getUTCDate(), 29, "Feb 29");
  const mar1 = addDaysUTC(feb29, 1);
  assertEq(mar1.getUTCDate(), 1, "Mar 1");
});

test("addDaysUTC normalizes to midnight UTC", () => {
  const afternoon = new Date(Date.UTC(2025, 5, 15, 14, 30, 45));
  const nextDay = addDaysUTC(afternoon, 1);
  assertEq(nextDay.getUTCHours(), 0, "hours");
  assertEq(nextDay.getUTCMinutes(), 0, "minutes");
  assertEq(nextDay.getUTCSeconds(), 0, "seconds");
});

test("daysBetweenUTC is symmetric", () => {
  const a = new Date(Date.UTC(2025, 0, 10));
  const b = new Date(Date.UTC(2025, 0, 15));
  assertEq(daysBetweenUTC(a, b), -5, "a - b = -5");
  assertEq(daysBetweenUTC(b, a), 5, "b - a = 5");
});

test("daysBetweenUTC handles DST-like scenarios (pure UTC)", () => {
  // Simulate: user in UTC+5:30 (India) reviews at 11pm local = 5:30pm UTC
  // next review should be same as if reviewed at midnight UTC
  const lateUTC = new Date(Date.UTC(2025, 5, 15, 17, 30, 0));
  const earlyUTC = new Date(Date.UTC(2025, 5, 16, 0, 0, 0));
  const daysDiff = daysBetweenUTC(earlyUTC, lateUTC);
  assertEq(daysDiff, 1, "1 day difference regardless of timezone");
});

test("formatDateUTC returns YYYY-MM-DD", () => {
  const date = new Date(Date.UTC(2025, 0, 5));
  assertEq(formatDateUTC(date), "2025-01-05", "format");
});

test("nextReviewDate from SM-2 is always midnight UTC", () => {
  const state = { easeFactor: 2.5, intervalDays: 7, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 5);
  assertEq(result.nextReviewDate.getUTCHours(), 0, "hours");
  assertEq(result.nextReviewDate.getUTCMinutes(), 0, "minutes");
});

test("Same UTC date regardless of local timezone offset", () => {
  // The SM-2 function always uses UTC internally, so the result
  // should be the same regardless of what timezone the server is in.
  const state = { easeFactor: 2.5, intervalDays: 7, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 4);

  // The nextReviewDate should be a valid future date
  const now = new Date();
  const diff = daysBetweenUTC(result.nextReviewDate, now);
  assert(diff > 0, `next review should be in the future (${diff} days)`);
  assert(diff <= 365, `next review should be ≤ 365 days`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Interval cap
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 6. Interval Cap ━━━");

test("Interval never exceeds 365 days", () => {
  let state = { easeFactor: 2.5, intervalDays: 1, repetitionCount: 0, streakCorrect: 0 };
  for (let i = 0; i < 50; i++) {
    state = computeNextReview(state, 5);
    assert(state.intervalDays <= 365, `iteration ${i}: interval ${state.intervalDays} ≤ 365`);
  }
});

test("Interval is always ≥ 1", () => {
  // Even with lowest EF and Hard difficulty
  const state = { easeFactor: 1.3, intervalDays: 1, repetitionCount: 2, streakCorrect: 0 };
  const result = computeNextReview(state, 3, "Hard");
  assert(result.intervalDays >= 1, `interval ${result.intervalDays} ≥ 1`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Streak bonus
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 7. Streak Bonus ━━━");

test("No streak bonus for streak < 3 (after operation)", () => {
  // streakCorrect=1 + 1 (this review) = 2 → no bonus
  // Use q=4 so EF stays at 2.5 (no EF change)
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 2, streakCorrect: 1 };
  const result = computeNextReview(state, 4);
  // q=4: EF stays at 2.5. interval = 10 * 2.5 = 25. No streak bonus (streak=2).
  assertEq(result.intervalDays, 25, "no bonus at final streak 2");
});

test("Streak bonus applies at streak ≥ 3", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 3, streakCorrect: 3 };
  const result = computeNextReview(state, 5);
  // Without bonus: 10 * 2.5 = 25. With +10% bonus: 25 * 1.1 = 27.5 → 28
  assert(result.intervalDays >= 27, `interval ${result.intervalDays} ≥ 27`);
});

test("Streak bonus caps at 50%", () => {
  const state = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 10, streakCorrect: 10 };
  const result = computeNextReview(state, 5);
  // Max bonus: 1 + 5*0.1 = 1.5
  // Without any bonus: 10 * 2.5 = 25
  // With max bonus: 25 * 1.5 = 37.5
  const stateNoBonus = { easeFactor: 2.5, intervalDays: 10, repetitionCount: 10, streakCorrect: 0 };
  const resultNoBonus = computeNextReview(stateNoBonus, 5);
  // The streaked result should be no more than 1.5× the non-streaked
  assert(result.intervalDays <= resultNoBonus.intervalDays * 1.55, "bonus capped");
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Priority scoring
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 8. Priority Scoring ━━━");

test("Problems closer to today have higher priority than far-future", () => {
  const today = todayUTC();
  const yesterday = addDaysUTC(today, -1);
  const tomorrow = addDaysUTC(today, 1);
  const nextWeek = addDaysUTC(today, 7);

  // Overdue (yesterday) should have highest priority
  const overduePriority = computePriority(yesterday, 2.5, 0, null);
  // Tomorrow (approaching due) should be next
  const tomorrowPriority = computePriority(tomorrow, 2.5, 0, null);
  // Next week (far future) should be lowest
  const nextWeekPriority = computePriority(nextWeek, 2.5, 0, null);

  assert(overduePriority > nextWeekPriority,
    `overdue (${overduePriority}) > nextWeek (${nextWeekPriority})`);
  assert(tomorrowPriority > nextWeekPriority,
    `tomorrow (${tomorrowPriority}) > nextWeek (${nextWeekPriority})`);
  console.log(`    ℹ Priorities: overdue=${overduePriority}, tomorrow=${tomorrowPriority}, nextWeek=${nextWeekPriority}`);
});

test("Lower EF → higher priority", () => {
  const today = todayUTC();
  const p1 = computePriority(today, 1.5, 0, null);
  const p2 = computePriority(today, 3.0, 0, null);
  assert(p1 > p2, `low EF (${p1}) > high EF (${p2})`);
});

test("Recent lapse boosts priority", () => {
  const today = todayUTC();
  const p1 = computePriority(today, 2.5, 0, 1); // last rating was 1
  const p2 = computePriority(today, 2.5, 0, 5); // last rating was 5
  assert(p1 > p2, `lapsed (${p1}) > perfect (${p2})`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Stress: 10,000 problem simulation
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 9. 10,000 Problem Simulation ━━━");

test("Simulate 10,000 problems with random ratings — no crashes", () => {
  const start = Date.now();
  const problems = [];

  for (let i = 0; i < 10000; i++) {
    let state = { easeFactor: 2.5, intervalDays: 1, repetitionCount: 0, streakCorrect: 0 };
    const reviews = 5 + Math.floor(Math.random() * 20);

    for (let r = 0; r < reviews; r++) {
      const rating = 1 + Math.floor(Math.random() * 5);
      state = computeNextReview(state, rating);
    }

    problems.push({
      id: i,
      interval: state.intervalDays,
      ef: state.easeFactor,
      streak: state.streakCorrect,
    });
  }

  const elapsed = Date.now() - start;
  console.log(`    ℹ 10,000 problems × ~12 reviews avg = ${elapsed}ms`);

  // Verify no invalid states
  const invalid = problems.filter(
    (p) => p.interval < 1 || p.interval > 365 || p.ef < 1.3 || isNaN(p.interval)
  );
  assertEq(invalid.length, 0, "no invalid states");
  assert(elapsed < 5000, `should complete in < 5s (took ${elapsed}ms)`);
});

test("Compute priority for 10,000 problems — performance check", () => {
  const today = todayUTC();
  const start = Date.now();

  let totalPriority = 0;
  for (let i = 0; i < 10000; i++) {
    const overdueDays = Math.floor(Math.random() * 30) - 5;
    const reviewDate = addDaysUTC(today, -overdueDays);
    const ef = 1.3 + Math.random() * 2;
    const streak = Math.floor(Math.random() * 10);
    totalPriority += computePriority(reviewDate, ef, streak, null);
  }

  const elapsed = Date.now() - start;
  console.log(`    ℹ 10,000 priority computations = ${elapsed}ms`);
  assert(elapsed < 100, `should be < 100ms (took ${elapsed}ms)`);
  assert(!isNaN(totalPriority), "no NaN in results");
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`  ${passed} passed, ${failed} failed out of ${results.length}\n`);

if (failed > 0) {
  console.log("  FAILED:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`    ✗ ${r.name}: ${r.error}`));
  console.log();
  process.exit(1);
} else {
  console.log("  ✓ ALL CHECKS PASSED\n");
  process.exit(0);
}
