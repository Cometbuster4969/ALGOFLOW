const express = require("express");
const { body, query, validationResult } = require("express-validator");
const { DEFAULT_USER_ID } = require("../srs/scheduler");

const router = express.Router();

function handleErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", details: errors.array() });
  }
  next();
}

function userId(req) {
  return parseInt(req.headers["x-user-id"] || String(DEFAULT_USER_ID), 10);
}

router.get(
  "/",
  [query("q").optional().isString(), query("language").optional().isString()],
  handleErrors,
  async (req, res) => {
    const uid = userId(req);
    const q = (req.query.q || "").trim().toLowerCase();
    const lang = req.query.language;

    let sql = `SELECT id, name, language, tags, body, created_at, updated_at
               FROM templates WHERE user_id = ?`;
    const params = [uid];

    if (lang) {
      sql += ` AND language = ?`;
      params.push(lang);
    }
    sql += ` ORDER BY name ASC`;

    const result = await req.db.query(sql, params);
    let rows = result.rows.map((r) => ({
      ...r,
      tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
    }));

    if (q) {
      rows = rows.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          (t.tags || []).some((tag) => tag.toLowerCase().includes(q))
      );
    }

    res.json({ count: rows.length, templates: rows });
  }
);

router.post(
  "/",
  [
    body("name").isString().notEmpty().isLength({ max: 120 }),
    body("language").isIn(["cpp", "python", "java"]),
    body("body").isString().notEmpty(),
    body("tags").optional().isArray(),
  ],
  handleErrors,
  async (req, res) => {
    const uid = userId(req);
    const tags = JSON.stringify(req.body.tags || []);
    const insert = await req.db.query(
      `INSERT INTO templates (user_id, name, language, tags, body)
       VALUES (?, ?, ?, ?, ?)`,
      [uid, req.body.name, req.body.language, tags, req.body.body]
    );
    res.status(201).json({ id: insert.lastInsertRowid, name: req.body.name });
  }
);

router.put(
  "/:id",
  [
    body("name").optional().isString().notEmpty(),
    body("language").optional().isIn(["cpp", "python", "java"]),
    body("body").optional().isString(),
    body("tags").optional().isArray(),
  ],
  handleErrors,
  async (req, res) => {
    const uid = userId(req);
    const id = parseInt(req.params.id, 10);
    const existing = await req.db.query(
      `SELECT id FROM templates WHERE id = ? AND user_id = ?`,
      [id, uid]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    const fields = [];
    const params = [];
    if (req.body.name) {
      fields.push("name = ?");
      params.push(req.body.name);
    }
    if (req.body.language) {
      fields.push("language = ?");
      params.push(req.body.language);
    }
    if (req.body.body) {
      fields.push("body = ?");
      params.push(req.body.body);
    }
    if (req.body.tags) {
      fields.push("tags = ?");
      params.push(JSON.stringify(req.body.tags));
    }
    fields.push("updated_at = datetime('now')");
    params.push(id, uid);

    await req.db.query(
      `UPDATE templates SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      params
    );
    res.json({ ok: true });
  }
);

router.delete("/:id", async (req, res) => {
  const uid = userId(req);
  const id = parseInt(req.params.id, 10);
  await req.db.query(`DELETE FROM templates WHERE id = ? AND user_id = ?`, [id, uid]);
  res.json({ ok: true });
});

module.exports = router;
