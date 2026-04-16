// ============================================================
// exceptions.js — Exceptions screen (data_long only)
// ============================================================

import { getExceptions, getInstructors } from "../api/api.js";
import { showLoading, showError, showEmpty, formatDate, escapeHtml } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners } from "../shared/filters.js";
import { openActivityDrawer } from "../components/activity-drawer.js";

const LATE_CUTOFF = "2026-06-15";

let currentFilters = {};

export async function render(container, user) {
  container.innerHTML = buildShell();
  await loadExceptions(container, user);
}

function buildShell() {
  return `
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;" id="exc-summary"></div>
    <div id="exc-filters-wrap"></div>
    <div id="exc-content"></div>`;
}

async function loadExceptions(container, user) {
  const content = container.querySelector("#exc-content");
  showLoading(content);

  try {
    const [res, instrRes] = await Promise.all([
      getExceptions(currentFilters),
      getInstructors(),
    ]);

    const exceptions = res.exceptions ?? [];

    // Filters
    const filtersWrap = container.querySelector("#exc-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildFilters(filtersWrap, instrRes.instructors ?? [], container, user);
    }

    // Summary
    renderSummary(container.querySelector("#exc-summary"), exceptions);
    renderTable(content, exceptions);
  } catch {
    showError(content);
  }
}

function buildFilters(wrap, instructors, container, user) {
  const instrOpts = instructors.map((i) => ({ value: i.full_name, label: i.full_name }));
  const fields = [
    { id: "exception_type",   label: "סוג חריגה",    type: "select", options: [
      { value: "missing_instructor", label: "חסר מדריך" },
      { value: "missing_date",       label: "חסר תאריך התחלה" },
      { value: "late_end",           label: "תאריך סיום מאוחר" },
    ]},
    { id: "activity_manager", label: "מנהל פעילות",  type: "text" },
    { id: "instructor_name",  label: "מדריך",         type: "select", options: instrOpts },
    { id: "authority",        label: "רשות",           type: "text" },
  ];
  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (f) => { currentFilters = f; loadExceptions(container, user); });
}

function renderSummary(el, exceptions) {
  const counts = { missing_instructor: 0, missing_date: 0, late_end: 0 };
  exceptions.forEach((ex) => { counts[ex.exception_type] = (counts[ex.exception_type] ?? 0) + 1; });

  el.innerHTML = [
    { key: "missing_instructor", label: "חסר מדריך",          cls: "exception-badge--missing-instructor" },
    { key: "missing_date",       label: "חסר תאריך התחלה",    cls: "exception-badge--missing-date" },
    { key: "late_end",           label: "תאריך סיום מאוחר",   cls: "exception-badge--late-end" },
  ].map((t) => `
    <span class="exception-badge ${t.cls}">${t.label}: ${counts[t.key] ?? 0}</span>
  `).join("");
}

function renderTable(el, exceptions) {
  if (!exceptions.length) { showEmpty(el, "אין חריגות — מצוין! ✓"); return; }

  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מזהה</th>
              <th>שם פעילות</th>
              <th>חריגה</th>
              <th>מנהל</th>
              <th>רשות</th>
              <th>מדריך</th>
              <th>תאריך התחלה</th>
              <th>תאריך סיום</th>
            </tr>
          </thead>
          <tbody>
            ${exceptions.map((ex) => exRowHtml(ex)).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelectorAll("tbody tr").forEach((tr, i) => {
    tr.addEventListener("click", () => openActivityDrawer("data_long", exceptions[i].RowID));
  });
}

function exRowHtml(ex) {
  const badgeCls = {
    missing_instructor: "exception-badge--missing-instructor",
    missing_date:       "exception-badge--missing-date",
    late_end:           "exception-badge--late-end",
  }[ex.exception_type] ?? "";

  const badgeLabel = {
    missing_instructor: "חסר מדריך",
    missing_date:       "חסר תאריך התחלה",
    late_end:           "תאריך סיום מאוחר",
  }[ex.exception_type] ?? ex.exception_type;

  return `
    <tr>
      <td>${escapeHtml(ex.RowID)}</td>
      <td>${escapeHtml(ex.activity_name)}</td>
      <td><span class="exception-badge ${badgeCls}">${badgeLabel}</span></td>
      <td>${escapeHtml(ex.activity_manager ?? "—")}</td>
      <td>${escapeHtml(ex.authority ?? "—")}</td>
      <td>${escapeHtml(ex.instructor_name ?? "—")}</td>
      <td>${formatDate(ex.start_date)}</td>
      <td>${formatDate(ex.end_date)}</td>
    </tr>`;
}
