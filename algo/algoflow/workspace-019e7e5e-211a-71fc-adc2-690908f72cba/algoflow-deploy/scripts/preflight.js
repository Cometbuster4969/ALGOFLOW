#!/usr/bin/env node
/**
 * Pre-start checks: Node version, node:sqlite, optional compiler hints.
 */
const { spawnSync } = require("child_process");
const MIN_NODE = [22, 5, 0];

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v || "");
  if (!m) return [0, 0, 0];
  return [+m[1], +m[2], +m[3]];
}

function versionGte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

const current = parseVersion(process.version);
if (!versionGte(current, MIN_NODE)) {
  console.error(
    `[AlgoFlow] Node.js >= ${MIN_NODE.join(".")} required (for built-in SQLite). ` +
      `Current: ${process.version}`
  );
  process.exit(1);
}

try {
  require("node:sqlite");
} catch {
  console.error("[AlgoFlow] Built-in node:sqlite is not available in this Node build.");
  process.exit(1);
}

function hasCmd(cmd) {
  const r = spawnSync(cmd, ["--version"], {
    shell: true,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0;
}

const isWin = process.platform === "win32";
const gpp = hasCmd("g++");
const py = hasCmd(isWin ? "python" : "python3") || hasCmd("python3");

if (!gpp || !py) {
  console.warn("[AlgoFlow] Compiler hint:");
  if (!gpp) console.warn("  - g++ not found (C++ sandbox disabled until installed)");
  if (!py) console.warn("  - python not found (Python sandbox disabled until installed)");
  console.warn("  See algoflow-deploy/docs/COMPILERS.md");
}

console.log(`[AlgoFlow] Preflight OK (Node ${process.version})`);
