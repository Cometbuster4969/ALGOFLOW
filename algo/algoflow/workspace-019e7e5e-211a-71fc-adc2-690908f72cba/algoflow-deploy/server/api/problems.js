/**
 * Problems API — import from browser extension, list for dashboard
 */

const express = require("express");
const { body, validationResult } = require("express-validator");
const { SchedulerService, DEFAULT_USER_ID } = require("../srs/scheduler");

const router = express.Router();

function handleErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

function buildExternalId(problem) {
  if (problem.external_id) return problem.external_id;
  const slug = (problem.slug || problem.title || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `${problem.platform}:${slug}`;
}

function normalizeDifficulty(d) {
  if (!d) return "Med";
  const s = String(d);
  if (/easy/i.test(s)) return "Easy";
  if (/hard/i.test(s)) return "Hard";
  return "Med";
}

router.post(
  "/import",
  [
    body("problems").isArray({ min: 1, max: 100 }),
    body("problems.*.platform").isString().notEmpty(),
    body("problems.*.title").isString().notEmpty(),
  ],
  handleErrors,
  async (req, res) => {
    const userId = parseInt(req.headers["x-user-id"] || String(DEFAULT_USER_ID), 10);
    const scheduler = new SchedulerService(req.db);
    const imported = [];

    for (const raw of req.body.problems) {
      const externalId = buildExternalId(raw);
      const tags = JSON.stringify(raw.tags || []);
      const testCases = JSON.stringify(
        (raw.testCases || raw.test_cases || []).map((tc) => ({
          input: tc.in || tc.input || "",
          expected_output: tc.out || tc.expected_output || "",
        }))
      );

      const existing = await req.db.query(
        `SELECT id FROM problems WHERE external_id = ?`,
        [externalId]
      );

      let problemId;
      if (existing.rows.length > 0) {
        problemId = existing.rows[0].id;
        await req.db.query(
          `UPDATE problems SET title = ?, difficulty = ?, tags = ?, url = ?, test_cases = ?
           WHERE id = ?`,
          [
            raw.title,
            normalizeDifficulty(raw.difficulty),
            tags,
            raw.url || null,
            testCases,
            problemId,
          ]
        );
      } else {
        const insert = await req.db.query(
          `INSERT INTO problems (external_id, platform, title, difficulty, tags, url, test_cases)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            externalId,
            raw.platform,
            raw.title,
            normalizeDifficulty(raw.difficulty),
            tags,
            raw.url || null,
            testCases,
          ]
        );
        problemId = insert.lastInsertRowid;
      }

      await scheduler.addProblem(userId, problemId);
      imported.push({ problem_id: problemId, external_id: externalId });
    }

    res.json({ imported: imported.length, problems: imported });
  }
);

router.get("/list", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const result = await req.db.query(
    `SELECT id, external_id, platform, title, difficulty, tags, url, created_at
     FROM problems ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  res.json({ count: result.rows.length, problems: result.rows });
});

module.exports = router;
