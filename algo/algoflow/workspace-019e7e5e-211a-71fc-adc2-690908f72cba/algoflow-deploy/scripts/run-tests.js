/**
 * Run verification tests across AlgoFlow modules from the deploy root.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");

const suites = [
  { name: "SRS SM-2", cwd: path.join(root, "algoflow-srs"), cmd: "node", args: ["tests/sm2-verify.js"] },
  {
    name: "Extension security",
    cwd: path.join(root, "algoflow-extension"),
    cmd: "node",
    args: ["tests/05-background-security.js"],
  },
];

let failed = 0;

for (const suite of suites) {
  process.stdout.write(`\n▶ ${suite.name}\n`);
  const r = spawnSync(suite.cmd, suite.args, { cwd: suite.cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`✗ ${suite.name} failed`);
    failed++;
  } else {
    console.log(`✓ ${suite.name}`);
  }
}

const portFile = path.join(__dirname, "..", "data", "server-port.txt");
const healthPort = (() => {
  if (process.env.ALGOFLOW_PORT) return String(process.env.ALGOFLOW_PORT);
  try {
    return fs.readFileSync(portFile, "utf8").trim() || "3001";
  } catch {
    return "3001";
  }
})();

process.stdout.write(`\n▶ Unified server health (requires server running on :${healthPort})\n`);
const health = spawnSync(
  "curl",
  ["-sf", `http://127.0.0.1:${healthPort}/health`],
  { stdio: "pipe", shell: true }
);
if (health.status === 0) {
  console.log("✓ Health check OK");
} else {
  console.log(`○ Health check skipped (start with: npm start, expected :${healthPort})`);
}

process.exit(failed > 0 ? 1 : 0);
