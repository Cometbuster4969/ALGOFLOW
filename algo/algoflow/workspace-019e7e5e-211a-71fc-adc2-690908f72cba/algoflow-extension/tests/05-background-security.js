/**
 * ============================================================================
 * CHECKLIST ITEM 3 — Background Script Cross-Origin API Sync Safety
 * ============================================================================
 *
 * Verifies that:
 *   1. Messages from content scripts are validated (sender.tab present)
 *   2. Unknown message types are ignored
 *   3. Message data is sanitised before storage (no prototype pollution)
 *   4. Storage keys are bounded (no injection via crafted keys)
 *   5. The service worker doesn't expose privileged APIs to content scripts
 *   6. chrome.alarms minimum period is respected
 *   7. Badge updates don't leak data across tabs
 *
 * Run: node tests/05-background-security.js
 * ============================================================================
 */

const fs = require("fs");

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function assert(c, m) { if (!c) throw new Error(m || "fail"); }

const swSrc = fs.readFileSync(__dirname + "/../content/injector.js", "utf8");
const bgSrc = fs.readFileSync(__dirname + "/../background/service-worker.js", "utf8");
const parsersSrc = fs.readFileSync(__dirname + "/../content/parsers.js", "utf8");

// ═══════════════════════════════════════════════════════════════════════════
// 1. Message Sender Validation
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 1. Message Sender Validation ━━━");

test("Background validates sender.tab before processing PROBLEM_SCRAPED", () => {
  // The handler should use sender.tab for badge updates
  assert(
    bgSrc.includes("sender.tab") || bgSrc.includes("sender?.tab"),
    "Background must reference sender.tab to verify origin"
  );
});

test("Background only handles known message types", () => {
  // Verify there's a whitelist of message types
  assert(bgSrc.includes("PROBLEM_SCRAPED"), "Should handle PROBLEM_SCRAPED");
  assert(bgSrc.includes("GET_CACHE_COUNT"), "Should handle GET_CACHE_COUNT");
  assert(bgSrc.includes("CLEAR_CACHE"), "Should handle CLEAR_CACHE");

  // Verify default case exists (ignores unknown types)
  assert(bgSrc.includes("default:"), "Switch should have a default case for unknown types");
});

test("Content script sends message with explicit type field", () => {
  // The injector should always include a type field
  assert(
    swSrc.includes('type: "PROBLEM_SCRAPED"') || swSrc.includes("type: 'PROBLEM_SCRAPED'"),
    "Content script should send typed messages"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Storage Key Sanitisation
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 2. Storage Key Sanitisation ━━━");

test("Cache keys are derived from safe encoding (not raw user input)", () => {
  // The injector uses btoa() to encode platform+title into a key
  assert(
    swSrc.includes("btoa(") || swSrc.includes("btoa ("),
    "Should use btoa() to encode keys"
  );
  assert(
    swSrc.replace(/\s/g, "").includes(".replace(/[+/=]/g,\"\")"),
    "Should strip btoa special chars (+, /, =)"
  );
});

test("Cache keys have a length limit", () => {
  // Keys should be bounded to prevent storage abuse
  assert(
    swSrc.includes(".slice(0,") || swSrc.includes(".substring(0,"),
    "Keys should be truncated to a max length"
  );
});

test("Cache key prefix is hardcoded (not from user input)", () => {
  assert(
    swSrc.includes('"algoflow_problem_"'),
    "Cache prefix should be a hardcoded constant"
  );
});

test("No __proto__ / constructor / prototype pollution in storage writes", () => {
  // The data object spread from parsers should not allow __proto__ injection
  // Verify we use structured spread, not Object.assign with user data
  const lines = swSrc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("__proto__") || line.includes("constructor")) {
      // These should not appear in the context of storage operations
      if (line.includes("storage") || line.includes("set(")) {
        throw new Error(`Line ${i + 1}: Potential prototype pollution: ${line.trim()}`);
      }
    }
  }
  // Pass — no issues found
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. No Privileged API Leakage
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 3. No Privileged API Leakage ━━━");

test("Content script doesn't use chrome.tabs.query directly", () => {
  // Only the popup and background should access tabs API
  // Content scripts should only use runtime.sendMessage
  if (swSrc.includes("chrome.tabs.query")) {
    throw new Error("Content script should not call chrome.tabs.query — this is a popup-only API");
  }
});

test("Content script only uses runtime.sendMessage (not runtime.connect)", () => {
  // Long-lived ports can be hijacked; one-shot messages are safer
  assert(
    swSrc.includes("chrome.runtime.sendMessage"),
    "Should use sendMessage for one-shot communication"
  );
  if (swSrc.includes("chrome.runtime.connect")) {
    console.log("    ⚠ Warning: runtime.connect creates persistent ports — audit needed");
  }
});

test("Content script message handler returns true for async responses", () => {
  // In MV3, returning true from onMessage keeps the channel open for async sendResponse
  // Use a broader regex to capture the full listener block
  const listenerMatch = swSrc.match(/chrome\.runtime\.onMessage\.addListener[\s\S]*?\n  \}\);/);
  if (listenerMatch) {
    assert(
      listenerMatch[0].includes("return true"),
      "Message handler should return true for async sendResponse"
    );
  } else {
    // Fallback: just check the source has return true near sendResponse
    assert(
      swSrc.includes("return true"),
      "Message handler should return true for async sendResponse"
    );
  }
});

test("Background script doesn't expose storage contents via messages", () => {
  // GET_CACHE_COUNT should return count, not the data itself
  assert(
    bgSrc.includes("count") && bgSrc.includes("getCacheCount"),
    "Should return count, not raw data"
  );
  // Ensure no message type returns full storage
  assert(
    !bgSrc.includes("GET_ALL_DATA") && !bgSrc.includes("EXPORT_STORAGE"),
    "Should not have a message type that dumps all storage"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Host Permission Scoping
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 4. Host Permission Scoping ━━━");

test("Manifest host_permissions are narrowly scoped", () => {
  const manifest = JSON.parse(fs.readFileSync(__dirname + "/../manifest.json", "utf8"));
  const hosts = manifest.host_permissions || [];

  for (const host of hosts) {
    // Must be https only
    assert(host.startsWith("https://"), `Host must use HTTPS: ${host}`);
    // Must not be a wildcard domain
    assert(!host.includes("*://*"), `Overly broad host permission: ${host}`);
    // Must target specific domains
    assert(
      host.includes("leetcode.com") ||
      host.includes("leetcode.cn") ||
      host.includes("codeforces.com"),
      `Unexpected host permission: ${host}`
    );
  }
});

test("Manifest doesn't request '<all_urls>' permission", () => {
  const manifest = JSON.parse(fs.readFileSync(__dirname + "/../manifest.json", "utf8"));
  const perms = (manifest.permissions || []).concat(manifest.host_permissions || []);
  assert(!perms.includes("<all_urls>"), "Must not request <all_urls>");
});

test("Manifest doesn't request unnecessary dangerous permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(__dirname + "/../manifest.json", "utf8"));
  const dangerous = ["webRequest", "webRequestBlocking", "cookies", "history",
                     "downloads", "management", "nativeMessaging", "debugger"];
  const perms = manifest.permissions || [];
  for (const p of dangerous) {
    assert(!perms.includes(p), `Unnecessary dangerous permission: ${p}`);
  }
});

test("Content scripts match only problem page URLs", () => {
  const manifest = JSON.parse(fs.readFileSync(__dirname + "/../manifest.json", "utf8"));
  const cs = manifest.content_scripts || [];

  for (const entry of cs) {
    for (const match of entry.matches) {
      // Must not match all URLs
      assert(!match.includes("<all_urls>"), `Overly broad content script match: ${match}`);
      // Must be HTTPS
      assert(match.startsWith("https://"), `Content script must use HTTPS: ${match}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Alarm / Timer Safety
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 5. Alarm Safety ━━━");

test("Badge sync alarm respects minimum period (≥0.5 min)", () => {
  // Chrome enforces a minimum of 30 seconds for alarms in MV3
  const match = bgSrc.match(/periodInMinutes:\s*([\d.]+)/);
  if (match) {
    const period = parseFloat(match[1]);
    assert(period >= 0.5, `Alarm period too short: ${period} min (min 0.5)`);
    console.log(`    ℹ Alarm period: ${period} min`);
  }
});

test("No setInterval in background (MV3 service workers can die)", () => {
  // MV3 service workers are terminated when idle;
  // setInterval is unreliable. Alarms should be used instead.
  assert(!bgSrc.includes("setInterval"), "Background must use chrome.alarms, not setInterval");
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Data Validation Before Storage
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 6. Data Validation Before Storage ━━━");

test("Content script validates scraped data has required fields", () => {
  // The _handleExport should check for data presence
  assert(
    swSrc.includes("if (!data)") || swSrc.includes("if(!data)"),
    "Should check data is not null before caching"
  );
});

test("Cache index entry has all required fields", () => {
  // Each index entry should have key, title, platform
  assert(
    swSrc.includes("key, title:") || swSrc.includes("key: key"),
    "Index entry should include key"
  );
  assert(
    swSrc.includes("platform:") || swSrc.includes("platform,"),
    "Index entry should include platform"
  );
});

test("Storage size is bounded (MAX_CACHE_ENTRIES)", () => {
  assert(
    swSrc.includes("MAX_CACHE_ENTRIES") || swSrc.includes("max_cache"),
    "Should have a max cache size limit"
  );
  // Verify it's a reasonable number
  const match = swSrc.match(/MAX_CACHE_ENTRIES[:\s=]*(\d+)/);
  if (match) {
    const max = parseInt(match[1], 10);
    assert(max <= 500, `MAX_CACHE_ENTRIES too large: ${max}`);
    console.log(`    ℹ MAX_CACHE_ENTRIES: ${max}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Error Handling
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n━━━ 7. Error Handling ━━━");

test("Content script message sending has try/catch", () => {
  // If the service worker is inactive, sendMessage throws
  assert(
    swSrc.includes("try") && swSrc.includes("sendMessage"),
    "sendMessage should be wrapped in try/catch"
  );
});

test("Background message handler doesn't throw on malformed data", () => {
  // The switch/case should handle unknown types gracefully
  assert(
    bgSrc.includes("default:") && bgSrc.includes("break"),
    "Switch should have default:break for unknown types"
  );
});

test("Badge update failures are caught", () => {
  assert(
    bgSrc.includes("catch") && bgSrc.includes("updateBadge") ||
    bgSrc.includes("try") && bgSrc.includes("setBadgeText"),
    "Badge operations should handle errors"
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n━━━ Summary ━━━");
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`  ${passed} passed, ${failed} failed out of ${results.length}\n`);

if (failed > 0) {
  console.log("  FAILED:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`    ✗ ${r.name}: ${r.error}`));
  console.log();
  process.exit(1);
}
