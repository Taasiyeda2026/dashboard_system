import './activity-2027-contact-list-runtime.js?v=20260802-v1';

const isRealBrowser = typeof window !== 'undefined'
  && window === globalThis
  && window.sessionStorage
  && window.localStorage;

if (isRealBrowser) {
  import('./instructor-course-scheduling-usability.js?v=20260803-v1').catch((error) => {
    console.error('[course-scheduling-usability] load failed', error);
  });
}

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

  const search = app.querySelector('[data-instructors-search]');
  if (search) {
    if (String(search.value || '').trim()) {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const currentSearch = app.querySelector('[data-instructors-search]');
    currentSearch?.parentElement?.remove();
  }

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

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInstructorsHeaderCleanup, { once: true });
  } else {
    startInstructorsHeaderCleanup();
  }
}
