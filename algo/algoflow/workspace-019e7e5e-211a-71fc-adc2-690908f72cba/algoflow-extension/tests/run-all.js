/**
 * ============================================================================
 * AlgoFlow Extension — Master Verification Runner
 * ============================================================================
 *
 * Runs all verification tests in sequence:
 *   1. DOM selectors vs LeetCode dynamic rendering
 *   2. DOM selectors vs Codeforces variants
 *   3. Multi-line test case parsing with escape characters
 *   4. Export button safety (no native breakage)
 *   5. Background script cross-origin security
 *
 * Usage: node tests/run-all.js
 * ============================================================================
 */

const { execSync } = require("child_process");
const path = require("path");

const suites = [
  { name: "DOM Selectors — LeetCode",        file: "01-selectors-leetcode.js" },
  { name: "DOM Selectors — Codeforces",      file: "02-selectors-codeforces.js" },
  { name: "Multi-Line & Escape Characters",  file: "03-multiline-escape.js" },
  { name: "Submit Button Safety",            file: "04-submit-button-safety.js" },
  { name: "Background Script Security",      file: "05-background-security.js" },
];

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║     AlgoFlow Extension — Verification Checklist Suite          ║");
console.log("╚══════════════════════════════════════════════════════════════════╝\n");

let allPassed = true;
const summary = [];

for (const suite of suites) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  SUITE: ${suite.name}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  try {
    execSync(`node ${path.join(__dirname, suite.file)}`, {
      stdio: "inherit",
      timeout: 30000,
    });
    summary.push({ name: suite.name, passed: true });
  } catch (err) {
    summary.push({ name: suite.name, passed: false });
    allPassed = false;
  }

  console.log();
}

// ── Final summary ────────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║                       FINAL RESULTS                             ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");

for (const s of summary) {
  const icon = s.passed ? "✓" : "✗";
  console.log(`║  ${icon} ${s.name.padEnd(50)} ${s.passed ? "PASSED" : "FAILED"} ║`);
}

console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  ${allPassed ? "✓ ALL SUITES PASSED" : "✗ SOME SUITES FAILED"}`.padEnd(66) + "║");
console.log("╚══════════════════════════════════════════════════════════════════╝");

process.exit(allPassed ? 0 : 1);
