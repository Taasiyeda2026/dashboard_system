// ============================================================
// utils.js — Shared utility helpers
// ============================================================

// ── Date helpers ─────────────────────────────────────────────
export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatTime(timeStr) {
  if (!timeStr) return "—";
  return timeStr.slice(0, 5); // "HH:MM"
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function getWeekRange(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const sun = new Date(now);
  sun.setDate(now.getDate() - day + offsetWeeks * 7);
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  return {
    from: sun.toISOString().slice(0, 10),
    to:   sat.toISOString().slice(0, 10),
  };
}

export function getMonthRange(year, month) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(year, month, 0).getDate();
  const to   = `${year}-${String(month).padStart(2, "0")}-${last}`;
  return { from, to };
}

// ── String helpers ───────────────────────────────────────────
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function isEmpty(val) {
  return val === null || val === undefined || val === "";
}

// ── Permission helper ────────────────────────────────────────
export function can(user, perm) {
  return user?.[perm] === true || user?.[perm] === "TRUE" || user?.[perm] === 1;
}

// ── Debounce ─────────────────────────────────────────────────
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ── Loading spinner ──────────────────────────────────────────
export function showLoading(container, message = "טוען...") {
  container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>${message}</span></div>`;
}

export function showEmpty(container, message = "אין נתונים להצגה") {
  container.innerHTML = `<div class="empty-state">${message}</div>`;
}

export function showError(container, message = "שגיאה בטעינת הנתונים") {
  container.innerHTML = `<div class="error-state">⚠ ${message}</div>`;
}

// ── Activity type label ──────────────────────────────────────
const TYPE_LABELS = {
  course:       "קורס",
  after_school: "חוג",
  workshop:     "סדנה",
  tour:         "סיור",
  escape_room:  "חדר בריחה",
};
export function activityTypeLabel(val) {
  return TYPE_LABELS[val] ?? val ?? "—";
}

// ── Sheet detection ──────────────────────────────────────────
export function isLong(row_id) {
  return String(row_id).startsWith("LONG-");
}
export function isShort(row_id) {
  return String(row_id).startsWith("SHORT-");
}
