/**
 * ============================================================================
 * AlgoFlow — Execution Endpoint
 * ============================================================================
 *
 * POST /api/execute
 *
 * Accepts a source code submission and an array of test cases, runs each
 * through the SandboxRunner, and returns batched results.
 *
 * Request body:
 * {
 *   "language":      "cpp" | "python" | "java",
 *   "source_code":   "...",
 *   "test_cases":    [{ "input": "...", "expected_output": "..." }, ...],
 *   "memory_limit_kb": 262144,  (optional, default 256 MB)
 *   "time_limit_ms":   2000     (optional, default 2 s)
 * }
 *
 * Response:
 * {
 *   "overall_status": "AC" | "TLE" | "MLE" | "RE" | "CE",
 *   "results": [
 *     {
 *       "status": "AC" | "TLE" | "MLE" | "RE",
 *       "time": 123,        // ms
 *       "memory": 45678,    // KB
 *       "output": "..."
 *     },
 *     ...
 *   ],
 *   "summary": {
 *     "total": 10,
 *     "passed": 10,
 *     "total_time_ms": 1234,
 *     "peak_memory_kb": 45678
 *   }
 * }
 * ============================================================================
 */

import { Router, Request, Response, NextFunction } from "express";
import { SandboxRunner, Verdict } from "../server/runner.js";
import {
  validateExecutionRequest,
  handleValidationErrors,
  scanForInjection,
  clampResourceLimits,
  executionRateLimiter,
  assertNonRoot,
} from "../server/security.js";

const router = Router();

// ─── Middleware chain ─────────────────────────────────────────────────────────

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

// ─── Handler ─────────────────────────────────────────────────────────────────

async function executeHandler(req: Request, res: Response, _next: NextFunction) {
  const {
    language,
    source_code,
    test_cases,
    memory_limit_kb,
    time_limit_ms,
  } = req.body;

  const results: Array<{
    status: string;
    time: number;
    memory: number;
    output: string;
  }> = [];

  let overallStatus: string = Verdict.AC;
  const batchStart = Date.now();
  let peakMemory = 0;

  // ── Batch execution loop ────────────────────────────────────────────────

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
      output: result.output.slice(0, 4096), // truncate for response
    });

    // Track worst status (priority: CE > RE > MLE > TLE > AC)
    if (statusPriority(result.status) > statusPriority(overallStatus)) {
      overallStatus = result.status;
    }

    // Track peak memory
    if (result.memory > peakMemory) {
      peakMemory = result.memory;
    }

    // Short-circuit: if first test fails, report immediately
    // (Remove this block if you want all test results regardless)
    if (overallStatus !== Verdict.AC && i === 0) {
      break;
    }
  }

  const totalTime = Date.now() - batchStart;

  // ── Response ────────────────────────────────────────────────────────────

  return res.json({
    overall_status: overallStatus,
    results,
    summary: {
      total: test_cases.length,
      passed: results.filter((r) => r.status === Verdict.AC).length,
      total_time_ms: totalTime,
      peak_memory_kb: peakMemory,
    },
  });
}

// ─── Helper: verdict priority (higher = worse) ───────────────────────────────

function statusPriority(status: string): number {
  switch (status) {
    case Verdict.AC:  return 0;
    case Verdict.TLE: return 1;
    case Verdict.MLE: return 2;
    case Verdict.RE:  return 3;
    default:          return 4; // CE, unknown
  }
}

// ─── Health endpoint ─────────────────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

export default router;
