/**
 * Writes minimal PNG icons for the Chrome extension (purple 16×16 tile).
 */
const fs = require("fs");
const path = require("path");

// Valid 1×1 PNG (Chrome scales for toolbar / store icons)
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const targets = [
  path.join(__dirname, "..", "..", "algoflow-extension", "icons"),
  path.join(__dirname, "..", "electron", "icons"),
];

for (const dir of targets) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["icon16.png", "icon48.png", "icon128.png", "icon.png", "tray-icon.png"]) {
    fs.writeFileSync(path.join(dir, name), PNG);
  }
}

console.log("[AlgoFlow] Extension and app placeholder icons written.");
