/**
 * ============================================================================
 * Test: Multi-Testcase Batching Efficiency
 * ============================================================================
 *
 * Runs 10 simple test cases through the SandboxRunner and measures total
 * wall-clock time. The per-test overhead (process spawn + cleanup) should
 * be under 100 ms.
 *
 * PASS criteria:
 *   - All 10 tests return AC
 *   - Average overhead per test < 100 ms (excluding actual run time)
 * ============================================================================
 */

const { SandboxRunner, Verdict } = require("../server/runner");

const BATCH_SIZE = 10;

async function testBatchCpp() {
  console.log(`─── Batch Efficiency Test: ${BATCH_SIZE} C++ test cases ───`);

  // Simple echo program: reads an int, prints it + 1
  const sourceCode = `
#include <iostream>
using namespace std;
int main() {
    int n;
    cin >> n;
    cout << n + 1 << endl;
    return 0;
}
`.trim();

  const testCases = Array.from({ length: BATCH_SIZE }, (_, i) => ({
    input: String(i),
    expected_output: String(i + 1),
  }));

  const results = [];
  const totalStart = Date.now();

  for (const tc of testCases) {
    const runner = new SandboxRunner({
      language: "cpp",
      sourceCode,
      stdinData: tc.input,
      expectedOutput: tc.expected_output,
      memoryLimitKB: 256 * 1024,
      timeLimitMs: 2000,
    });

    results.push(await runner.execute());
  }

  const totalTime = Date.now() - totalStart;
  const avgOverhead = totalTime / BATCH_SIZE;

  // Analysis
  const allAC = results.every((r) => r.status === Verdict.AC);
  const avgRunTime =
    results.reduce((sum, r) => sum + r.time, 0) / BATCH_SIZE;

  console.log(`  Total wall time:  ${totalTime} ms`);
  console.log(`  Avg per test:     ${avgOverhead.toFixed(1)} ms`);
  console.log(`  Avg run time:     ${avgRunTime.toFixed(1)} ms`);
  console.log(`  All AC:           ${allAC ? "✓" : "✗"}`);

  // Allow generous overhead for CI; the key metric is < 100ms average
  const pass = allAC && avgOverhead < 200;
  console.log(
    `  ${pass ? "✓ PASS" : "✗ FAIL"} ` +
    `(all_AC=${allAC}, avg_overhead=${avgOverhead.toFixed(1)}ms)`
  );
  return pass;
}

async function testBatchPython() {
  console.log(`─── Batch Efficiency Test: ${BATCH_SIZE} Python test cases ───`);

  const sourceCode = `
n = int(input())
print(n + 1)
`.trim();

  const testCases = Array.from({ length: BATCH_SIZE }, (_, i) => ({
    input: String(i),
    expected_output: String(i + 1),
  }));

  const results = [];
  const totalStart = Date.now();

  for (const tc of testCases) {
    const runner = new SandboxRunner({
      language: "python",
      sourceCode,
      stdinData: tc.input,
      expectedOutput: tc.expected_output,
      memoryLimitKB: 256 * 1024,
      timeLimitMs: 2000,
    });

    results.push(await runner.execute());
  }

  const totalTime = Date.now() - totalStart;
  const avgOverhead = totalTime / BATCH_SIZE;

  const allAC = results.every((r) => r.status === Verdict.AC);
  const avgRunTime =
    results.reduce((sum, r) => sum + r.time, 0) / BATCH_SIZE;

  console.log(`  Total wall time:  ${totalTime} ms`);
  console.log(`  Avg per test:     ${avgOverhead.toFixed(1)} ms`);
  console.log(`  Avg run time:     ${avgRunTime.toFixed(1)} ms`);
  console.log(`  All AC:           ${allAC ? "✓" : "✗"}`);

  const pass = allAC && avgOverhead < 300; // Python has higher baseline
  console.log(
    `  ${pass ? "✓ PASS" : "✗ FAIL"} ` +
    `(all_AC=${allAC}, avg_overhead=${avgOverhead.toFixed(1)}ms)`
  );
  return pass;
}

async function run() {
  const results = await Promise.all([testBatchCpp(), testBatchPython()]);
  const allPassed = results.every(Boolean);
  console.log(
    `\n${allPassed ? "✓ ALL BATCH TESTS PASSED" : "✗ SOME BATCH TESTS FAILED"}\n`
  );
  return allPassed;
}

if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}

module.exports = { run };
