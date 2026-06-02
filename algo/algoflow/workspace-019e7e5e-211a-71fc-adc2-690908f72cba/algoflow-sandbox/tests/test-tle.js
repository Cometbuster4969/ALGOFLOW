/**
 * ============================================================================
 * Test: TLE (Time Limit Exceeded) Detection
 * ============================================================================
 *
 * Runs an infinite loop (while(true)) with a 2-second time limit.
 * The sandbox should kill the process and return TLE.
 *
 * PASS criteria: result.status === "TLE" AND result.time < 5000 ms
 * ============================================================================
 */

const { SandboxRunner, Verdict } = require("../server/runner");

async function testTleCpp() {
  console.log("─── TLE Test: C++ infinite loop ───");

  const sourceCode = `
#include <iostream>
using namespace std;

int main() {
    while (true) {
        // Burn CPU — no sleep
        volatile int x = 0;
        x++;
    }
    return 0;
}
`.trim();

  const runner = new SandboxRunner({
    language: "cpp",
    sourceCode,
    stdinData: "",
    memoryLimitKB: 256 * 1024,
    timeLimitMs: 2000, // 2 seconds
  });

  const result = await runner.execute();
  console.log("  Result:", JSON.stringify(result, null, 2));

  const pass =
    result.status === Verdict.TLE &&
    result.time < 5000; // Should kill within ~4s wall-clock (2x CPU limit)

  console.log(
    `  Expected: TLE (< 5s wall) | Got: ${result.status} @ ${result.time}ms | ${pass ? "✓ PASS" : "✗ FAIL"}`
  );
  return pass;
}

async function testTlePython() {
  console.log("─── TLE Test: Python infinite loop ───");

  const sourceCode = `
while True:
    pass
`.trim();

  const runner = new SandboxRunner({
    language: "python",
    sourceCode,
    stdinData: "",
    memoryLimitKB: 256 * 1024,
    timeLimitMs: 2000,
  });

  const result = await runner.execute();
  console.log("  Result:", JSON.stringify(result, null, 2));

  const pass =
    result.status === Verdict.TLE &&
    result.time < 5000;

  console.log(
    `  Expected: TLE (< 5s wall) | Got: ${result.status} @ ${result.time}ms | ${pass ? "✓ PASS" : "✗ FAIL"}`
  );
  return pass;
}

async function testTleSleep() {
  console.log("─── TLE Test: Python long sleep ───");

  // sleeping should also be caught by CPU time or wall clock
  const sourceCode = `
import time
time.sleep(60)
print("done")
`.trim();

  const runner = new SandboxRunner({
    language: "python",
    sourceCode,
    stdinData: "",
    memoryLimitKB: 256 * 1024,
    timeLimitMs: 2000,
  });

  const result = await runner.execute();
  console.log("  Result:", JSON.stringify(result, null, 2));

  // Wall-clock timeout should catch this even if CPU time doesn't
  const pass =
    (result.status === Verdict.TLE || result.status === Verdict.RE) &&
    result.time < 8000;

  console.log(
    `  Expected: TLE/RE (< 8s wall) | Got: ${result.status} @ ${result.time}ms | ${pass ? "✓ PASS" : "✗ FAIL"}`
  );
  return pass;
}

async function run() {
  const results = await Promise.all([
    testTleCpp(),
    testTlePython(),
    testTleSleep(),
  ]);
  const allPassed = results.every(Boolean);
  console.log(`\n${allPassed ? "✓ ALL TLE TESTS PASSED" : "✗ SOME TLE TESTS FAILED"}\n`);
  return allPassed;
}

if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}

module.exports = { run };
