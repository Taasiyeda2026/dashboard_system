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
    // A footer shortcut was being rendered as a floating overlay beside Edit.
    // For 2027 keep feedback near the scheduling shortcut in the scrollable
    // content instead; avoid creating a second button on MutationObserver reruns.
    const existingButton = form.querySelector(`[${BUTTON_ATTR}]`);
    const footer = form.querySelector('.activity-drawer__view-footer');
    const is2027 = String(form.dataset.activitySeason || '').trim() === 'school_2027';
    if (is2027 && form.classList.contains('activity-drawer-inline-layout')) {
      const body = form.querySelector(':scope > .activity-drawer-inline__body');
      if (!body) return;
      const schedulingActions = body.querySelector('[data-activity-scheduling-status] .activity-drawer__scheduling-actions');
      let target = schedulingActions;
      if (!target) {
        target = form.ownerDocument.createElement('div');
        target.className = 'activity-drawer__scheduling-actions activity-drawer__scheduling-actions--standalone';
        body.append(target);
      }
      // Rehome a button that an earlier observer pass might have already
      // attached to the floating footer before the inline layout was mounted.
      const button = existingButton || createButton(form);
      button.className = 'ds-btn ds-btn--sm activity-drawer__feedback-shortcut';
      button.textContent = 'משובים';
      if (button.parentElement !== target) target.append(button);
      return;
    }
    if (existingButton || !footer) return;
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
