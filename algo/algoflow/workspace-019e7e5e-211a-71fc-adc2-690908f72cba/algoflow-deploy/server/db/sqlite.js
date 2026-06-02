/**
 * SQLite database adapter for AlgoFlow MVP (single local user).
 * Uses Node's built-in node:sqlite (no native rebuild per Node version).
 */

const fs = require("fs");
const path = require("path");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  console.error(
    "[AlgoFlow DB] node:sqlite requires Node.js >= 22.5. " +
      `Current: ${process.version}. Use Node 22 LTS or 24+.`
  );
  process.exit(1);
}

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

let dbInstance = null;

function getDataDir() {
  return process.env.ALGOFLOW_DATA_DIR || path.join(process.cwd(), "data");
}

function openDatabase() {
  if (dbInstance) return dbInstance;

  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "algoflow.db");

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec("PRAGMA journal_mode = WAL");
  dbInstance.exec("PRAGMA foreign_keys = ON");

  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  dbInstance.exec(schema);

  const { seedDatabase } = require("./seed");
  seedDatabase(dbInstance);

  console.log(`[AlgoFlow DB] SQLite at ${dbPath}`);
  return dbInstance;
}

/**
 * DatabaseAdapter compatible with SchedulerService.
 */
function createAdapter() {
  const db = openDatabase();

  return {
    query(sql, params = []) {
      const trimmed = sql.trim().toUpperCase();
      const isSelect = trimmed.startsWith("SELECT") || trimmed.startsWith("WITH");

      if (trimmed === "BEGIN" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
        db.exec(trimmed);
        return { rows: [] };
      }

      const stmt = db.prepare(sql);
      if (isSelect) {
        const rows = stmt.all(...params);
        return { rows: normalizeRows(rows) };
      }

      stmt.run(...params);
      return {
        rows: [],
        lastInsertRowid: Number(db.lastInsertRowid),
        changes: db.changes,
      };
    },
  };
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const out = { ...row };
    if (out.tags && typeof out.tags === "string") {
      try {
        out.tags = JSON.parse(out.tags);
      } catch {
        out.tags = [];
      }
    }
    if (out.next_review_date && typeof out.next_review_date === "string") {
      out.next_review_date = out.next_review_date.slice(0, 10);
    }
    if (out.days_overdue !== undefined) {
      out.days_overdue = Number(out.days_overdue) || 0;
    }
    return out;
  });
}

function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { openDatabase, createAdapter, closeDatabase, getDataDir };
