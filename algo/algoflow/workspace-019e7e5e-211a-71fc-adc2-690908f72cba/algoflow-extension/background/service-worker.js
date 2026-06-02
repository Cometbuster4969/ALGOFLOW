/**
 * ============================================================================
 * AlgoFlow — Background Service Worker (MV3)
 * ============================================================================
 *
 * Responsibilities:
 *   1. Listen for PROBLEM_SCRAPED messages from content scripts
 *   2. Update the extension badge with the cached problem count
 *   3. Handle extension install / update lifecycle
 *   4. Provide a message bridge between popup and content scripts
 * ============================================================================
 */

// ─── Install / Update ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Set default settings
    chrome.storage.local.set({
      algoflow_settings: {
        autoScrape: true,
        theme: "dark",
        backendUrl: "http://127.0.0.1:3001",
        syncToBackend: true,
        apiKey: "",
      },
      algoflow_cache_index: [],
    });

    console.log("[AlgoFlow] Extension installed. Welcome!");
  }

  if (details.reason === "update") {
    console.log("[AlgoFlow] Extension updated to v" + chrome.runtime.getManifest().version);
  }

  updateBadge();
});

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "PROBLEM_SCRAPED":
      handleProblemScraped(message.data, sender.tab);
      sendResponse({ received: true });
      break;

    case "GET_CACHE_COUNT":
      getCacheCount().then((count) => sendResponse({ count }));
      return true; // async

    case "CLEAR_CACHE":
      clearCache().then(() => sendResponse({ cleared: true }));
      return true;

    case "SYNC_TO_BACKEND":
      syncProblemsToBackend(message.problems || [])
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "PING_BACKEND":
      pingBackend()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    default:
      break;
  }
});

// ─── Handle scraped problem notification ─────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.local.get("algoflow_settings");
  return {
    backendUrl: "http://127.0.0.1:3001",
    syncToBackend: true,
    apiKey: "",
    ...(result.algoflow_settings || {}),
  };
}

function apiHeaders(settings) {
  const headers = { "Content-Type": "application/json", "x-user-id": "1" };
  if (settings.apiKey) headers["x-api-key"] = settings.apiKey;
  return headers;
}

async function pingBackend() {
  const settings = await getSettings();
  const base = (settings.backendUrl || "http://127.0.0.1:3001").replace(/\/$/, "");
  const res = await fetch(`${base}/health`, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.port && data.port !== parseInt(new URL(base).port || "3001", 10)) {
    const url = new URL(base);
    url.port = String(data.port);
    const updated = { ...settings, backendUrl: url.origin };
    await chrome.storage.local.set({ algoflow_settings: updated });
  }
  return { ok: true, ...data };
}

async function syncProblemsToBackend(problems) {
  const settings = await getSettings();
  if (!settings.syncToBackend) {
    return { ok: false, skipped: true, reason: "sync disabled" };
  }

  const base = (settings.backendUrl || "http://127.0.0.1:3001").replace(/\/$/, "");
  const payload = problems.map((p) => ({
    platform: p.platform,
    title: p.title,
    difficulty: p.difficulty,
    tags: p.tags || [],
    url: p.url,
    testCases: p.testCases || [],
    external_id: p.external_id || null,
    slug: p.slug || null,
  }));

  const res = await fetch(`${base}/api/problems/import`, {
    method: "POST",
    headers: apiHeaders(settings),
    body: JSON.stringify({ problems: payload }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend ${res.status}: ${text}`);
  }

  return { ok: true, ...(await res.json()) };
}

async function handleProblemScraped(problemData, tab) {
  // Update badge
  await updateBadge();

  try {
    const result = await syncProblemsToBackend([problemData]);
    if (!result.ok && !result.skipped) {
      console.warn("[AlgoFlow] Backend sync failed:", result.error || "unknown");
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      chrome.action.setBadgeText({ text: "!" });
    }
  } catch (err) {
    console.warn("[AlgoFlow] Backend sync failed:", err.message);
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.action.setBadgeText({ text: "!" });
  }

  // Show a brief badge flash
  if (tab?.id) {
    try {
      chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId: tab.id });

      setTimeout(() => {
        chrome.action.setBadgeText({ text: "", tabId: tab.id });
        updateBadge();
      }, 2000);
    } catch {
      // Tab may have been closed
    }
  }

  console.log(
    `[AlgoFlow] Problem scraped: "${problemData.title}" ` +
    `(${problemData.platform}, ${problemData.testCases?.length || 0} TCs)`
  );
}

// ─── Badge management ────────────────────────────────────────────────────────

async function updateBadge() {
  try {
    const count = await getCacheCount();
    const text = count > 0 ? String(count) : "";

    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  } catch {
    // Storage may not be ready yet
  }
}

async function getCacheCount() {
  const result = await chrome.storage.local.get("algoflow_cache_index");
  return (result.algoflow_cache_index || []).length;
}

async function clearCache() {
  const result = await chrome.storage.local.get("algoflow_cache_index");
  const index = result.algoflow_cache_index || [];
  const keys = index.map((i) => i.key);

  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
  await chrome.storage.local.set({ algoflow_cache_index: [] });
  await updateBadge();
}

// ─── Periodic badge sync (every 30s) ─────────────────────────────────────────

chrome.alarms.create("badge-sync", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "badge-sync") {
    updateBadge();
  }
});
