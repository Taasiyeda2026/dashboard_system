// ============================================================
// dashboard.js — Main dashboard screen
// ============================================================

import { getDashboardStats } from "../api/api.js";
import { showLoading, showError, escapeHtml } from "../shared/utils.js";

export async function render(container, user) {
  showLoading(container, "טוען דשבורד...");

  let stats;
  try {
    const res = await getDashboardStats();
    stats = res.stats;
  } catch {
    showError(container);
    return;
  }

  container.innerHTML = `
    <div class="stat-grid" id="stat-tiles"></div>
    <div class="card" id="manager-stats-card">
      <div class="card-header"><h3>סיכום לפי מנהל פעילות</h3></div>
      <div class="card-body" id="manager-stats-body"></div>
    </div>`;

  renderGlobalStats(document.getElementById("stat-tiles"), stats);
  renderManagerStats(document.getElementById("manager-stats-body"), stats.by_manager ?? []);
}

function renderGlobalStats(el, stats) {
  const tiles = [
    { label: "פעילויות קצרות",          value: stats.total_short ?? "—" },
    { label: "פעילויות ארוכות",          value: stats.total_long  ?? "—" },
    { label: "מדריכים",                  value: stats.total_instructors ?? "—" },
    { label: "סיומי קורסים החודש",       value: stats.course_endings_this_month ?? "—" },
  ];

  el.innerHTML = tiles.map((t) => `
    <div class="stat-tile">
      <div class="stat-tile__value">${t.value}</div>
      <div class="stat-tile__label">${t.label}</div>
    </div>`).join("");
}

function renderManagerStats(el, managers) {
  if (!managers.length) {
    el.innerHTML = `<div class="empty-state">אין נתונים</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>מנהל פעילות</th>
            <th>פעילויות קצרות</th>
            <th>פעילויות ארוכות</th>
            <th>סה"כ</th>
          </tr>
        </thead>
        <tbody>
          ${managers.map((m) => `
            <tr>
              <td>${escapeHtml(m.name)}</td>
              <td>${m.short ?? 0}</td>
              <td>${m.long ?? 0}</td>
              <td><strong>${(m.short ?? 0) + (m.long ?? 0)}</strong></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}
