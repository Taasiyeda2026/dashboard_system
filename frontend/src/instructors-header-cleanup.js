function instructorsAppRoot(root = document) {
  if (!root) return null;
  if (root.id === 'app') return root;
  return root.querySelector?.('#app') || null;
}

function isInstructorsScreen(app) {
  const title = app?.querySelector?.('.ds-page-header__title');
  return String(title?.textContent || '').trim() === 'מדריכים';
}

export function cleanupInstructorsHeader(root = document) {
  const app = instructorsAppRoot(root);
  if (!app || !isInstructorsScreen(app)) return false;

  // The guides list search box is a permanent part of the screen — only a
  // stray legacy course-scheduling button (from markup that predates the
  // unified instructors workspace) needs to be swept from cached pages.
  app.querySelector('.ds-page-header [data-route="course-scheduling"]')?.remove();
  return true;
}

let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  queueMicrotask(() => {
    cleanupScheduled = false;
    cleanupInstructorsHeader(document);
  });
}

function startInstructorsHeaderCleanup() {
  const app = document.getElementById('app');
  if (!app) return;
  cleanupInstructorsHeader(app);
  new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => (
      node.nodeType === 1 && (
        node.matches?.('.ds-page-header, .ds-screen-top-row, [data-instructors-search]')
        || node.querySelector?.('.ds-page-header, .ds-screen-top-row, [data-instructors-search]')
      )
    )));
    if (relevant) scheduleCleanup();
  }).observe(app, { childList: true, subtree: true });
  document.addEventListener('app:navigate', scheduleCleanup);
}

const isRealBrowser = typeof window !== 'undefined'
  && window === globalThis
  && typeof sessionStorage !== 'undefined'
  && typeof localStorage !== 'undefined';

if (isRealBrowser) {
  import('./activity-2027-contact-list-runtime.js?v=20260802-v1').catch((error) => {
    console.error('[activity-2027-contact-list] load failed', error);
  });
  import('./payroll-control-window-fix.js?v=20260817-v1').catch((error) => {
    console.error('[payroll-control-window-fix] load failed', error);
  });
  import('./payroll-control-test-mode.js?v=20260817-v2').catch((error) => {
    console.error('[payroll-control-test-mode] load failed', error);
  });
  import('./payroll-control-test-review-fix.js?v=20260817-v1').catch((error) => {
    console.error('[payroll-control-test-review-fix] load failed', error);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInstructorsHeaderCleanup, { once: true });
  } else {
    startInstructorsHeaderCleanup();
  }
}
