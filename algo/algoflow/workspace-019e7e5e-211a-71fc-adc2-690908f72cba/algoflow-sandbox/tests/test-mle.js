/**
 * ============================================================================
 * Test: MLE (Memory Limit Exceeded) Detection
 * ============================================================================
 *
 * Allocates a large array (~10^7 integers ≈ 40 MB in C++) with a tight
 * memory limit to verify the sandbox correctly returns MLE status.
 *
 * PASS criteria: result.status === "MLE"
 * ============================================================================
 */

const { SandboxRunner, Verdict } = require("../server/runner");

async function testMleCpp() {
  console.log("─── MLE Test: C++ large array allocation ───");

  // Allocates ~40 MB (10^7 * 4 bytes) — exceeds a 16 MB sandbox limit
  const sourceCode = `
#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n = 10000000; // 10^7 elements
    vector<int> arr(n, 42);
    long long sum = 0;
    for (int i = 0; i < n; i++) sum += arr[i];
    cout << sum << endl;
    return 0;
}
`.trim();

  const runner = new SandboxRunner({
    language: "cpp",
    sourceCode,
    stdinData: "",
    memoryLimitKB: 16 * 1024, // 16 MB — should trigger MLE
    timeLimitMs: 5000,
  });

  const result = await runner.execute();
  console.log("  Result:", JSON.stringify(result, null, 2));

  // MLE or RE are both acceptable — the key is that the process was killed
  const pass =
    result.status === Verdict.MLE ||
    result.status === Verdict.RE;

  console.log(`  Expected: MLE | Got: ${result.status} | ${pass ? "✓ PASS" : "✗ FAIL"}`);
  return pass;
}

async function testMlePython() {
  console.log("─── MLE Test: Python large list allocation ───");

  // Allocates ~80 MB of Python objects
  const sourceCode = `
import sys
arr = [0] * (10**7)
print(len(arr))
`.trim();

  const runner = new SandboxRunner({
    language: "python",
    sourceCode,
    stdinData: "",
    memoryLimitKB: 16 * 1024, // 16 MB
    timeLimitMs: 5000,
  });

  const result = await runner.execute();
  console.log("  Result:", JSON.stringify(result, null, 2));

  const pass =
    result.status === Verdict.MLE ||
    result.status === Verdict.RE;

  console.log(`  Expected: MLE | Got: ${result.status} | ${pass ? "✓ PASS" : "✗ FAIL"}`);
  return pass;
}

async function run() {
  const results = await Promise.all([testMleCpp(), testMlePython()]);
  const allPassed = results.every(Boolean);
  console.log(`\n${allPassed ? "✓ ALL MLE TESTS PASSED" : "✗ SOME MLE TESTS FAILED"}\n`);
  return allPassed;
}

if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}

module.exports = { run };
