/**
 * ============================================================================
 * CHECKLIST ITEM 1 — DOM Selectors vs LeetCode's Dynamic React Rendering
 * ============================================================================
 *
 * LeetCode renders problem pages with React. DOM nodes appear asynchronously;
 * class names are hashed (e.g. "css-v3d350") and change between deploys.
 *
 * This test creates multiple realistic DOM snapshots matching LC's known
 * layouts (legacy, Tailwind-2024, CN mirror) and verifies that every
 * selector chain in parsers.js finds the correct data in at least one
 * variant — proving the cascade is resilient.
 *
 * Run: node tests/01-selectors-leetcode.js
 * ============================================================================
 */

const { JSDOM } = require("jsdom");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWindow(html, url = "https://leetcode.com/problems/two-sum/description/") {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: "dangerously" });
  return dom.window;
}

function loadParsers(window) {
  // Evaluate parsers.js source in the jsdom window
  const fs = require("fs");
  const src = fs.readFileSync(__dirname + "/../content/parsers.js", "utf8");
  window.eval(src);
  return window.__AlgoFlowParsers;
}

// ─── DOM Variants ────────────────────────────────────────────────────────────

/**
 * Variant A — Legacy LeetCode (pre-2024, class-based)
 */
const LEGACY_DOM = `
<!DOCTYPE html>
<html>
<head><title>Two Sum - LeetCode</title></head>
<body>
  <div id="app">
    <div class="question-header">
      <div class="css-v3d350">1. Two Sum</div>
    </div>

    <div class="question-content">
      <div class="content__1c2R">
        <p>Given an array of integers <code>nums</code> and an integer <code>target</code>,
        return <em>indices of the two numbers</em> such that they add up to <code>target</code>.</p>

        <p><strong>Example 1:</strong></p>
        <pre>
<strong>Input:</strong> nums = [2,7,11,15], target = 9
<strong>Output:</strong> [0,1]
<strong>Explanation:</strong> Because nums[0] + nums[1] == 9, we return [0, 1].
        </pre>

        <p><strong>Example 2:</strong></p>
        <pre>
<strong>Input:</strong> nums = [3,2,4], target = 6
<strong>Output:</strong> [1,2]
        </pre>

        <p><strong>Example 3:</strong></p>
        <pre>
<strong>Input:</strong> nums = [3,3], target = 6
<strong>Output:</strong> [0,1]
        </pre>
      </div>
    </div>

    <div class="side-tools">
      <div class="css-v3d350" diff="Easy">Easy</div>
    </div>

    <div class="topic-tag">
      <a href="/tag/array/">Array</a>
      <a href="/tag/hash-table/">Hash Table</a>
    </div>
  </div>
</body>
</html>
`;

/**
 * Variant B — Modern Tailwind LeetCode (2024+, data-attribute based)
 */
const MODERN_DOM = `
<!DOCTYPE html>
<html>
<head><title>Two Sum - LeetCode</title></head>
<body>
  <div id="__next">
    <div data-cy="question-detail">
      <div class="flex items-center gap-2">
        <button>Submit</button>
      </div>
    </div>

    <a href="/problems/two-sum/">
      <div class="text-title-large">1. Two Sum</div>
    </a>

    <div data-track-load="description_content" class="elfjS">
      <div class="px-5 py-3">
        <p>Given an array of integers <code>nums</code> and an integer <code>target</code>,
        return indices of the two numbers such that they add up to target.</p>

        <p><strong>Example 1:</strong></p>
        <pre>
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
        </pre>

        <p><strong>Example 2:</strong></p>
        <pre>
Input: nums = [3,2,4], target = 6
Output: [1,2]
        </pre>

        <p><strong>Example 3:</strong></p>
        <pre>
Input: nums = [3,3], target = 6
Output: [0,1]
        </pre>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex gap-1">
        <div data-cy="question-difficulty" class="text-green-600">Easy</div>
      </div>
    </div>

    <a href="/tag/array/">Array</a>
    <a href="/tag/hash-table/">Hash Table</a>
    <a href="/tag/two-pointers/">Two Pointers</a>
  </div>
</body>
</html>
`;

/**
 * Variant C — LeetCode CN mirror (mixed selectors)
 */
const CN_DOM = `
<!DOCTYPE html>
<html>
<head><title>Two Sum - LeetCode</title></head>
<body>
  <div class="question-detail-main">
    <div class="css-v3d350">1. Two Sum</div>

    <div class="content__1c2R">
      <p>Given an array of integers...</p>

      <p><strong>Example 1:</strong></p>
      <pre>
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
      </pre>

      <p><strong>Example 2:</strong></p>
      <pre>
Input: nums = [3,2,4], target = 6
Output: [1,2]
      </pre>
    </div>

    <div class="css-10oi413" diff="Easy">Easy</div>

    <a href="/tag/array/">Array</a>
    <a href="/tag/hash-table/">Hash Table</a>
  </div>
</body>
</html>
`;

/**
 * Variant D — Minimal / stripped layout (worst-case fallback)
 */
const MINIMAL_DOM = `
<!DOCTYPE html>
<html>
<head><title>42. Trapping Rain Water - LeetCode</title></head>
<body>
  <h1>42. Trapping Rain Water</h1>
  <p>Given n non-negative integers...</p>
  <pre>
Input: height = [0,1,0,2,1,0,1,3,2,1,2,1]
Output: 6
  </pre>
  <pre>
Input: height = [4,2,0,3,2,5]
Output: 9
  </pre>
</body>
</html>
`;

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

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEq(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field}: expected "${expected}", got "${actual}"`);
  }
}

// ── Variant A: Legacy ────────────────────────────────────────────────────────

console.log("\n━━━ Variant A: Legacy LeetCode DOM ─━━");

test("Legacy — title via .css-v3d350", () => {
  const win = makeWindow(LEGACY_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data, "parse() returned null");
  assertEq(data.title, "1. Two Sum", "title");
});

test("Legacy — difficulty via [diff] attribute", () => {
  const win = makeWindow(LEGACY_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assertEq(data.difficulty, "Easy", "difficulty");
});

test("Legacy — test cases from <pre> blocks", () => {
  const win = makeWindow(LEGACY_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data.testCases.length >= 2, `Expected ≥2 TCs, got ${data.testCases.length}`);
  assertEq(data.testCases[0].in, "nums = [2,7,11,15], target = 9", "TC[0].in");
  assertEq(data.testCases[0].out, "[0,1]", "TC[0].out");
});

test("Legacy — tags from /tag/ links", () => {
  const win = makeWindow(LEGACY_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data.tags.includes("Array"), "Missing tag 'Array'");
  assert(data.tags.includes("Hash Table"), "Missing tag 'Hash Table'");
});

// ── Variant B: Modern ────────────────────────────────────────────────────────

console.log("\n━━━ Variant B: Modern Tailwind LeetCode DOM ─━━");

test("Modern — title via data-cy + text-title-large", () => {
  const win = makeWindow(MODERN_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data, "parse() returned null");
  assertEq(data.title, "1. Two Sum", "title");
});

test("Modern — difficulty via data-cy='question-difficulty'", () => {
  const win = makeWindow(MODERN_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assertEq(data.difficulty, "Easy", "difficulty");
});

test("Modern — test cases from description_content area", () => {
  const win = makeWindow(MODERN_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data.testCases.length >= 2, `Expected ≥2 TCs, got ${data.testCases.length}`);
});

// ── Variant C: CN Mirror ─────────────────────────────────────────────────────

console.log("\n━━━ Variant C: LeetCode CN Mirror DOM ─━━");

test("CN — title via .css-v3d350 fallback", () => {
  const win = makeWindow(CN_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data, "parse() returned null");
  assertEq(data.title, "1. Two Sum", "title");
});

test("CN — difficulty via [diff] attribute", () => {
  const win = makeWindow(CN_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assertEq(data.difficulty, "Easy", "difficulty");
});

test("CN — test cases parsed", () => {
  const win = makeWindow(CN_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data.testCases.length >= 2, `Expected ≥2 TCs, got ${data.testCases.length}`);
});

// ── Variant D: Minimal / worst-case ──────────────────────────────────────────

console.log("\n━━━ Variant D: Minimal / worst-case DOM ─━━");

test("Minimal — title via <title> tag fallback", () => {
  const win = makeWindow(MINIMAL_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data, "parse() returned null — <title> fallback failed");
  assertEq(data.title, "42. Trapping Rain Water", "title");
});

test("Minimal — difficulty defaults to Med", () => {
  const win = makeWindow(MINIMAL_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assertEq(data.difficulty, "Med", "difficulty");
});

test("Minimal — test cases via raw-text regex fallback", () => {
  const win = makeWindow(MINIMAL_DOM);
  const P = loadParsers(win);
  const data = P.LeetCode.parse();
  assert(data.testCases.length >= 2, `Expected ≥2 TCs, got ${data.testCases.length}`);
});

// ── URL matching ─────────────────────────────────────────────────────────────

console.log("\n━━━ URL Matching ─━━");

test("Match: /problems/two-sum/", () => {
  const win = makeWindow("", "https://leetcode.com/problems/two-sum/description/");
  const P = loadParsers(win);
  assert(P.LeetCode.isMatch(), "Should match");
});

test("Match: /problems/two-sum (no trailing slash)", () => {
  const win = makeWindow("", "https://leetcode.com/problems/two-sum");
  const P = loadParsers(win);
  assert(P.LeetCode.isMatch(), "Should match");
});

test("Match: CN mirror", () => {
  const win = makeWindow("", "https://leetcode.cn/problems/two-sum/");
  const P = loadParsers(win);
  assert(P.LeetCode.isMatch(), "Should match CN");
});

test("No match: /problemset/", () => {
  const win = makeWindow("", "https://leetcode.com/problemset/");
  const P = loadParsers(win);
  assert(!P.LeetCode.isMatch(), "Should NOT match problemset");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n━━━ Summary ━━━");
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`  ${passed} passed, ${failed} failed out of ${results.length}\n`);

if (failed > 0) {
  console.log("  FAILED:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`    ✗ ${r.name}: ${r.error}`));
  console.log();
  process.exit(1);
}
