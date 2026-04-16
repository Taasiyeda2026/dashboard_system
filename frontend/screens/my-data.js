// ============================================================
// my-data.js — Personal screen for instructors
// ============================================================

import { getMyData } from "../api/api.js";
import { showLoading, showError, showEmpty, formatDate, formatTime, escapeHtml, activityTypeLabel } from "../shared/utils.js";
import { openActivityDrawer } from "../components/activity-drawer.js";

export async function render(container, user) {
  showLoading(container);

  try {
    const res = await getMyData();
    const activities = res.activities ?? [];

    if (!activities.length) {
      showEmpty(container, "אין פעילויות משויכות לך");
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <h2 style="font-size:1.1rem; font-weight:700; color:var(--panel-text);">שלום, ${escapeHtml(user.full_name ?? "")}</h2>
        <p style="font-size:.85rem; color:var(--panel-text-mute); margin-top:4px;">הפעילויות המשויכות אליך</p>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם פעילות</th>
                <th>סוג</th>
                <th>רשות</th>
                <th>בית ספר</th>
                <th>תאריך</th>
                <th>שעות</th>
                <th>מפגשים</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              ${activities.map((a) => myRowHtml(a)).join("")}
            </tbody>
          </table>
        </div>
      </div>`;

    container.querySelectorAll("tbody tr").forEach((tr, i) => {
      tr.addEventListener("click", () => {
        const a = activities[i];
        const sheet = a.RowID.startsWith("LONG-") ? "data_long" : "data_short";
        openActivityDrawer(sheet, a.RowID);
      });
    });
  } catch {
    showError(container);
  }
}

function myRowHtml(a) {
  return `
    <tr>
      <td>${escapeHtml(a.activity_name)}</td>
      <td>${activityTypeLabel(a.activity_type)}</td>
      <td>${escapeHtml(a.authority ?? "—")}</td>
      <td>${escapeHtml(a.school ?? "—")}</td>
      <td>${formatDate(a.start_date)}</td>
      <td>${formatTime(a.start_time)}–${formatTime(a.end_time)}</td>
      <td>${escapeHtml(String(a.sessions ?? "—"))}</td>
      <td><span class="badge ${a.status === "active" ? "badge--success" : "badge--neutral"}">${escapeHtml(a.status ?? "—")}</span></td>
    </tr>`;
}
