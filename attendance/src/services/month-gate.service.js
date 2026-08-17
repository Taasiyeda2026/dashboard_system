/**
 * month-gate.service.js
 * Single source of truth for edit-permission logic.
 * ALL create/edit/delete operations must call canEditMonth() before proceeding.
 * The grace period rule lives ONLY here — never scattered across screens.
 *
 * Month statuses (from attendance_month_approvals.status):
 *   null / missing row → 'open'   (editable)
 *   'open'             → editable
 *   'submitted'        → read-only (instructor submitted, awaiting manager)
 *   'locked'           → read-only (manager locked)
 *   'reopened'         → editable (manager re-opened after lock)
 */

export function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatMonthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

/**
 * Can the instructor add / edit / delete records for this year+month?
 * @param {number} year
 * @param {number} month  1-based
 * @param {object|null} approval  Row from attendance_month_approvals, or null (= open)
 * @returns {boolean}
 */
export function canEditMonth(year, month, approval) {
  const status = approval?.status ?? 'open';

  // Permanently locked by manager
  if (status === 'locked') return false;

  // Submitted by instructor — awaiting manager action
  if (status === 'submitted') return false;

  // 'open' and 'reopened' are both editable, subject to time rules
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1; // 1-based
  const cd = now.getDate();

  // Current month is always editable
  if (year === cy && month === cm) return true;

  // Previous month is editable during grace period (days 1–2 of current month)
  const [prevY, prevM] = cm === 1 ? [cy - 1, 12] : [cy, cm - 1];
  if (year === prevY && month === prevM && cd <= 2) return true;

  return false;
}

/** Short human-readable reason why a month is locked (for UI messages). */
export function editBlockReason(year, month, approval) {
  const status = approval?.status ?? 'open';
  if (status === 'locked') return 'החודש נעול על ידי המנהל';
  if (status === 'submitted') return 'הדיווח הוגש — לא ניתן לערוך עד שיאושר שינוי';
  return 'לא ניתן לערוך חודש קודם לאחר תקופת הארכה (עד ה-2 בחודש)';
}

/** Current school year as displayed to the user ("תשפ\"ז"). */
export function currentSchoolYearLabel() {
  const now = new Date();
  // School year starts September 1
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  // Hebrew year offset: 2000 CE ≈ תש"ס (5760). Rough label only.
  const labels = { 2024: 'תשפ"ה', 2025: 'תשפ"ו', 2026: 'תשפ"ז', 2027: 'תשפ"ח' };
  return labels[y] || String(y + 1);
}
