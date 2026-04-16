// ============================================================
// instructors.js — Instructors screen
// ============================================================

import { getInstructors } from "../api/api.js";
import { showLoading, showError, showEmpty, escapeHtml } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners } from "../shared/filters.js";

let currentFilters = {};

export async function render(container, user) {
  container.innerHTML = `<div id="instr-filters-wrap"></div><div id="instr-content"></div>`;
  await loadInstructors(container, user);
}

async function loadInstructors(container, user) {
  const content = container.querySelector("#instr-content");
  showLoading(content);

  try {
    const res = await getInstructors(false);
    const instructors = res.instructors ?? [];

    const filtersWrap = container.querySelector("#instr-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildFilters(filtersWrap, instructors, container, user);
    }

    renderTable(content, instructors);
  } catch {
    showError(content);
  }
}

function buildFilters(wrap, instructors, container, user) {
  const managerOpts   = [...new Set(instructors.map((i) => i.direct_manager).filter(Boolean))].sort()
    .map((v) => ({ value: v, label: v }));
  const empTypeOpts   = [...new Set(instructors.map((i) => i.employment_type).filter(Boolean))].sort()
    .map((v) => ({ value: v, label: v }));

  const fields = [
    { id: "active",           label: "פעיל",           type: "select", options: [{ value: "yes", label: "פעיל" }, { value: "no", label: "לא פעיל" }] },
    { id: "direct_manager",   label: "מנהל ישיר",      type: "select", options: managerOpts },
    { id: "employment_type",  label: "סוג העסקה",      type: "select", options: empTypeOpts },
    { id: "q",                label: "חיפוש שם / מייל", type: "text" },
  ];

  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (f) => { currentFilters = f; loadInstructors(container, user); });
}

function renderTable(el, instructors) {
  if (!instructors.length) { showEmpty(el); return; }

  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מס׳ עובד</th>
              <th>שם מלא</th>
              <th>נייד</th>
              <th>מייל</th>
              <th>סוג העסקה</th>
              <th>מנהל ישיר</th>
              <th>פעיל</th>
            </tr>
          </thead>
          <tbody>
            ${instructors.map((i) => instrRowHtml(i)).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function instrRowHtml(i) {
  return `
    <tr>
      <td>${escapeHtml(i.emp_id)}</td>
      <td>${escapeHtml(i.full_name)}</td>
      <td><a href="tel:${escapeHtml(i.mobile ?? "")}">${escapeHtml(i.mobile ?? "—")}</a></td>
      <td><a href="mailto:${escapeHtml(i.email ?? "")}">${escapeHtml(i.email ?? "—")}</a></td>
      <td>${escapeHtml(i.employment_type ?? "—")}</td>
      <td>${escapeHtml(i.direct_manager ?? "—")}</td>
      <td><span class="badge ${i.active === "yes" ? "badge--success" : "badge--neutral"}">${i.active === "yes" ? "כן" : "לא"}</span></td>
    </tr>`;
}
