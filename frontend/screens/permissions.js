// ============================================================
// permissions.js — Permissions management screen
// ============================================================

import { getPermissions, savePermission } from "../api/api.js";
import { showLoading, showError, showEmpty, escapeHtml, can } from "../shared/utils.js";
import { showToast } from "../shared/toast.js";

export async function render(container, user) {
  if (!can(user, "view_admin") && !can(user, "view_permissions")) {
    container.innerHTML = `<div class="error-state">אין הרשאה לצפות במסך זה</div>`;
    return;
  }

  showLoading(container);

  try {
    const res = await getPermissions();
    const users = res.users ?? [];
    renderTable(container, users, user);
  } catch {
    showError(container);
  }
}

function renderTable(container, users, currentUser) {
  if (!users.length) { showEmpty(container); return; }

  const BOOL_FIELDS = [
    "view_admin","view_dashboard","view_activities","view_week","view_month",
    "view_instructors","view_exceptions","view_my_data","view_contacts",
    "view_finance","view_permissions","can_request_edit","can_edit_direct",
    "can_add_activity","can_review_requests","active",
  ];

  const LABEL_MAP = {
    view_admin:           "ניהול",
    view_dashboard:       "דשבורד",
    view_activities:      "פעילויות",
    view_week:            "שבוע",
    view_month:           "חודש",
    view_instructors:     "מדריכים",
    view_exceptions:      "חריגות",
    view_my_data:         "המסך שלי",
    view_contacts:        "אנשי קשר",
    view_finance:         "כספים",
    view_permissions:     "הרשאות",
    can_request_edit:     "בקשות שינוי",
    can_edit_direct:      "עריכה ישירה",
    can_add_activity:     "הוספת פעילות",
    can_review_requests:  "אישור בקשות",
    active:               "פעיל",
  };

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>ניהול משתמשים והרשאות</h3>
        <button class="btn btn--primary btn--sm" id="btn-add-user">+ הוסף משתמש</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מזהה</th>
              <th>שם מלא</th>
              <th>תפקיד</th>
              <th>קוד כניסה</th>
              ${BOOL_FIELDS.map((f) => `<th style="font-size:.7rem;">${LABEL_MAP[f]}</th>`).join("")}
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => userRowHtml(u, BOOL_FIELDS)).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  container.querySelector("#btn-add-user").addEventListener("click", () => openUserModal(null, container, currentUser));

  container.querySelectorAll(".btn-edit-user").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.uid;
      const u = users.find((u) => u.user_id === uid);
      openUserModal(u, container, currentUser);
    });
  });
}

function userRowHtml(u, fields) {
  const checkboxes = fields.map((f) => {
    const val = u[f] === true || u[f] === "TRUE" || u[f] === 1;
    return `<td style="text-align:center;">${val ? "✓" : ""}</td>`;
  }).join("");

  return `
    <tr>
      <td>${escapeHtml(u.user_id)}</td>
      <td>${escapeHtml(u.full_name)}</td>
      <td>${escapeHtml(u.display_role ?? "—")}</td>
      <td style="letter-spacing:.1em;">${escapeHtml(u.entry_code ?? "—")}</td>
      ${checkboxes}
      <td><button class="btn btn--sm btn--secondary btn-edit-user" data-uid="${escapeHtml(u.user_id)}">ערוך</button></td>
    </tr>`;
}

function openUserModal(user, container, currentUser) {
  const isNew = !user;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const PERM_FIELDS = [
    ["view_dashboard","דשבורד"],["view_activities","פעילויות"],["view_week","שבוע"],
    ["view_month","חודש"],["view_instructors","מדריכים"],["view_exceptions","חריגות"],
    ["view_my_data","המסך שלי"],["view_contacts","אנשי קשר"],["view_finance","כספים"],
    ["view_permissions","הרשאות"],["view_admin","ניהול מערכת"],
    ["can_request_edit","הגשת בקשות שינוי"],["can_edit_direct","עריכה ישירה"],
    ["can_add_activity","הוספת פעילות"],["can_review_requests","אישור בקשות"],["active","פעיל"],
  ];

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:560px;">
      <h3>${isNew ? "הוסף משתמש" : "ערוך משתמש"}</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
        <div class="form-row"><label>מזהה משתמש</label><input id="pm-uid" value="${escapeHtml(user?.user_id ?? "")}" ${!isNew ? "readonly" : ""}></div>
        <div class="form-row"><label>קוד כניסה</label><input id="pm-code" value="${escapeHtml(user?.entry_code ?? "")}"></div>
        <div class="form-row"><label>שם מלא</label><input id="pm-name" value="${escapeHtml(user?.full_name ?? "")}"></div>
        <div class="form-row"><label>תפקיד תצוגה</label><input id="pm-role" value="${escapeHtml(user?.display_role ?? "")}"></div>
        <div class="form-row"><label>מסך ברירת מחדל</label><input id="pm-default" value="${escapeHtml(user?.default_view ?? "dashboard")}"></div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:20px;">
        ${PERM_FIELDS.map(([key, label]) => {
          const checked = user?.[key] === true || user?.[key] === "TRUE";
          return `<label style="display:flex; align-items:center; gap:6px; font-size:.82rem; cursor:pointer;">
            <input type="checkbox" data-perm="${key}" ${checked ? "checked" : ""}> ${label}
          </label>`;
        }).join("")}
      </div>
      <div class="form-actions">
        <button class="btn btn--secondary" id="pm-cancel">ביטול</button>
        <button class="btn btn--primary" id="pm-save">שמור</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector("#pm-cancel").addEventListener("click", () => overlay.remove());

  overlay.querySelector("#pm-save").addEventListener("click", async () => {
    const data = {
      user_id:      overlay.querySelector("#pm-uid").value,
      entry_code:   overlay.querySelector("#pm-code").value,
      full_name:    overlay.querySelector("#pm-name").value,
      display_role: overlay.querySelector("#pm-role").value,
      default_view: overlay.querySelector("#pm-default").value,
    };
    overlay.querySelectorAll("[data-perm]").forEach((cb) => {
      data[cb.dataset.perm] = cb.checked;
    });

    try {
      await savePermission(data);
      showToast("המשתמש נשמר בהצלחה", "success");
      overlay.remove();
      render(container, currentUser);
    } catch {
      showToast("שגיאה בשמירת המשתמש", "error");
    }
  });
}
