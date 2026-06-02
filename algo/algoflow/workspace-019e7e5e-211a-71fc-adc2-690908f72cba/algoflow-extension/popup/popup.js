/**
 * ============================================================================
 * AlgoFlow — Popup Dashboard Controller
 * ============================================================================
 *
 * Manages the popup UI: displays cached problems, handles search/filter,
 * shows problem detail modal, and exports data.
 * ============================================================================
 */

(() => {
  "use strict";

  // ─── DOM references ────────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    problemCount:  $("#problem-count"),
    currentIcon:   $("#current-icon"),
    currentLabel:  $("#current-label"),
    currentDetail: $("#current-detail"),
    scrapeBtn:     $("#scrape-btn"),
    searchInput:   $("#search-input"),
    chipRow:       $(".af-chip-row"),
    problemList:   $("#problem-list"),
    emptyState:    $("#empty-state"),
    exportAllBtn:  $("#export-all-btn"),
    clearAllBtn:   $("#clear-all-btn"),
    modalOverlay:  $("#modal-overlay"),
    modalTitle:    $("#modal-title"),
    modalBody:     $("#modal-body"),
    modalClose:    $("#modal-close"),
    modalCopyBtn:  $("#modal-copy-btn"),
    modalSendBtn:  $("#modal-send-btn"),
  };

  // ─── State ─────────────────────────────────────────────────────────────

  let allProblems = [];
  let activeFilter = "all";
  let searchQuery = "";
  let selectedProblem = null;

  // ─── Initialise ────────────────────────────────────────────────────────

  async function init() {
    await loadCachedProblems();
    await checkBackendStatus();
    detectCurrentPage();
    bindEvents();
    renderList();
  }

  async function checkBackendStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: "PING_BACKEND" });
      if (status?.ok) {
        dom.problemCount.title = `AlgoFlow backend online (port ${status.port || 3001})`;
      } else {
        dom.problemCount.title = "AlgoFlow backend offline — run: cd algoflow-deploy && npm start";
      }
    } catch {
      dom.problemCount.title = "AlgoFlow backend offline — run: cd algoflow-deploy && npm start";
    }
  }

  // ─── Load from chrome.storage.local ────────────────────────────────────

  async function loadCachedProblems() {
    try {
      const result = await chrome.storage.local.get("algoflow_cache_index");
      const index = result.algoflow_cache_index || [];

      if (index.length === 0) {
        allProblems = [];
        return;
      }

      // Bulk-fetch all problem entries
      const keys = index.map((i) => i.key);
      const data = await chrome.storage.local.get(keys);

      allProblems = index
        .map((i) => data[i.key])
        .filter(Boolean)
        .sort((a, b) => new Date(b.cachedAt) - new Date(a.cachedAt));
    } catch (err) {
      console.error("[AlgoFlow Popup] Failed to load cache:", err);
      allProblems = [];
    }

    updateCount();
  }

  function updateCount() {
    dom.problemCount.textContent = `${allProblems.length} saved`;
  }

  // ─── Detect current tab ────────────────────────────────────────────────

  async function detectCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        setNoPage();
        return;
      }

      const url = tab.url;
      let platform = null;

      if (/leetcode\.(com|cn)\/problems\//.test(url))  platform = "leetcode";
      if (/codeforces\.com\/(contest|problemset|gym)\/\d+\/problem\//.test(url)) platform = "codeforces";

      if (!platform) {
        setNoPage();
        return;
      }

      // Update icon
      dom.currentIcon.classList.add(
        platform === "leetcode" ? "af-current__icon--lc" : "af-current__icon--cf"
      );

      // Try to ping the content script
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
        if (response?.alive) {
          dom.currentLabel.textContent =
            platform === "leetcode" ? "LeetCode problem detected" : "Codeforces problem detected";
          dom.currentDetail.textContent = "Content script active";
          dom.currentIcon.classList.add("af-current__icon--ok");
          dom.scrapeBtn.disabled = false;
        }
      } catch {
        // Content script not loaded yet
        dom.currentLabel.textContent =
          platform === "leetcode" ? "LeetCode page detected" : "Codeforces page detected";
        dom.currentDetail.textContent = "Refresh page if button doesn't appear";
      }

      // Scrape button handler
      dom.scrapeBtn.addEventListener("click", async () => {
        dom.scrapeBtn.disabled = true;
        dom.scrapeBtn.textContent = "Scraping…";

        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CURRENT_PAGE" });
          if (resp?.success && resp.data) {
            dom.currentLabel.textContent = `✓ ${resp.data.title}`;
            dom.currentDetail.textContent = `${resp.data.testCases.length} test cases captured`;
            dom.currentIcon.classList.add("af-current__icon--ok");

            // Refresh list
            await loadCachedProblems();
            renderList();
          } else {
            dom.currentLabel.textContent = "Scrape failed — try refreshing the page";
          }
        } catch (err) {
          dom.currentLabel.textContent = "Error: " + err.message;
        } finally {
          dom.scrapeBtn.disabled = false;
          dom.scrapeBtn.textContent = "Scrape";
        }
      });
    } catch {
      setNoPage();
    }
  }

  function setNoPage() {
    dom.currentLabel.textContent = "No supported page detected";
    dom.currentDetail.textContent = "Open a LeetCode or Codeforces problem";
    dom.scrapeBtn.disabled = true;
  }

  // ─── Render problem list ───────────────────────────────────────────────

  function renderList() {
    // Filter
    const filtered = allProblems.filter((p) => {
      if (activeFilter === "leetcode" && p.platform !== "leetcode") return false;
      if (activeFilter === "codeforces" && p.platform !== "codeforces") return false;
      if (["Easy", "Med", "Hard"].includes(activeFilter) && p.difficulty !== activeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.platform.toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });

    // Clear list (except empty state)
    const cards = dom.problemList.querySelectorAll(".af-card");
    cards.forEach((c) => c.remove());

    if (filtered.length === 0) {
      dom.emptyState.style.display = "flex";
      return;
    }

    dom.emptyState.style.display = "none";

    for (const p of filtered) {
      const card = document.createElement("div");
      card.className = "af-card";
      card.dataset.key = p.cachedKey;

      const diffClass = p.difficulty === "Easy" ? "easy" : p.difficulty === "Hard" ? "hard" : "med";
      const platformClass = p.platform === "leetcode" ? "leetcode" : "codeforces";
      const tcCount = p.testCases ? p.testCases.length : 0;

      card.innerHTML = `
        <div class="af-card__platform af-card__platform--${platformClass}"></div>
        <div class="af-card__body">
          <div class="af-card__title">${escapeHtml(p.title)}</div>
          <div class="af-card__meta">
            <span class="af-card__diff af-card__diff--${diffClass}">${p.difficulty}</span>
            <span>${p.platform === "leetcode" ? "LeetCode" : "Codeforces"}</span>
            <span class="af-card__tc-count">${tcCount} TC${tcCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <div class="af-card__actions">
          <button class="af-btn af-btn--ghost af-btn--sm card-delete-btn" title="Delete">✕</button>
        </div>
      `;

      // Click to open detail modal
      card.addEventListener("click", (e) => {
        if (e.target.closest(".card-delete-btn")) return;
        openModal(p);
      });

      // Delete button
      card.querySelector(".card-delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteProblem(p.cachedKey);
        card.remove();
        updateCount();
        if (dom.problemList.querySelectorAll(".af-card").length === 0) {
          dom.emptyState.style.display = "flex";
        }
      });

      dom.problemList.appendChild(card);
    }
  }

  // ─── Modal ─────────────────────────────────────────────────────────────

  function openModal(problem) {
    selectedProblem = problem;
    dom.modalTitle.textContent = problem.title;

    let html = `
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <span class="af-card__diff af-card__diff--${problem.difficulty === "Easy" ? "easy" : problem.difficulty === "Hard" ? "hard" : "med"}">${problem.difficulty}</span>
        <span style="color:var(--af-text-muted)">${problem.platform} · ${new Date(problem.scrapedAt).toLocaleDateString()}</span>
      </div>
    `;

    if (problem.tags && problem.tags.length > 0) {
      html += `<div style="margin-bottom:12px;color:var(--af-text-muted);font-size:11px;">
        Tags: ${problem.tags.map((t) => `<code style="background:var(--af-bg);padding:1px 5px;border-radius:3px;font-size:10px;">${escapeHtml(t)}</code>`).join(" ")}
      </div>`;
    }

    if (problem.testCases && problem.testCases.length > 0) {
      problem.testCases.forEach((tc, i) => {
        html += `
          <div class="af-tc-label">Test Case ${i + 1}</div>
          <div style="margin-bottom:2px;font-size:10px;color:var(--af-text-muted);">INPUT</div>
          <pre>${escapeHtml(tc.in)}</pre>
          <div style="margin-bottom:2px;font-size:10px;color:var(--af-text-muted);">OUTPUT</div>
          <pre>${escapeHtml(tc.out)}</pre>
        `;
      });
    } else {
      html += `<p style="color:var(--af-text-muted)">No test cases captured for this problem.</p>`;
    }

    dom.modalBody.innerHTML = html;
    dom.modalOverlay.classList.add("af-modal-overlay--visible");
  }

  function closeModal() {
    dom.modalOverlay.classList.remove("af-modal-overlay--visible");
    selectedProblem = null;
  }

  // ─── Storage operations ────────────────────────────────────────────────

  async function deleteProblem(key) {
    await chrome.storage.local.remove(key);

    const result = await chrome.storage.local.get("algoflow_cache_index");
    let index = result.algoflow_cache_index || [];
    index = index.filter((i) => i.key !== key);
    await chrome.storage.local.set({ algoflow_cache_index: index });

    allProblems = allProblems.filter((p) => p.cachedKey !== key);
  }

  async function clearAll() {
    if (!confirm("Delete all cached problems? This cannot be undone.")) return;

    const keys = allProblems.map((p) => p.cachedKey);
    if (keys.length > 0) {
      await chrome.storage.local.remove(keys);
    }
    await chrome.storage.local.set({ algoflow_cache_index: [] });

    allProblems = [];
    updateCount();
    renderList();
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(allProblems, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `algoflow-problems-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Event bindings ────────────────────────────────────────────────────

  function bindEvents() {
    // Search
    dom.searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      renderList();
    });

    // Filter chips
    dom.chipRow.addEventListener("click", (e) => {
      const chip = e.target.closest(".af-chip");
      if (!chip) return;

      $$(".af-chip").forEach((c) => c.classList.remove("af-chip--active"));
      chip.classList.add("af-chip--active");
      activeFilter = chip.dataset.filter;
      renderList();
    });

    // Modal
    dom.modalClose.addEventListener("click", closeModal);
    dom.modalOverlay.addEventListener("click", (e) => {
      if (e.target === dom.modalOverlay) closeModal();
    });

    // Copy test cases
    dom.modalCopyBtn.addEventListener("click", () => {
      if (!selectedProblem) return;
      const text = selectedProblem.testCases
        .map((tc, i) => `--- Test Case ${i + 1} ---\nInput:\n${tc.in}\nOutput:\n${tc.out}`)
        .join("\n\n");
      navigator.clipboard.writeText(text).then(() => {
        dom.modalCopyBtn.textContent = "Copied!";
        setTimeout(() => (dom.modalCopyBtn.textContent = "Copy Test Cases"), 1500);
      });
    });

    // Send to AlgoFlow backend (review queue + sandbox test cases)
    dom.modalSendBtn.addEventListener("click", async () => {
      if (!selectedProblem) return;
      dom.modalSendBtn.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({
          type: "SYNC_TO_BACKEND",
          problems: [selectedProblem],
        });
        if (result?.ok) {
          dom.modalSendBtn.textContent = "Synced!";
        } else {
          dom.modalSendBtn.textContent = result?.skipped ? "Sync off" : "Failed";
        }
        setTimeout(() => {
          dom.modalSendBtn.textContent = "Sync to AlgoFlow";
          dom.modalSendBtn.disabled = false;
        }, 1500);
      } catch (err) {
        console.error("Sync failed:", err);
        dom.modalSendBtn.textContent = "Offline?";
        dom.modalSendBtn.disabled = false;
      }
    });

    // Footer actions
    dom.exportAllBtn.addEventListener("click", exportAll);
    dom.clearAllBtn.addEventListener("click", clearAll);

    // Keyboard
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"]/g, function(c) {
      var entities = {};
      entities[String.fromCharCode(38)] = String.fromCharCode(38,97,109,112,59);
      entities[String.fromCharCode(60)] = String.fromCharCode(60);
      entities[String.fromCharCode(62)] = String.fromCharCode(62);
      entities[String.fromCharCode(34)] = String.fromCharCode(34);
      return entities[c] || c;
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────

  init();
})();
