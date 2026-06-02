/**
 * POST /api/execute — code sandbox batch runner
 */

const express = require("express");
const { SandboxRunner, Verdict } = require("../sandbox/runner");
const {
  validateExecutionRequest,
  handleValidationErrors,
  scanForInjection,
  clampResourceLimits,
  executionRateLimiter,
  assertNonRoot,
} = require("../sandbox/security");

const router = express.Router();

router.post(
  "/execute",
  executionRateLimiter,
  assertNonRoot,
  validateExecutionRequest,
  handleValidationErrors,
  scanForInjection,
  clampResourceLimits,
  executeHandler
);

async function executeHandler(req, res) {
  const {
    language,
    source_code,
    test_cases,
    memory_limit_kb,
    time_limit_ms,
  } = req.body;

  const results = [];
  let overallStatus = Verdict.AC;
  const batchStart = Date.now();
  let peakMemory = 0;

  for (let i = 0; i < test_cases.length; i++) {
    const tc = test_cases[i];

    const runner = new SandboxRunner({
      language,
      sourceCode: source_code,
      stdinData: tc.input,
      expectedOutput: tc.expected_output ?? null,
      memoryLimitKB: memory_limit_kb,
      timeLimitMs: time_limit_ms,
    });

    const result = await runner.execute();

    results.push({
      status: result.status,
      time: result.time,
      memory: result.memory,
      output: result.output.slice(0, 4096),
    });

    if (statusPriority(result.status) > statusPriority(overallStatus)) {
      overallStatus = result.status;
    }

    if (result.memory > peakMemory) peakMemory = result.memory;

    if (overallStatus !== Verdict.AC && i === 0) break;
  }

  return res.json({
    overall_status: overallStatus,
    results,
    summary: {
      total: test_cases.length,
      passed: results.filter((r) => r.status === Verdict.AC).length,
      total_time_ms: Date.now() - batchStart,
      peak_memory_kb: peakMemory,
    },
  });
}

function statusPriority(status) {
  switch (status) {
    case Verdict.AC:
      return 0;
    case Verdict.TLE:
      return 1;
    case Verdict.MLE:
      return 2;
    case Verdict.RE:
      return 3;
    default:
      return 4;
  }
}

module.exports = router;
