/**
 * ============================================================================
 * CHECKLIST ITEM 1b — DOM Selectors vs Codeforces DOM Variants
 * ============================================================================
 *
 * Run: node tests/02-selectors-codeforces.js
 * ============================================================================
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");

const PARSERS_SRC = fs.readFileSync(__dirname + "/../content/parsers.js", "utf8");

function makeWindow(html, url = "https://codeforces.com/contest/1800/problem/A") {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: "dangerously" });
  return dom.window;
}

function loadParsers(win) {
  win.eval(PARSERS_SRC);
  return win.__AlgoFlowParsers;
}

// ─── DOM Variants ────────────────────────────────────────────────────────────

/**
 * Variant A — Classic Codeforces layout (pre-2024)
 */
const CF_CLASSIC = `
<!DOCTYPE html>
<html>
<head><title>A. Two Sum - Codeforces</title></head>
<body>
  <div class="problemindexholder">
    <div class="problem-statement">
      <div class="header">
        <div class="title">A. Two Sum</div>
        <div class="time-limit">time limit per test: 2 seconds</div>
        <div class="memory-limit">memory limit per test: 256 megabytes</div>
      </div>

      <div class="input">
        <div class="section-title">Input</div>
        <p>The first line contains two integers...</p>
      </div>

      <div class="output">
        <div class="section-title">Output</div>
        <p>Output two indices...</p>
      </div>

      <div class="sample-test">
        <div class="input">
          <div class="title">Input</div>
          <pre>4 9
2 7 11 15</pre>
        </div>
        <div class="output">
          <div class="title">Output</div>
          <pre>1 2</pre>
        </div>
      </div>

      <div class="sample-test">
        <div class="input">
          <div class="title">Input</div>
          <pre>3 6
3 2 4</pre>
        </div>
        <div class="output">
          <div class="title">Output</div>
          <pre>2 3</pre>
        </div>
      </div>

      <div class="tag-box">
        <a href="/problemset?tags=implementation">implementation</a>,
        <a href="/problemset?tags=math">math</a>
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Variant B — Modern CF with test-example-line divs (2024+)
 */
const CF_MODERN = `
<!DOCTYPE html>
<html>
<head><title>A. Two Sum - Codeforces</title></head>
<body>
  <div class="problem-statement">
    <div class="header">
      <div class="title">A. Two Sum</div>
    </div>

    <div class="sample-test">
      <div class="input">
        <div class="title">Input</div>
        <pre>
<div class="test-example-line">4 9</div>
<div class="test-example-line">2 7 11 15</div>
        </pre>
      </div>
      <div class="output">
        <div class="title">Output</div>
        <pre>
<div class="test-example-line">1 2</div>
        </pre>
      </div>
    </div>

    <div class="sample-test">
      <div class="input">
        <div class="title">Input</div>
        <pre>
<div class="test-example-line">3 6</div>
<div class="test-example-line">3 2 4</div>
        </pre>
      </div>
      <div class="output">
        <div class="title">Output</div>
        <pre>
<div class="test-example-line">2 3</div>
        </pre>
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Variant C — CF Gym (different URL pattern, same DOM)
 */
const CF_GYM = `
<!DOCTYPE html>
<html>
<head><title>B. Matrix Rotation - Codeforces</title></head>
<body>
  <div class="problem-statement">
    <div class="header">
      <div class="title">B. Matrix Rotation</div>
    </div>
    <div class="sample-test">
      <div class="input">
        <div class="title">Input</div>
        <pre>2
1 2
3 4</pre>
      </div>
      <div class="output">
        <div class="title">Output</div>
        <pre>3 1
4 2</pre>
      </div>
    </div>
  </div>
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

function assert(c, m) { if (!c) throw new Error(m || "fail"); }
function assertEq(a, b, f) { if (a !== b) throw new Error(`${f}: "${a}" !== "${b}"`); }

// ── Classic layout ───────────────────────────────────────────────────────────

console.log("\n━━━ Variant A: Classic CF DOM ━━━");

test("Classic — title stripped of 'A.' prefix", () => {
  const win = makeWindow(CF_CLASSIC);
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assert(data, "parse() returned null");
  assertEq(data.title, "Two Sum", "title");
});

test("Classic — difficulty from problem index A → Easy", () => {
  const win = makeWindow(CF_CLASSIC);
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assertEq(data.difficulty, "Easy", "difficulty");
});

test("Classic — test cases from .sample-test blocks", () => {
  const win = makeWindow(CF_CLASSIC);
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assert(data.testCases.length === 2, `Expected 2 TCs, got ${data.testCases.length}`);
  assertEq(data.testCases[0].in, "4 9 2 7 11 15", "TC[0].in (collapsed whitespace)");
  assertEq(data.testCases[0].out, "1 2", "TC[0].out");
});

test("Classic — tags from .tag-box", () => {
  const win = makeWindow(CF_CLASSIC);
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assert(data.tags.includes("implementation"), "Missing 'implementation'");
  assert(data.tags.includes("math"), "Missing 'math'");
});

// ── Modern layout ────────────────────────────────────────────────────────────

console.log("\n━━━ Variant B: Modern CF with test-example-line divs ━━━");

test("Modern — test-example-line divs joined with newlines", () => {
  const win = makeWindow(CF_MODERN);
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assert(data.testCases.length === 2, `Expected 2 TCs, got ${data.testCases.length}`);
  // test-example-line should be joined with \n
  assert(data.testCases[0].in.includes("4 9"), "TC[0].in missing '4 9'");
  assert(data.testCases[0].in.includes("2 7 11 15"), "TC[0].in missing '2 7 11 15'");
});

// ── Gym layout ───────────────────────────────────────────────────────────────

console.log("\n━━━ Variant C: CF Gym URL ━━━");

test("Gym — URL matches /gym/*/problem/", () => {
  const win = makeWindow(CF_GYM, "https://codeforces.com/gym/1234567/problem/B");
  const P = loadParsers(win);
  assert(P.Codeforces.isMatch(), "Should match gym URL");
});

test("Gym — title parsed correctly", () => {
  const win = makeWindow(CF_GYM, "https://codeforces.com/gym/1234567/problem/B");
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assert(data, "parse() returned null");
  assertEq(data.title, "Matrix Rotation", "title");
});

test("Gym — B index → Easy difficulty", () => {
  const win = makeWindow(CF_GYM, "https://codeforces.com/gym/1234567/problem/B");
  const P = loadParsers(win);
  const data = P.Codeforces.parse();
  assertEq(data.difficulty, "Easy", "difficulty");
});

// ── URL matching ─────────────────────────────────────────────────────────────

console.log("\n━━━ URL Matching ━━━");

test("Match: /contest/1800/problem/A", () => {
  const win = makeWindow("", "https://codeforces.com/contest/1800/problem/A");
  const P = loadParsers(win);
  assert(P.Codeforces.isMatch(), "Should match");
});

test("Match: /problemset/problem/1800/A", () => {
  const win = makeWindow("", "https://codeforces.com/problemset/problem/1800/A");
  const P = loadParsers(win);
  assert(P.Codeforces.isMatch(), "Should match");
});

test("Match: /gym/1234567/problem/B", () => {
  const win = makeWindow("", "https://codeforces.com/gym/1234567/problem/B");
  const P = loadParsers(win);
  assert(P.Codeforces.isMatch(), "Should match");
});

test("No match: /contest/1800 (no /problem/)", () => {
  const win = makeWindow("", "https://codeforces.com/contest/1800");
  const P = loadParsers(win);
  assert(!P.Codeforces.isMatch(), "Should NOT match");
});

// ── Difficulty inference ─────────────────────────────────────────────────────

console.log("\n━━━ Difficulty Inference ━━━");

test("Problem A → Easy", () => {
  const win = makeWindow(
    `<div class="problem-statement"><div class="header"><div class="title">A. Test</div></div></div>`,
    "https://codeforces.com/contest/1/problem/A"
  );
  const P = loadParsers(win);
  assertEq(P.Codeforces.getDifficulty(), "Easy", "A");
});

test("Problem C → Med", () => {
  const win = makeWindow(
    `<div class="problem-statement"><div class="header"><div class="title">C. Test</div></div></div>`,
    "https://codeforces.com/contest/1/problem/C"
  );
  const P = loadParsers(win);
  assertEq(P.Codeforces.getDifficulty(), "Med", "C");
});

test("Problem F → Hard", () => {
  const win = makeWindow(
    `<div class="problem-statement"><div class="header"><div class="title">F. Test</div></div></div>`,
    "https://codeforces.com/contest/1/problem/F"
  );
  const P = loadParsers(win);
  assertEq(P.Codeforces.getDifficulty(), "Hard", "F");
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
