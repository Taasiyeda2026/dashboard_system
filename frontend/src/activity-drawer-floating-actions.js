const TEST_FLAG = '__ACTIVITY_DRAWER_FLOATING_ACTIONS_TEST__';
const DOCKED_ATTR = 'data-activity-actions-docked';

function isActionBar(element) {
  return Boolean(
    element?.classList?.contains('activity-drawer__section--actions') ||
    element?.classList?.contains('activity-drawer__view-footer')
  );
}

/**
 * Moves the view/edit action bars outside the scrollable drawer body.
 * The form is a flex column, so the bars remain visible at the bottom while
 * only the activity details scroll.
 */
export function dockActivityDrawerActions(form) {
  if (!form?.classList?.contains('activity-drawer-inline-layout')) return false;

  const body = form.querySelector(':scope > .activity-drawer-inline__body');
  if (!body) return false;

  const actionBars = [...body.children].filter(isActionBar);
  if (!actionBars.length) return false;

  actionBars.forEach((bar) => {
    bar.setAttribute(DOCKED_ATTR, 'true');
    form.append(bar);
  });

  return true;
}

export function dockActivityDrawerActionBars(root = document) {
  let changed = false;
  root.querySelectorAll?.('.activity-drawer-inline-layout').forEach((form) => {
    if (dockActivityDrawerActions(form)) changed = true;
  });
  return changed;
}

function initialize() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      dockActivityDrawerActionBars(document);
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  schedule();
}

if (globalThis[TEST_FLAG] !== true) initialize();
