/**
 * Review API — spaced repetition endpoints
 */

const express = require("express");
const { body, query, validationResult } = require("express-validator");
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

function requireAuth(req, res, next) {
  const userId = parseInt(req.headers["x-user-id"] || String(DEFAULT_USER_ID), 10);
  if (!userId || Number.isNaN(userId)) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid user id" });
  }
  req.userId = userId;
  next();
}

function getScheduler(req) {
  return new SchedulerService(req.db);
}

router.put(
  "/",
  requireAuth,
  [
    body("problem_id").isInt({ min: 1 }),
    body("rating").isInt({ min: 1, max: 5 }),
    body("time_spent_ms").optional().isInt({ min: 0 }),
  ],
  handleErrors,
  async (req, res) => {
    try {
      const scheduler = getScheduler(req);
      const result = await scheduler.submitReview({
        userId: req.userId,
        problemId: req.body.problem_id,
        rating: req.body.rating,
        timeSpentMs: req.body.time_spent_ms,
      });
      res.json(result);
    } catch (err) {
      console.error("[Review API]", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

router.get(
  "/due",
  requireAuth,
  [query("limit").optional().isInt({ min: 1, max: 200 })],
  handleErrors,
  async (req, res) => {
    try {
      const scheduler = getScheduler(req);
      const limit = parseInt(req.query.limit, 10) || 50;
      const problems = await scheduler.getDueProblems(req.userId, limit);
      res.json({
        count: problems.length,
        problems,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[Review API]", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

router.get(
  "/stats",
  requireAuth,
  [query("date").optional().matches(/^\d{4}-\d{2}-\d{2}$/)],
  handleErrors,
  async (req, res) => {
    try {
      const scheduler = getScheduler(req);
      const stats = await scheduler.getDailyStats(req.userId, req.query.date);
      res.json(stats);
    } catch (err) {
      console.error("[Review API]", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

router.get(
  "/forecast",
  requireAuth,
  [query("days").optional().isInt({ min: 1, max: 90 })],
  handleErrors,
  async (req, res) => {
    try {
      const scheduler = getScheduler(req);
      const days = parseInt(req.query.days, 10) || 14;
      const forecast = await scheduler.getForecast(req.userId, days);
      res.json({ days, forecast });
    } catch (err) {
      console.error("[Review API]", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

module.exports = router;
