/**
 * ============================================================================
 * AlgoFlow Spaced Repetition — Review API Endpoints
 * ============================================================================
 *
 * PUT  /api/review          — Submit a review rating
 * GET  /api/review/due      — Get problems due today
 * GET  /api/review/stats    — Get daily review statistics
 * GET  /api/review/forecast — Get review forecast (next 14 days)
 *
 * All endpoints require authentication (userId from session).
 * All dates in responses are YYYY-MM-DD (UTC).
 * ============================================================================
 */

import { Router, Request, Response, NextFunction } from "express";
import { body, query, validationResult } from "express-validator";
import { SchedulerService, type DatabaseAdapter } from "../services/scheduler";
import { type Rating } from "../services/sm2";

const router = Router();

// ─── Middleware: validation error handler ────────────────────────────────────

function handleErrors(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
    return;
  }
  next();
}

// ─── Middleware: auth stub ───────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // In production, extract userId from JWT/session
  const userId = parseInt(req.headers["x-user-id"] as string, 10);
  if (!userId || isNaN(userId)) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Missing x-user-id header" });
    return;
  }
  (req as any).userId = userId;
  next();
}

// ─── PUT /api/review — Submit a review rating ───────────────────────────────

router.put(
  "/",
  requireAuth,
  [
    body("problem_id")
      .isInt({ min: 1 })
      .withMessage("problem_id must be a positive integer"),
    body("rating")
      .isInt({ min: 1, max: 5 })
      .withMessage("rating must be an integer between 1 and 5"),
    body("time_spent_ms")
      .optional()
      .isInt({ min: 0 })
      .withMessage("time_spent_ms must be a non-negative integer"),
  ],
  handleErrors,
  async (req: Request, res: Response) => {
    try {
      const db: DatabaseAdapter = (req as any).db;
      const scheduler = new SchedulerService(db);
      const userId = (req as any).userId;

      const result = await scheduler.submitReview({
        userId,
        problemId: req.body.problem_id,
        rating: req.body.rating as Rating,
        timeSpentMs: req.body.time_spent_ms,
      });

      res.json(result);
    } catch (err: any) {
      console.error("[Review API] Error:", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

// ─── GET /api/review/due — Get problems due today ───────────────────────────

router.get(
  "/due",
  requireAuth,
  [
    query("limit")
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage("limit must be between 1 and 200"),
  ],
  handleErrors,
  async (req: Request, res: Response) => {
    try {
      const db: DatabaseAdapter = (req as any).db;
      const scheduler = new SchedulerService(db);
      const userId = (req as any).userId;
      const limit = parseInt(req.query.limit as string, 10) || 50;

      const problems = await scheduler.getDueProblems(userId, limit);

      res.json({
        count: problems.length,
        problems,
        generated_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[Review API] Error:", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

// ─── GET /api/review/stats — Get daily review statistics ─────────────────────

router.get(
  "/stats",
  requireAuth,
  [
    query("date")
      .optional()
      .isISO8601()
      .withMessage("date must be YYYY-MM-DD format"),
  ],
  handleErrors,
  async (req: Request, res: Response) => {
    try {
      const db: DatabaseAdapter = (req as any).db;
      const scheduler = new SchedulerService(db);
      const userId = (req as any).userId;
      const date = req.query.date as string | undefined;

      const stats = await scheduler.getDailyStats(userId, date);

      res.json(stats);
    } catch (err: any) {
      console.error("[Review API] Error:", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

// ─── GET /api/review/forecast — Get review forecast ──────────────────────────

router.get(
  "/forecast",
  requireAuth,
  [
    query("days")
      .optional()
      .isInt({ min: 1, max: 90 })
      .withMessage("days must be between 1 and 90"),
  ],
  handleErrors,
  async (req: Request, res: Response) => {
    try {
      const db: DatabaseAdapter = (req as any).db;
      const scheduler = new SchedulerService(db);
      const userId = (req as any).userId;
      const days = parseInt(req.query.days as string, 10) || 14;

      const forecast = await scheduler.getForecast(userId, days);

      res.json({
        days,
        forecast,
      });
    } catch (err: any) {
      console.error("[Review API] Error:", err);
      res.status(500).json({ error: "INTERNAL", message: err.message });
    }
  }
);

export default router;
