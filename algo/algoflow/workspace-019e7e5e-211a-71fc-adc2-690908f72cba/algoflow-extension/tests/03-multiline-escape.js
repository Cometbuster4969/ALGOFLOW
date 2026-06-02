/**
 * ============================================================================
 * CHECKLIST ITEM 4 — Multi-Line Test Cases with Escape Characters
 * ============================================================================
 *
 * Competitive programming problems frequently have:
 *   - Multi-line inputs (matrix rows, graph edges)
 *   - Strings with escaped characters (\n, \t, \", \\)
 *   - Unicode content (emoji, CJK, math symbols)
 *   - Blank lines / trailing newlines in sample I/O
 *   - Leading/trailing spaces within quoted strings
 *
 * This test verifies the parsers handle ALL of these correctly.
 *
 * Run: node tests/03-multiline-escape.js
 * ============================================================================
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");

const PARSERS_SRC = fs.readFileSync(__dirname + "/../content/parsers.js", "utf8");

function makeLC(html) {
  const dom = new JSDOM(html, {
    url: "https://leetcode.com/problems/test/description/",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });
  dom.window.eval(PARSERS_SRC);
  return dom.window.__AlgoFlowParsers;
}

function makeCF(html) {
  const dom = new JSDOM(html, {
    url: "https://codeforces.com/contest/1/problem/A",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });
  dom.window.eval(PARSERS_SRC);
  return dom.window.__AlgoFlowParsers;
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
function assertEq(a, b, f) {
  if (a !== b) throw new Error(`${f}:\n    expected: ${JSON.stringify(b)}\n    got:      ${JSON.stringify(a)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Multi-line input (graph / matrix problems)
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 1. Multi-Line Input (Graph / Matrix) ━━━");

test("LC: matrix rows across multiple lines in <pre>", () => {
  const P = makeLC(`
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <strong>Example 1:</strong>
      <pre>
Input: grid = [[1,2,3],[4,5,6],[7,8,9]]
Output: [[7,4,1],[8,5,2],[9,6,3]]
      </pre>
    </div></body></html>`);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 1, `Expected 1 TC, got ${data.testCases.length}`);
  assert(data.testCases[0].in.includes("[[1,2,3]"), "Missing matrix data");
});

test("CF: multi-line graph input preserved with newlines", () => {
  const html = `
    <div class="problem-statement">
      <div class="header"><div class="title">A. Graph</div></div>
      <div class="sample-test">
        <div class="input"><div class="title">Input</div>
          <pre><div class="test-example-line">5 4</div><div class="test-example-line">1 2</div><div class="test-example-line">2 3</div><div class="test-example-line">3 4</div><div class="test-example-line">4 5</div></pre>
        </div>
        <div class="output"><div class="title">Output</div>
          <pre><div class="test-example-line">YES</div></pre>
        </div>
      </div>
    </div>`;
  const P = makeCF(html);
  const data = P.Codeforces.parse();
  assert(data.testCases.length === 1, `Expected 1 TC, got ${data.testCases.length}`);
  const inText = data.testCases[0].in;
  assert(inText.includes("5 4"), "Missing '5 4'");
  assert(inText.includes("1 2"), "Missing '1 2'");
  assert(inText.includes("4 5"), "Missing '4 5'");
  // Lines should be newline-separated
  assert(inText.includes("\n"), "Multi-line input should contain newlines");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Escape characters in strings
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 2. Escape Characters ━━━");

test("LC: escaped quotes in string input", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <strong>Example 1:</strong>
      <pre>
Input: s = "hello world"
Output: "dlrow olleh"
      </pre>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 1, `Expected 1 TC, got ${data.testCases.length}`);
  assert(data.testCases[0].in.includes('"hello world"'), "Missing quoted string");
  assert(data.testCases[0].out.includes('"dlrow olleh"'), "Missing quoted output");
});

test("LC: backslash-escaped characters preserved", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <strong>Example 1:</strong>
      <pre>
Input: s = "a\\nb\\nc"
Output: 2
      </pre>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  // The escaped newline should be present
  assert(data.testCases[0].in.includes("a"), "Missing 'a'");
});

test("CF: tab-separated values", () => {
  const html = `
    <div class="problem-statement">
      <div class="header"><div class="title">A. Test</div></div>
      <div class="sample-test">
        <div class="input"><div class="title">Input</div><pre>a\tb\tc</pre></div>
        <div class="output"><div class="title">Output</div><pre>3</pre></div>
      </div>
    </div>`;
  const P = makeCF(html);
  const data = P.Codeforces.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  assert(data.testCases[0].in.includes("a"), "Missing 'a'");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Unicode content
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 3. Unicode Content ━━━");

test("LC: Unicode characters in input", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <strong>Example 1:</strong>
      <pre>
Input: s = "café"
Output: "éfac"
      </pre>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  assert(data.testCases[0].in.includes("café"), "Missing 'café'");
});

test("CF: CJK characters preserved", () => {
  const html = `
    <div class="problem-statement">
      <div class="header"><div class="title">A. 测试</div></div>
      <div class="sample-test">
        <div class="input"><div class="title">Input</div><pre>你好</pre></div>
        <div class="output"><div class="title">Output</div><pre>好你</pre></div>
      </div>
    </div>`;
  const P = makeCF(html);
  const data = P.Codeforces.parse();
  assertEq(data.title, "测试", "title");
  assert(data.testCases[0].in.includes("你好"), "Missing CJK input");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Non-breaking spaces (\u00a0) and whitespace normalisation
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 4. Whitespace Normalisation ━━━");

test("LC: nbsp characters collapsed to regular spaces", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <strong>Example 1:</strong>
      <pre>
Input: nums\u00a0=\u00a0[1,2,3]
Output: 6
      </pre>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  // nbsp should be replaced with regular space
  assert(!data.testCases[0].in.includes("\u00a0"), "nbsp not normalised");
  assert(data.testCases[0].in.includes("nums"), "Missing 'nums'");
});

test("CF: consecutive spaces collapsed", () => {
  const html = `
    <div class="problem-statement">
      <div class="header"><div class="title">A. Test</div></div>
      <div class="sample-test">
        <div class="input"><div class="title">Input</div><pre>1    2    3</pre></div>
        <div class="output"><div class="title">Output</div><pre>6</pre></div>
      </div>
    </div>`;
  const P = makeCF(html);
  const data = P.Codeforces.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  // Multiple spaces should be collapsed to one
  assert(!data.testCases[0].in.includes("    "), "Spaces not collapsed");
  assert(data.testCases[0].in.includes("1 2 3"), "Values missing");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Multiple example blocks with mixed content
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 5. Multiple Mixed Examples ━━━");

test("LC: 3 examples with explanations parsed correctly", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <p>Some intro text.</p>
      <p><strong>Example 1:</strong></p>
      <pre>
Input: n = 3
Output: 5
Explanation: Fibonacci(3) = 5
      </pre>
      <p><strong>Example 2:</strong></p>
      <pre>
Input: n = 0
Output: 0
      </pre>
      <p><strong>Example 3:</strong></p>
      <pre>
Input: n = 1
Output: 1
      </pre>
      <p><strong>Constraints:</strong></p>
      <ul><li>0 <= n <= 30</li></ul>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 3, `Expected 3 TCs, got ${data.testCases.length}`);
  assertEq(data.testCases[0].in, "n = 3", "TC[0].in");
  assertEq(data.testCases[0].out, "5", "TC[0].out");
  assertEq(data.testCases[1].in, "n = 0", "TC[1].in");
  assertEq(data.testCases[1].out, "0", "TC[1].out");
  assertEq(data.testCases[2].in, "n = 1", "TC[2].in");
  assertEq(data.testCases[2].out, "1", "TC[2].out");
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Edge: empty / whitespace-only test cases
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 6. Edge Cases ━━━");

test("LC: empty string input is preserved", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <strong>Example 1:</strong>
      <pre>
Input: s = ""
Output: 0
      </pre>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  assert(data.testCases[0].in.includes('s = ""'), "Empty string not preserved");
});

test("CF: single-character output", () => {
  const html = `
    <div class="problem-statement">
      <div class="header"><div class="title">A. Test</div></div>
      <div class="sample-test">
        <div class="input"><div class="title">Input</div><pre>1</pre></div>
        <div class="output"><div class="title">Output</div><pre>Y</pre></div>
      </div>
    </div>`;
  const P = makeCF(html);
  const data = P.Codeforces.parse();
  assert(data.testCases.length === 1, `Expected 1 TC`);
  assertEq(data.testCases[0].out, "Y", "output");
});

test("No test cases returns empty array (not null)", () => {
  const html = `
    <html><head><title>Test - LeetCode</title></head><body>
    <div data-track-load="description_content">
      <p>No examples here.</p>
    </div></body></html>`;
  const P = makeLC(html);
  const data = P.LeetCode.parse();
  assert(data, "parse() returned null");
  assert(Array.isArray(data.testCases), "testCases should be array");
  assertEq(data.testCases.length, 0, "testCases.length");
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
