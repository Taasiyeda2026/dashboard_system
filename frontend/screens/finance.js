// ============================================================
// finance.js — Finance screen
// ============================================================

import { getFinanceData, getLists } from "../api/api.js";
import { showLoading, showError, showEmpty, formatDate, escapeHtml } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners } from "../shared/filters.js";
import { openActivityDrawer } from "../components/activity-drawer.js";
import { ACTIVITY_TYPES } from "../config/config.js";

let currentFilters = {};

export async function render(container, user) {
  container.innerHTML = buildShell();
  await loadFinance(container, user);
}

function buildShell() {
  return `
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;" id="fin-summary"></div>
    <div id="fin-filters-wrap"></div>
    <div id="fin-content"></div>`;
}

async function loadFinance(container, user) {
  const content = container.querySelector("#fin-content");
  showLoading(content);

  try {
    const [res, listsRes] = await Promise.all([
      getFinanceData(currentFilters),
      getLists(),
    ]);

    const data = res.data ?? [];
    const lists = listsRes.lists ?? [];

    const filtersWrap = container.querySelector("#fin-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildFilters(filtersWrap, lists, container, user);
    }

    renderSummary(container.querySelector("#fin-summary"), data);
    renderTable(content, data);
  } catch {
    showError(content);
  }
}

function buildFilters(wrap, lists, container, user) {
  const authorityOpts = unique(lists, "authority").map((v) => ({ value: v, label: v }));
  const managerOpts   = unique(lists, "activity_manager").map((v) => ({ value: v, label: v }));
  const typeOpts      = ACTIVITY_TYPES.filter((t) => t.value !== "all");

  const fields = [
    { id: "finance_status",   label: "סטטוס כספי",    type: "select", options: [
      { value: "open",   label: "פתוח" },
      { value: "closed", label: "סגור" },
    ]},
    { id: "authority",        label: "רשות",            type: "select", options: authorityOpts },
    { id: "activity_manager", label: "מנהל פעילות",    type: "select", options: managerOpts },
    { id: "activity_type",    label: "סוג פעילות",     type: "select", options: typeOpts },
  ];

  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (f) => { currentFilters = f; loadFinance(container, user); });
}

function renderSummary(el, data) {
  const open   = data.filter((d) => d.finance_status !== "closed");
  const closed = data.filter((d) => d.finance_status === "closed");

  const totalOpen   = open.reduce((s, d)   => s + (parseFloat(d.price) || 0), 0);
  const totalClosed = closed.reduce((s, d) => s + (parseFloat(d.price) || 0), 0);

  el.innerHTML = `
    <div class="stat-tile">
      <div class="stat-tile__value" style="color:var(--color-warning);">${open.length}</div>
      <div class="stat-tile__label">פתוחים</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__value" style="color:var(--color-success);">${closed.length}</div>
      <div class="stat-tile__label">סגורים</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__value" style="font-size:1.3rem;">${totalOpen.toLocaleString("he-IL")} ₪</div>
      <div class="stat-tile__label">סכום פתוח</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__value" style="font-size:1.3rem;">${totalClosed.toLocaleString("he-IL")} ₪</div>
      <div class="stat-tile__label">סכום סגור</div>
    </div>`;
}

function renderTable(el, data) {
  if (!data.length) { showEmpty(el); return; }

  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מזהה</th>
              <th>שם פעילות</th>
              <th>רשות</th>
              <th>בית ספר</th>
              <th>מחיר</th>
              <th>מימון</th>
              <th>סטטוס כספי</th>
              <th>הערות כספים</th>
              <th>תאריך</th>
            </tr>
          </thead>
          <tbody>
            ${data.map((d) => finRowHtml(d)).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelectorAll("tbody tr").forEach((tr, i) => {
    tr.addEventListener("click", () => {
      const sheet = data[i].RowID.startsWith("LONG-") ? "data_long" : "data_short";
      openActivityDrawer(sheet, data[i].RowID);
    });
  });
}

function finRowHtml(d) {
  const isClosed = d.finance_status === "closed";
  return `
    <tr>
      <td>${escapeHtml(d.RowID)}</td>
      <td>${escapeHtml(d.activity_name)}</td>
      <td>${escapeHtml(d.authority ?? "—")}</td>
      <td>${escapeHtml(d.school ?? "—")}</td>
      <td>${d.price ? Number(d.price).toLocaleString("he-IL") + " ₪" : "—"}</td>
      <td>${escapeHtml(d.funding ?? "—")}</td>
      <td><span class="badge ${isClosed ? "badge--success" : "badge--warning"}">${isClosed ? "סגור" : "פתוח"}</span></td>
      <td>${escapeHtml(d.finance_notes ?? "—")}</td>
      <td>${formatDate(d.start_date)}</td>
    </tr>`;
}

function unique(lists, field) {
  return [...new Set(lists.map((l) => l[field]).filter(Boolean))].sort();
}
