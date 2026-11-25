/**
 * Instructor-facing correction note for an explicitly reopened attendance month.
 * The reason comes from the server-side attendance_month_approvals row.
 * Write via textContent only: manager-entered text is never parsed as HTML.
 */
export function buildMonthReturnNotice(approval, { documentRef = document, onMyReports = null } = {}) {
  if (approval?.status !== 'reopened') return null;

  const box = documentRef.createElement('section');
  box.className = 'av2-month-return-notice';
  box.setAttribute('role', 'status');
  box.setAttribute('dir', 'rtl');
  const heading = documentRef.createElement('strong');
  heading.className = 'av2-month-return-notice__title';
  heading.textContent = 'הדוח הוחזר לתיקון';

  const intro = documentRef.createElement('p');
  intro.textContent = 'המנהל ביקש לתקן את הדוח לפני אישורו.';

  const note = documentRef.createElement('p');
  note.className = 'av2-month-return-notice__reason';
  note.textContent = String(approval.reopen_reason || '').trim()
    || 'הדוח נפתח שוב לתיקון. יש לבדוק את הדיווחים ולהשלים את הנדרש.';

  const footer = documentRef.createElement('p');
  footer.className = 'av2-month-return-notice__footer';
  const manager = String(approval.reopened_by_name || '').trim();
  const date = approval.reopened_at ? new Date(approval.reopened_at) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('he-IL') : '';
  footer.textContent = [manager, dateLabel].filter(Boolean).join(' · ');

  const instructions = documentRef.createElement('p');
  instructions.className = 'av2-month-return-notice__instructions';
  instructions.textContent = 'לאחר התיקון יש לבצע שוב ״סיום ואישור חודש״ כדי להעביר את הדוח לבקרת המנהל.';

  box.append(heading, intro, note, footer, instructions);
  if (typeof onMyReports === 'function') {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'av2-btn av2-btn--secondary';
    button.textContent = 'מעבר לדיווחים לתיקון';
    button.addEventListener('click', onMyReports);
    box.append(button);
  }
  return box;
}
