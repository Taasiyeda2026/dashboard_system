// ============================================================
// activities.js — Activities screen
// ============================================================

import { getActivities, getLists, getInstructors } from "../api/api.js";
import { getSession } from "../api/api.js";
import { can, showLoading, showError, showEmpty, activityTypeLabel, formatDate, escapeHtml } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners, readFilters } from "../shared/filters.js";
import { openActivityDrawer } from "../components/activity-drawer.js";
import { navigateTo } from "../app.js";
import { ACTIVITY_TYPES } from "../config/config.js";
import { showToast } from "../shared/toast.js";

let currentView = "table"; // "table" | "card"
let currentFilters = {};
let currentTab = "all";

export async function render(container, user) {
  container.innerHTML = buildShell(user);
  attachShellEvents(container, user);
  await loadAndRender(container, user);
}

// ── Shell HTML ────────────────────────────────────────────────
function buildShell(user) {
  const canAdd = can(user, "can_add_activity");

  const tabs = ACTIVITY_TYPES.map((t) => `
    <button class="tab-btn ${t.value === "all" ? "active" : ""}" data-tab="${t.value}">${t.label}</button>
  `).join("");

  return `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
      <div class="tabs" id="act-tabs">${tabs}</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <div class="view-toggle">
          <button class="view-toggle-btn active" data-view="table" title="טבלה">☰</button>
          <button class="view-toggle-btn" data-view="card" title="כרטיסיות">⊞</button>
        </div>
        ${canAdd ? `<button class="btn btn--primary btn--sm" id="btn-add-activity">+ הוסף פעילות</button>` : ""}
      </div>
    </div>
    <div id="act-filters-wrap"></div>
    <div id="act-content"></div>`;
}

// ── Events ───────────────────────────────────────────────────
function attachShellEvents(container, user) {
  // Tabs
  container.querySelector("#act-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    container.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    currentFilters.activity_type = currentTab === "all" ? "" : currentTab;
    loadAndRender(container, user);
  });

  // View toggle
  container.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".view-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;
      renderContent(container, user, window._lastActivities ?? []);
    });
  });

  // Add activity
  container.querySelector("#btn-add-activity")?.addEventListener("click", () => {
    openAddModal(user);
  });
}

// ── Load data ────────────────────────────────────────────────
async function loadAndRender(container, user) {
  const content = container.querySelector("#act-content");
  showLoading(content);

  try {
    const [res, listsRes, instrRes] = await Promise.all([
      getActivities(currentFilters),
      getLists(),
      getInstructors(),
    ]);

    const activities = res.activities ?? [];
    window._lastActivities = activities;

    // Build filters (first time or on reload)
    const filtersWrap = container.querySelector("#act-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildAndAttachFilters(filtersWrap, listsRes.lists ?? [], instrRes.instructors ?? [], user, container);
    }

    renderContent(container, user, activities);
  } catch {
    showError(content);
  }
}

function buildAndAttachFilters(wrap, lists, instructors, user, container) {
  const authorityOpts = unique(lists, "authority").map((v) => ({ value: v, label: v }));
  const schoolOpts    = unique(lists, "school").map((v) => ({ value: v, label: v }));
  const instrOpts     = instructors.map((i) => ({ value: i.full_name, label: i.full_name }));
  const managerOpts   = unique(lists, "activity_manager").map((v) => ({ value: v, label: v }));

  const fields = [
    { id: "authority",        label: "רשות",           type: "select", options: authorityOpts },
    { id: "school",           label: "בית ספר",        type: "select", options: schoolOpts },
    { id: "instructor_name",  label: "מדריך",          type: "select", options: instrOpts },
    { id: "activity_manager", label: "מנהל פעילות",    type: "select", options: managerOpts },
    { id: "status",           label: "סטטוס",          type: "select", options: [
      { value: "active", label: "פעיל" }, { value: "inactive", label: "לא פעיל" },
    ]},
  ];

  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (filters) => {
    currentFilters = { ...filters, activity_type: currentTab === "all" ? "" : currentTab };
    loadAndRender(container, getSession());
  });
}

// ── Render content ────────────────────────────────────────────
function renderContent(container, user, activities) {
  const content = container.querySelector("#act-content");
  if (!activities.length) { showEmpty(content); return; }

  if (currentView === "table") {
    renderTable(content, user, activities);
  } else {
    renderCards(content, user, activities);
  }
}

function renderTable(el, user, activities) {
  const showNotes = can(user, "can_review_requests");
  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מזהה</th>
              <th>שם פעילות</th>
              <th>סוג</th>
              <th>מנהל</th>
              <th>רשות</th>
              <th>בית ספר</th>
              <th>מדריך</th>
              <th>תאריך</th>
              <th>סטטוס</th>
              <th>כספים</th>
            </tr>
          </thead>
          <tbody>
            ${activities.map((a) => rowHtml(a)).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelectorAll("tbody tr").forEach((tr, i) => {
    tr.addEventListener("click", () => {
      const a = activities[i];
      const sheet = a.RowID.startsWith("LONG-") ? "data_long" : "data_short";
      openActivityDrawer(sheet, a.RowID);
    });
  });
}

function rowHtml(a) {
  return `
    <tr>
      <td>${escapeHtml(a.RowID)}</td>
      <td>${escapeHtml(a.activity_name)}</td>
      <td>${activityTypeLabel(a.activity_type)}</td>
      <td>${escapeHtml(a.activity_manager)}</td>
      <td>${escapeHtml(a.authority)}</td>
      <td>${escapeHtml(a.school)}</td>
      <td>${escapeHtml(a.instructor_name)}</td>
      <td>${formatDate(a.start_date)}</td>
      <td><span class="badge ${a.status === "active" || a.active === "yes" ? "badge--success" : "badge--neutral"}">${escapeHtml(a.status ?? "—")}</span></td>
      <td><span class="badge ${a.finance_status === "closed" ? "badge--success" : "badge--warning"}">${a.finance_status === "closed" ? "סגור" : "פתוח"}</span></td>
    </tr>`;
}

function renderCards(el, user, activities) {
  el.innerHTML = `<div class="activity-cards">${activities.map((a) => cardHtml(a)).join("")}</div>`;
  el.querySelectorAll(".activity-card").forEach((card, i) => {
    card.addEventListener("click", () => {
      const a = activities[i];
      const sheet = a.RowID.startsWith("LONG-") ? "data_long" : "data_short";
      openActivityDrawer(sheet, a.RowID);
    });
  });
}

function cardHtml(a) {
  return `
    <div class="activity-card">
      <div class="activity-card__name">${escapeHtml(a.activity_name)}</div>
      <div class="activity-card__meta">
        <span>${activityTypeLabel(a.activity_type)}</span>
        <span>•</span>
        <span>${escapeHtml(a.authority ?? "")}</span>
        <span>•</span>
        <span>${escapeHtml(a.instructor_name ?? "—")}</span>
        <span>•</span>
        <span>${formatDate(a.start_date)}</span>
      </div>
    </div>`;
}

// ── Add activity modal ────────────────────────────────────────
function openAddModal(user) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>הוסף פעילות</h3>
      <div class="form-row">
        <label>סוג פעילות</label>
        <select id="add-type">
          ${ACTIVITY_TYPES.filter((t) => t.value !== "all").map((t) =>
            `<option value="${t.value}">${t.label}</option>`).join("")}
        </select>
      </div>
      <div id="add-type-hint" style="font-size:.8rem;color:var(--panel-text-mute);margin-bottom:12px;"></div>
      <div class="form-row"><label>שם פעילות</label><input id="add-name" type="text" placeholder="שם פעילות"></div>
      <div class="form-row"><label>מנהל פעילות</label><input id="add-manager" type="text"></div>
      <div class="form-row"><label>רשות</label><input id="add-authority" type="text"></div>
      <div class="form-row"><label>בית ספר</label><input id="add-school" type="text"></div>
      <div class="form-actions">
        <button class="btn btn--secondary" id="add-cancel">ביטול</button>
        <button class="btn btn--primary" id="add-save">הוסף</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const hint = overlay.querySelector("#add-type-hint");
  overlay.querySelector("#add-type").addEventListener("change", (e) => {
    const isLong = ["course", "after_school"].includes(e.target.value);
    hint.textContent = isLong ? "פעילות ארוכה — תישמר ב-data_long" : "פעילות קצרה — תישמר ב-data_short";
  });
  hint.textContent = "פעילות ארוכה — תישמר ב-data_long";

  overlay.querySelector("#add-cancel").addEventListener("click", () => overlay.remove());

  overlay.querySelector("#add-save").addEventListener("click", async () => {
    const { addActivity } = await import("../api/api.js");
    const type = overlay.querySelector("#add-type").value;
    const sheet = ["course", "after_school"].includes(type) ? "data_long" : "data_short";
    const data = {
      activity_type:    type,
      activity_name:    overlay.querySelector("#add-name").value,
      activity_manager: overlay.querySelector("#add-manager").value,
      authority:        overlay.querySelector("#add-authority").value,
      school:           overlay.querySelector("#add-school").value,
    };
    try {
      await addActivity(sheet, data);
      showToast("הפעילות נוספה בהצלחה", "success");
      overlay.remove();
      render(document.getElementById("screen-content"), user);
    } catch {
      showToast("שגיאה בהוספת הפעילות", "error");
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────
function unique(lists, field) {
  const vals = [...new Set(lists.map((l) => l[field]).filter(Boolean))];
  return vals.sort();
}
