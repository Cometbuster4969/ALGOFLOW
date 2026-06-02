const express = require("express");
const { body, validationResult } = require("express-validator");

const router = express.Router();

router.get("/", async (req, res) => {
  const result = await req.db.query(
    `SELECT id, name, created_at FROM users ORDER BY id ASC`
  );
  res.json({ users: result.rows });
});

router.post(
  "/",
  [body("name").isString().trim().notEmpty().isLength({ max: 64 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "VALIDATION_ERROR", details: errors.array() });
    }
    const insert = await req.db.query(`INSERT INTO users (name) VALUES (?)`, [
      req.body.name.trim(),
    ]);
    res.status(201).json({ id: insert.lastInsertRowid, name: req.body.name.trim() });
  }
);

module.exports = router;
