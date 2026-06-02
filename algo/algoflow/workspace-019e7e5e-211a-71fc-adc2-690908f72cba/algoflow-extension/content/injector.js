/**
 * ============================================================================
 * AlgoFlow — Content Script Injector
 * ============================================================================
 *
 * Responsibilities:
 *   1. Detect URL changes (SPA navigation on LeetCode / CF)
 *   2. Inject the "Export to AlgoFlow" button into the native UI
 *   3. Trigger scraping via Parsers, cache to chrome.storage.local
 *   4. Show toast notifications for success / failure
 *   5. Handle the popup's request for current-page data
 *
 * Runs at document_idle, after parsers.js has loaded.
 * ============================================================================
 */

// Guard against double-injection (MV3 can re-inject on SPA nav)
if (typeof window.__AlgoFlowInjector === "undefined") {
  window.__AlgoFlowInjector = true;

  // ─── ScrapeManager ─────────────────────────────────────────────────────

  const ScrapeManager = {
    _currentUrl: null,
    _exportBtn: null,
    _toastEl: null,
    _debounceTimer: null,
    _CACHE_PREFIX: "algoflow_problem_",
    _MAX_CACHE_ENTRIES: 200,

    // ── Initialise ─────────────────────────────────────────────────────

    init() {
      // First injection
      this._currentUrl = location.href;
      this._onPageReady();

      // Watch for SPA navigation (LeetCode uses client-side routing)
      this._observeUrlChanges();
    },

    // ── URL change detection ───────────────────────────────────────────

    _observeUrlChanges() {
      const self = this;

      // Strategy 1: MutationObserver on <title> (both platforms change it)
      const titleEl = document.querySelector("title");
      if (titleEl) {
        this._titleObserver = new MutationObserver(() => {
          this._checkUrlChange();
        });
        this._titleObserver.observe(titleEl, { childList: true, subtree: true });
      }

      // Strategy 2: Listen for popstate (back/forward)
      this._popstateHandler = () => self._checkUrlChange();
      window.addEventListener("popstate", this._popstateHandler);

      // Strategy 3: Periodic polling (250ms) — single source of truth
      // Removed pushState/replaceState override (W-09) — it mutates a shared
      // global and can break the host page's SPA router.  The polling fallback
      // catches those cases reliably at 250 ms resolution.
      this._pollInterval = setInterval(() => self._checkUrlChange(), 250);

      // W-04: Clean up on page unload to prevent resource leaks
      this._beforeUnloadHandler = () => self.destroy();
      window.addEventListener("beforeunload", this._beforeUnloadHandler);
    },

    /**
     * Tear down all observers, listeners, and timers.
     * Called on beforeunload to prevent per-tab resource leaks.
     */
    destroy() {
      if (this._titleObserver) {
        this._titleObserver.disconnect();
        this._titleObserver = null;
      }
      if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
      }
      if (this._popstateHandler) {
        window.removeEventListener("popstate", this._popstateHandler);
        this._popstateHandler = null;
      }
      if (this._beforeUnloadHandler) {
        window.removeEventListener("beforeunload", this._beforeUnloadHandler);
        this._beforeUnloadHandler = null;
      }
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
    },

    _checkUrlChange() {
      const newUrl = location.href;
      if (newUrl !== this._currentUrl) {
        this._currentUrl = newUrl;
        // Debounce: LeetCode loads content async after navigation
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._onPageReady(), 800);
      }
    },

    // ── Page-ready handler ─────────────────────────────────────────────

    _onPageReady() {
      const Parsers = window.__AlgoFlowParsers;
      if (!Parsers) return;

      const platform = Parsers.detectPlatform();
      if (!platform) {
        this._removeButton();
        return;
      }

      // Wait for content to render (LeetCode lazy-loads)
      this._waitForContent(platform, () => {
        this._injectButton(platform);
        this._autoCacheIfEnabled();
      });
    },

    /**
     * Wait for key DOM elements to appear before injecting.
     */
    _waitForContent(platform, callback, attempts = 0) {
      if (attempts > 20) return; // give up after 10s

      let ready = false;

      if (platform === "leetcode") {
        ready = !!(
          document.querySelector('[data-cy="question-title"]') ||
          document.querySelector('[data-track-load="description_content"]') ||
          document.querySelector('.elfjS') ||
          document.querySelector('div.text-title-large')
        );
      } else if (platform === "codeforces") {
        ready = !!document.querySelector('.problem-statement .title');
      }

      if (ready) {
        callback();
      } else {
        setTimeout(() => this._waitForContent(platform, callback, attempts + 1), 500);
      }
    },

    // ── Button injection ───────────────────────────────────────────────

    _injectButton(platform) {
      // Don't double-inject
      if (document.getElementById("algoflow-export-btn")) return;

      const btn = document.createElement("button");
      btn.id = "algoflow-export-btn";
      btn.className = "algoflow-btn";

      // Build DOM nodes manually — never use innerHTML with user-adjacent data
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path1.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", "7 10 12 15 17 10");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "12"); line.setAttribute("y1", "15");
      line.setAttribute("x2", "12"); line.setAttribute("y2", "3");
      svg.append(path1, polyline, line);

      const label = document.createElement("span");
      label.textContent = "Export to AlgoFlow";

      btn.append(svg, label);
      btn.title = "Scrape this problem and save to AlgoFlow";
      btn.addEventListener("click", () => this._handleExport());

      // Find insertion point
      const anchor = this._getInsertionPoint(platform);
      if (anchor) {
        anchor.appendChild(btn);
        this._exportBtn = btn;
      }
    },

    /**
     * Find the best place to insert the button on each platform.
     */
    _getInsertionPoint(platform) {
      if (platform === "leetcode") {
        // Top-right action bar (near "Submit" button)
        const selectors = [
          '[data-cy="question-detail"] .flex.items-center.gap-2',   // Tailwind layout
          '.flex.items-center.gap-2',                                // generic
          '#ide-top-btns',                                           // older layout
          '.question-buttons',                                       // legacy
          '[class*="action-bar"]',                                   // broad fallback
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el;
        }

        // Fallback: create our own container at top of description
        const desc = document.querySelector('[data-track-load="description_content"]') ||
                     document.querySelector('.elfjS');
        if (desc && desc.parentElement) {
          const wrapper = document.createElement("div");
          wrapper.className = "algoflow-anchor";
          desc.parentElement.insertBefore(wrapper, desc);
          return wrapper;
        }
      }

      if (platform === "codeforces") {
        // After the problem title
        const header = document.querySelector('.problem-statement .header .title');
        if (header && header.parentElement) {
          return header.parentElement;
        }
      }

      return document.body; // absolute last resort
    },

    _removeButton() {
      const existing = document.getElementById("algoflow-export-btn");
      if (existing) existing.remove();
    },

    // ── Export handler ─────────────────────────────────────────────────

    async _handleExport() {
      const Parsers = window.__AlgoFlowParsers;
      if (!Parsers) return;

      const btn = this._exportBtn;
      if (btn) {
        btn.disabled = true;
        btn.classList.add("algoflow-btn--loading");
      }

      try {
        const data = Parsers.scrape();

        if (!data) {
          this._showToast("Could not detect problem on this page.", "error");
          return;
        }

        if (!data.testCases || data.testCases.length === 0) {
          this._showToast(
            `Scraped "${data.title}" but found no test cases. Saved anyway.`,
            "warning"
          );
        }

        // Cache to chrome.storage.local
        await this._cacheProblem(data);

        // Notify the background service worker (for badge update)
        try {
          chrome.runtime.sendMessage({
            type: "PROBLEM_SCRAPED",
            data,
          });
        } catch {
          // Service worker may be inactive — that's fine
        }

        this._showToast(
          `✓ "${data.title}" exported (${data.testCases.length} test cases)`,
          "success"
        );
      } catch (err) {
        console.error("[AlgoFlow] Export error:", err);
        this._showToast(`Export failed: ${err.message}`, "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("algoflow-btn--loading");
        }
      }
    },

    // ── Storage helpers ────────────────────────────────────────────────

    /**
     * Cache a scraped problem to chrome.storage.local.
     * Uses a key derived from platform + title for dedup.
     */
    async _cacheProblem(problemData) {
      const key =
        this._CACHE_PREFIX +
        btoa(problemData.platform + ":" + problemData.title)
          .replace(/[+/=]/g, "")
          .slice(0, 40);

      const entry = {
        ...problemData,
        cachedKey: key,
        cachedAt: new Date().toISOString(),
      };

      // Read existing cache index
      const result = await chrome.storage.local.get("algoflow_cache_index");
      let index = result.algoflow_cache_index || [];

      // Update or add
      const existingIdx = index.findIndex((i) => i.key === key);
      if (existingIdx >= 0) {
        index[existingIdx] = { key, title: problemData.title, platform: problemData.platform };
      } else {
        index.unshift({ key, title: problemData.title, platform: problemData.platform });
      }

      // Trim to max entries
      if (index.length > this._MAX_CACHE_ENTRIES) {
        const removed = index.splice(this._MAX_CACHE_ENTRIES);
        const removeKeys = removed.map((i) => i.key);
        await chrome.storage.local.remove(removeKeys);
      }

      // Write problem + updated index
      await chrome.storage.local.set({
        [key]: entry,
        algoflow_cache_index: index,
      });
    },

    /**
     * Auto-cache on page load (no button click needed).
     */
    async _autoCacheIfEnabled() {
      try {
        const settings = await chrome.storage.local.get("algoflow_settings");
        if (settings.algoflow_settings?.autoScrape !== false) {
          const Parsers = window.__AlgoFlowParsers;
          const data = Parsers?.scrape();
          if (data && data.title) {
            await this._cacheProblem(data);
          }
        }
      } catch {
        // storage may not be available in dev mode
      }
    },

    // ── Toast notifications ────────────────────────────────────────────

    _showToast(message, type = "info") {
      // Remove existing toast
      if (this._toastEl) this._toastEl.remove();

      const toast = document.createElement("div");
      toast.className = `algoflow-toast algoflow-toast--${type}`;
      toast.textContent = message;

      document.body.appendChild(toast);
      this._toastEl = toast;

      // Animate in
      requestAnimationFrame(() => toast.classList.add("algoflow-toast--visible"));

      // Auto-dismiss
      setTimeout(() => {
        toast.classList.remove("algoflow-toast--visible");
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    },
  };

  // ─── Message listener (popup requests data) ────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "SCRAPE_CURRENT_PAGE") {
      const Parsers = window.__AlgoFlowParsers;
      const data = Parsers ? Parsers.scrape() : null;
      sendResponse({ success: !!data, data });
      return true; // async response channel
    }

    if (msg.type === "PING") {
      sendResponse({ alive: true, platform: window.__AlgoFlowParsers?.detectPlatform() });
      return true;
    }
  });

  // ─── Boot ──────────────────────────────────────────────────────────────

  ScrapeManager.init();
}
