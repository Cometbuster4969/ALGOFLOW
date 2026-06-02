/**
 * ============================================================================
 * AlgoFlow — Master Test Runner
 * ============================================================================
 *
 * Runs all sandbox verification tests in sequence:
 *   1. MLE detection
 *   2. TLE detection
 *   3. Shell injection neutralisation
 *   4. Batch efficiency
 *
 * Usage: node tests/run-all.js
 * ============================================================================
 */

const { run: runMle } = require("./test-mle");
const { run: runTle } = require("./test-tle");
const { testInjections } = require("./test-injection");
const { run: runBatch } = require("./test-batch");

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║      AlgoFlow Sandbox — Comprehensive Verification Suite   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const suiteResults = {};

  // ── 1. Injection tests (synchronous, fast) ──────────────────────────────

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  suiteResults["injection"] = testInjections();
  console.log();

  // ── 2. MLE tests ────────────────────────────────────────────────────────

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  suiteResults["mle"] = await runMle();
  console.log();

  // ── 3. TLE tests ────────────────────────────────────────────────────────

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  suiteResults["tle"] = await runTle();
  console.log();

  // ── 4. Batch tests ──────────────────────────────────────────────────────

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  suiteResults["batch"] = await runBatch();
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     FINAL RESULTS                          ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");

  let allPassed = true;
  for (const [suite, passed] of Object.entries(suiteResults)) {
    const icon = passed ? "✓" : "✗";
    const label = suite.toUpperCase().padEnd(20);
    console.log(`║  ${icon} ${label} ${passed ? "PASSED" : "FAILED"}                               ║`);
    if (!passed) allPassed = false;
  }

  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(
    `║  ${allPassed ? "✓ ALL SUITES PASSED" : "✗ SOME SUITES FAILED"}`
      .padEnd(62) + "║"
  );
  console.log("╚══════════════════════════════════════════════════════════════╝");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error in test runner:", err);
  process.exit(1);
});
