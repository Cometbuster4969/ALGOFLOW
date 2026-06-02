const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const date = new Date().toISOString().slice(0, 10);
const zipPath = path.join(outDir, `algoflow-extension-${date}.zip`);

const excludes = [
  "node_modules/*",
  "tests/*",
  "dist/*",
  ".git/*",
  ".DS_Store",
  "*.log",
];

const args = ["-r", zipPath, ".", ...excludes.flatMap((pattern) => ["-x", pattern])];
const result = spawnSync("zip", args, { cwd: root, stdio: "inherit" });

if (result.status !== 0) {
  console.error("[AlgoFlow] Failed to create extension zip.");
  process.exit(result.status || 1);
}

console.log(`[AlgoFlow] Extension package created: ${zipPath}`);
