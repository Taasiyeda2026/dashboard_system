// ============================================================
// activity-drawer.js — Side drawer for activity detail + edit
// ============================================================

import { getSession } from "../api/api.js";
import { can, formatDate, formatTime, escapeHtml } from "../shared/utils.js";
import { showToast } from "../shared/toast.js";
import {
  getActivity, editActivityDirect, submitEditRequest,
  getMeetings, getPrivateNote, savePrivateNote,
} from "../api/api.js";

let drawerEl = null;

export function initDrawer() {
  if (document.getElementById("activity-drawer")) return;
  const el = document.createElement("div");
  el.id = "activity-drawer";
  el.innerHTML = `
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel" dir="rtl">
      <button class="drawer-close" aria-label="סגור">✕</button>
      <div class="drawer-body"></div>
    </div>`;
  document.body.appendChild(el);
  drawerEl = el;

  el.querySelector(".drawer-backdrop").addEventListener("click", closeDrawer);
  el.querySelector(".drawer-close").addEventListener("click", closeDrawer);
}

export function closeDrawer() {
  drawerEl?.classList.remove("drawer--open");
}

export async function openActivityDrawer(sheet, row_id) {
  if (!drawerEl) initDrawer();
  const body = drawerEl.querySelector(".drawer-body");
  body.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>טוען...</span></div>`;
  drawerEl.classList.add("drawer--open");

  try {
    const [actRes, noteRes] = await Promise.all([
      getActivity(sheet, row_id),
      shouldShowNote() ? getPrivateNote(sheet, row_id) : Promise.resolve({ note: "" }),
    ]);
    renderDrawer(body, sheet, actRes.activity, noteRes.note ?? "");
  } catch {
    body.innerHTML = `<div class="error-state">שגיאה בטעינת הפעילות</div>`;
  }
}

function shouldShowNote() {
  const u = getSession();
  return can(u, "can_review_requests") || can(u, "view_admin");
}

function renderDrawer(body, sheet, act, privateNote) {
  const user = getSession();
  const canEditDirect = can(user, "can_edit_direct");
  const canRequest    = can(user, "can_request_edit");
  const showNote      = shouldShowNote();
  const isLong        = sheet === "data_long";

  const fields = getFieldDefs(sheet);

  const rows = fields.map((f) => {
    const val = act[f.key] ?? "";
    return `
      <div class="drawer-field" data-key="${f.key}" data-sheet="${sheet}" data-row="${act.RowID}">
        <label>${f.label}</label>
        <div class="field-value">${escapeHtml(f.format ? f.format(val) : val) || "<span class='empty'>—</span>"}</div>
        ${(canEditDirect || canRequest) ? `<button class="btn-edit-field" title="ערוך שדה">✎</button>` : ""}
      </div>`;
  }).join("");

  const noteSection = showNote ? `
    <div class="drawer-section">
      <h4>הערה פנימית</h4>
      <textarea class="private-note-input" rows="3" placeholder="הערה פנימית...">${escapeHtml(privateNote)}</textarea>
      <button class="btn-save-note btn btn--sm btn--secondary">שמור הערה</button>
    </div>` : "";

  body.innerHTML = `
    <div class="drawer-header">
      <h2>${escapeHtml(act.activity_name || "פעילות")}</h2>
      <span class="badge badge--type">${escapeHtml(act.activity_type || "")}</span>
    </div>
    <div class="drawer-fields">${rows}</div>
    ${noteSection}`;

  // Edit field buttons
  body.querySelectorAll(".btn-edit-field").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fieldEl = btn.closest(".drawer-field");
      startFieldEdit(fieldEl, act, sheet, canEditDirect);
    });
  });

  // Save private note
  if (showNote) {
    body.querySelector(".btn-save-note")?.addEventListener("click", async () => {
      const text = body.querySelector(".private-note-input").value;
      await savePrivateNote(sheet, act.RowID, text);
      showToast("הערה נשמרה", "success");
    });
  }
}

function startFieldEdit(fieldEl, act, sheet, canEditDirect) {
  const key = fieldEl.dataset.key;
  const currentVal = act[key] ?? "";
  const valueDiv = fieldEl.querySelector(".field-value");
  const origHtml = valueDiv.innerHTML;

  valueDiv.innerHTML = `<input class="inline-edit-input" value="${escapeHtml(String(currentVal))}">`;
  const input = valueDiv.querySelector("input");
  input.focus();

  const save = async () => {
    const newVal = input.value;
    if (newVal === String(currentVal)) { valueDiv.innerHTML = origHtml; return; }
    try {
      if (canEditDirect) {
        await editActivityDirect(sheet, act.RowID, key, newVal);
        showToast("עודכן בהצלחה", "success");
        act[key] = newVal;
      } else {
        await submitEditRequest(sheet, act.RowID, key, currentVal, newVal);
        showToast("בקשת שינוי הוגשה", "info");
      }
      valueDiv.innerHTML = escapeHtml(newVal) || "<span class='empty'>—</span>";
    } catch {
      valueDiv.innerHTML = origHtml;
    }
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { valueDiv.innerHTML = origHtml; }
  });
}

function getFieldDefs(sheet) {
  const common = [
    { key: "activity_manager", label: "מנהל פעילות" },
    { key: "authority",        label: "רשות" },
    { key: "school",           label: "בית ספר" },
    { key: "activity_type",    label: "סוג פעילות" },
    { key: "activity_no",      label: "מספר תוכנית" },
    { key: "activity_name",    label: "שם פעילות" },
    { key: "sessions",         label: "מפגשים" },
    { key: "price",            label: "מחיר" },
    { key: "funding",          label: "מימון" },
    { key: "start_time",       label: "שעת התחלה", format: formatTime },
    { key: "end_time",         label: "שעת סיום",  format: formatTime },
    { key: "emp_id",           label: "מס׳ עובד" },
    { key: "instructor_name",  label: "מדריך" },
    { key: "status",           label: "סטטוס" },
    { key: "notes",            label: "הערות" },
    { key: "finance_status",   label: "סטטוס כספי" },
    { key: "finance_notes",    label: "הערות כספים" },
  ];
  if (sheet === "data_short") {
    return [
      ...common,
      { key: "emp_id_2",          label: "מס׳ עובד 2" },
      { key: "instructor_name_2", label: "מדריך 2" },
      { key: "start_date",        label: "תאריך", format: formatDate },
    ];
  }
  return [
    ...common,
    { key: "start_date", label: "תאריך התחלה", format: formatDate },
    { key: "end_date",   label: "תאריך סיום",  format: formatDate },
  ];
}
