/**
 * Adds an admin-only "משובים" button to the existing activity drawer.
 * The button opens the impact feedback screen for that activity (group); no data is
 * re-entered — the module reads school/program/instructor/contact from the activity.
 */
import { state } from '../state.js';

const BUTTON_ATTR = 'data-impact-feedback-open';

function isAdmin() {
  return String(state?.user?.role || '').trim().toLowerCase() === 'admin';
}

function closeDrawer(form) {
  const drawer = form.closest('.ds-drawer') || document.querySelector('.ds-drawer[aria-hidden="false"]');
  drawer?.querySelector('[data-ui-close-drawer]')?.click();
}

function createButton(form) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'activity-drawer__action activity-drawer__view-footer__btn';
  button.setAttribute(BUTTON_ATTR, 'true');
  button.title = 'משובים לקבוצה הזו';
  button.textContent = '💬 משובים';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rowId = String(form.dataset.rowId || '').trim();
    if (!rowId) return;
    state.impactFeedback = { groupRowId: rowId, academicYear: String(form.dataset.activitySeason || '').trim() || 'regular' };
    closeDrawer(form);
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'impact-feedback', force: true } }));
  });
  return button;
}

export function enhanceActivityDrawers(root = document) {
  if (!isAdmin()) return;
  root.querySelectorAll?.('form[data-drawer-form][data-row-id]').forEach((form) => {
    if (!String(form.dataset.rowId || '').trim()) return;
    const footer = form.querySelector('.activity-drawer__view-footer');
    if (!footer || footer.querySelector(`[${BUTTON_ATTR}]`)) return;
    footer.append(createButton(form));
  });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceActivityDrawers(document);
  });
}

if (typeof document !== 'undefined' && !globalThis.__impactFeedbackDrawerButton) {
  globalThis.__impactFeedbackDrawerButton = true;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
