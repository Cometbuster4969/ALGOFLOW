/* AlgoFlow dashboard — review, sandbox, templates, complexity profiler */

const API = window.location.origin;
let userId = localStorage.getItem("algoflow_user_id") || "1";
let monacoEditor = null;
let reviewProblems = [];
let activeReviewIndex = null;

const RATINGS = [
  { v: 1, label: "Lapse", emoji: "😵" },
  { v: 2, label: "Near lapse", emoji: "😟" },
  { v: 3, label: "Hard", emoji: "😐" },
  { v: 4, label: "Hesitate", emoji: "🙂" },
  { v: 5, label: "Perfect", emoji: "🎯" },
];

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.panel}`).classList.add("active");
    if (tab.dataset.panel === "templates") loadTemplates();
    if (tab.dataset.panel === "review") loadReview();
  });
});

// ─── Users ────────────────────────────────────────────────────────────────

async function loadUsers() {
  const data = await api("/api/users");
  const sel = document.getElementById("user-select");
  sel.innerHTML = data.users
    .map((u) => `<option value="${u.id}" ${String(u.id) === userId ? "selected" : ""}>${escapeHtml(u.name)}</option>`)
    .join("");
}

document.getElementById("user-select").addEventListener("change", (e) => {
  userId = e.target.value;
  localStorage.setItem("algoflow_user_id", userId);
  loadReview();
  loadProblems();
  loadTemplates();
});

document.getElementById("add-user-btn").addEventListener("click", async () => {
  const name = prompt("New profile name:");
  if (!name) return;
  const u = await api("/api/users", { method: "POST", body: JSON.stringify({ name }) });
  userId = String(u.id);
  localStorage.setItem("algoflow_user_id", userId);
  await loadUsers();
  loadReview();
});

// ─── Review ───────────────────────────────────────────────────────────────

async function loadReview() {
  try {
    const [stats, due, forecast] = await Promise.all([
      api("/api/review/stats"),
      api("/api/review/due?limit=50"),
      api("/api/review/forecast?days=7"),
    ]);

    reviewProblems = due.problems || [];
    activeReviewIndex = null;

    document.getElementById("review-stats").innerHTML = `
      <span class="stat-pill">Today <strong>${stats.reviewed}</strong> reviewed</span>
      <span class="stat-pill"><strong>${stats.correct}</strong> correct</span>
      <span class="stat-pill"><strong>${stats.incorrect}</strong> lapses</span>
      <span class="stat-pill">Due <strong>${due.count}</strong></span>
    `;

    const maxF = Math.max(1, ...(forecast.forecast || []).map((f) => f.count));
    document.getElementById("forecast-chart").innerHTML = (forecast.forecast || [])
      .map(
        (f) =>
          `<span title="${f.date}: ${f.count}" style="height:${Math.max(8, (f.count / maxF) * 56)}px"></span>`
      )
      .join("");

    renderReviewList();
    document.getElementById("review-focus").classList.add("hidden");
  } catch (e) {
    document.getElementById("review-list").innerHTML = `<p class="hint">Error: ${escapeHtml(e.message)}</p>`;
  }
}

function renderReviewList() {
  const el = document.getElementById("review-list");
  if (!reviewProblems.length) {
    el.innerHTML = `<p class="hint">No problems due. Import from the extension.</p>`;
    return;
  }
  el.innerHTML = reviewProblems
    .map(
      (p, i) => `
    <div class="problem-item" data-idx="${i}">
      <div>
        <strong>${escapeHtml(p.title)}</strong>
        <span class="priority">P${Math.round(p.priority)}</span>
        ${p.daysOverdue > 0 ? `<span style="color:#f87171;font-size:11px"> ${p.daysOverdue}d overdue</span>` : ""}
        <div style="margin-top:4px;font-size:11px;color:#8b8fa3">
          ${escapeHtml(p.platform)} · ${p.difficulty}
          ${(p.tags || []).slice(0, 3).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
        </div>
      </div>
    </div>`
    )
    .join("");

  el.querySelectorAll(".problem-item").forEach((item) => {
    item.addEventListener("click", () => openReviewFocus(parseInt(item.dataset.idx, 10)));
  });
}

function openReviewFocus(idx) {
  activeReviewIndex = idx;
  const p = reviewProblems[idx];
  document.getElementById("review-focus").classList.remove("hidden");
  document.getElementById("review-focus-hint").classList.add("hidden");
  document.querySelectorAll(".problem-item").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
  });

  document.getElementById("review-focus-body").innerHTML = `
    <h3 style="margin-bottom:8px">${escapeHtml(p.title)}</h3>
    <p class="hint">EF ${p.easeFactor.toFixed(2)} · interval ${p.intervalDays}d · reviews ${p.totalReviews}</p>
    ${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" style="color:#a5b4fc;font-size:12px">Open problem</a>` : ""}
  `;

  const row = document.getElementById("rating-row");
  row.innerHTML = RATINGS.map(
    (r) =>
      `<button class="rating-btn" data-r="${r.v}">${r.emoji}<br>${r.label}</button>`
  ).join("");

  row.querySelectorAll(".rating-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rating = parseInt(btn.dataset.r, 10);
      await api("/api/review", {
        method: "PUT",
        body: JSON.stringify({ problem_id: p.problemId, rating }),
      });
      reviewProblems.splice(idx, 1);
      loadReview();
    });
  });
}

document.getElementById("refresh-review").addEventListener("click", loadReview);

// ─── Sandbox + Monaco ───────────────────────────────────────────────────────

function initMonaco() {
  require.config({
    paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" },
  });
  require(["vs/editor/editor.main"], () => {
    monacoEditor = monaco.editor.create(document.getElementById("editor"), {
      value: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
  return 0;
}`,
      language: "cpp",
      theme: "vs-dark",
      fontSize: 13,
      minimap: { enabled: false },
      automaticLayout: true,
    });

    document.getElementById("lang").addEventListener("change", (e) => {
      const lang = e.target.value;
      monaco.editor.setModelLanguage(
        monacoEditor.getModel(),
        lang === "python" ? "python" : lang === "java" ? "java" : "cpp"
      );
    });
  });
}

document.getElementById("run-btn").addEventListener("click", async () => {
  const out = document.getElementById("run-output");
  out.textContent = "Running…";
  try {
    const test_cases = JSON.parse(document.getElementById("tests").value || "[]");
    const result = await api("/api/execute", {
      method: "POST",
      body: JSON.stringify({
        language: document.getElementById("lang").value,
        source_code: monacoEditor.getValue(),
        test_cases,
      }),
    });
    out.textContent = JSON.stringify(result, null, 2);
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});

document.getElementById("profile-btn").addEventListener("click", async () => {
  const out = document.getElementById("profiler-output");
  out.textContent = "Analyzing…";
  try {
    const test_cases = JSON.parse(document.getElementById("tests").value || "[]");
    const result = await api("/api/analyze/complexity", {
      method: "POST",
      body: JSON.stringify({
        language: document.getElementById("lang").value,
        source_code: monacoEditor.getValue(),
        test_cases: test_cases.length ? test_cases : undefined,
        benchmark_sizes: [10, 100, 500],
      }),
    });
    out.textContent = [
      `Estimated time: ${result.overall}`,
      `Space: ${result.space}`,
      `Confidence: ${result.confidence}`,
      "",
      ...(result.notes || []),
      "",
      JSON.stringify({ static: result.static, empirical: result.empirical }, null, 2),
    ].join("\n");
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});

// ─── Templates ────────────────────────────────────────────────────────────

async function loadTemplates() {
  const q = document.getElementById("template-search").value;
  const lang = document.getElementById("template-lang-filter").value;
  let path = `/api/templates?q=${encodeURIComponent(q)}`;
  if (lang) path += `&language=${lang}`;
  const data = await api(path);
  const el = document.getElementById("template-list");
  el.innerHTML = data.templates.length
    ? data.templates
        .map(
          (t) => `
      <div class="template-item">
        <div>
          <strong>${escapeHtml(t.name)}</strong>
          <span style="color:#8b8fa3;font-size:11px"> ${t.language}</span>
          ${(t.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div>
          <button class="btn small secondary insert-tpl" data-id="${t.id}">Insert</button>
          <button class="btn small secondary delete-tpl" data-id="${t.id}">Del</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="hint">No templates. Create one below.</p>`;

  el.querySelectorAll(".insert-tpl").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = data.templates.find((x) => x.id === parseInt(btn.dataset.id, 10));
      if (t && monacoEditor) {
        monacoEditor.setValue(t.body);
        document.querySelector('.tab[data-panel="sandbox"]').click();
        document.getElementById("lang").value = t.language;
        monaco.editor.setModelLanguage(
          monacoEditor.getModel(),
          t.language === "python" ? "python" : t.language === "java" ? "java" : "cpp"
        );
      }
    });
  });

  el.querySelectorAll(".delete-tpl").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete template?")) return;
      await api(`/api/templates/${btn.dataset.id}`, { method: "DELETE" });
      loadTemplates();
    });
  });
}

document.getElementById("template-search").addEventListener("input", loadTemplates);
document.getElementById("template-lang-filter").addEventListener("change", loadTemplates);

document.getElementById("save-template-btn").addEventListener("click", async () => {
  const name = document.getElementById("new-tpl-name").value.trim();
  if (!name) return alert("Name required");
  await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name,
      language: document.getElementById("new-tpl-lang").value,
      body: document.getElementById("new-tpl-body").value,
      tags: document.getElementById("new-tpl-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
    }),
  });
  document.getElementById("new-tpl-name").value = "";
  loadTemplates();
});

document.getElementById("save-editor-as-tpl").addEventListener("click", () => {
  document.getElementById("new-tpl-body").value = monacoEditor ? monacoEditor.getValue() : "";
  document.getElementById("new-tpl-lang").value = document.getElementById("lang").value;
  document.querySelector('.tab[data-panel="templates"]').click();
});

// ─── Problems ─────────────────────────────────────────────────────────────

async function loadProblems() {
  const data = await api("/api/problems/list?limit=100");
  document.getElementById("problem-list").innerHTML = data.problems?.length
    ? data.problems
        .map(
          (p) =>
            `<li style="padding:8px 0;border-bottom:1px solid #2a2d3a">${escapeHtml(p.title)} <span style="color:#8b8fa3">(${p.platform})</span></li>`
        )
        .join("")
    : `<li class="hint">None yet</li>`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────

(async function boot() {
  await loadUsers();
  loadReview();
  loadProblems();
  initMonaco();
})();
