const express = require("express");
const { body, validationResult } = require("express-validator");
const { SandboxRunner } = require("../sandbox/runner");
const {
  staticAnalysis,
  estimateFromTimings,
  combine,
} = require("../srs/complexity");

const router = express.Router();

router.post(
  "/complexity",
  [
    body("source_code").isString().notEmpty(),
    body("language").isIn(["cpp", "python", "java"]),
    body("benchmark_sizes").optional().isArray(),
    body("test_cases").optional().isArray(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "VALIDATION_ERROR", details: errors.array() });
    }

    const { source_code, language, benchmark_sizes, test_cases } = req.body;
    const staticResult = staticAnalysis(source_code);

    let empiricalResult = null;
    const sizes = benchmark_sizes || [10, 100, 500];
    const benchCases = buildBenchmarkCases(test_cases, sizes, language);

    if (benchCases.length >= 2) {
      const points = [];
      for (const tc of benchCases) {
        const runner = new SandboxRunner({
          language,
          sourceCode: source_code,
          stdinData: tc.input,
          expectedOutput: null,
          timeLimitMs: 5000,
          memoryLimitKB: 262144,
        });
        const result = await runner.execute();
        if (result.status === "TLE" || result.status === "MLE") {
          points.push({ size: tc.size, timeMs: result.time, status: result.status });
          break;
        }
        if (result.status !== "AC" && result.status !== "RE") continue;
        points.push({
          size: tc.size,
          timeMs: Math.max(result.time, 1),
          memoryKb: result.memory,
          status: result.status,
        });
      }
      empiricalResult = estimateFromTimings(points);
      empiricalResult.peak_memory_kb = Math.max(
        0,
        ...points.map((p) => p.memoryKb || 0)
      );
    }

    const report = combine(staticResult, empiricalResult);

    res.json({
      overall: report.combined || staticResult.time,
      time: report.combined || staticResult.time,
      space: empiricalResult?.peak_memory_kb
        ? `~${empiricalResult.peak_memory_kb} KB peak`
        : staticResult.space,
      confidence: report.confidence || staticResult.confidence,
      static: staticResult,
      empirical: empiricalResult,
      notes: report.notes,
    });
  }
);

function buildBenchmarkCases(testCases, sizes, language) {
  if (testCases?.length >= 2) {
    return testCases.map((tc, i) => ({
      size: sizes[i] || (i + 1) * 100,
      input: tc.input || tc.in || "",
    }));
  }

  if (language === "python") {
    return sizes.map((n) => ({
      size: n,
      input: `${n}\n` + Array.from({ length: n }, (_, i) => i + 1).join(" ") + "\n",
    }));
  }

  return sizes.map((n) => ({
    size: n,
    input: `${n}\n`,
  }));
}

module.exports = router;
