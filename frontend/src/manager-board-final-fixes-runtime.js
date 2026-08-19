const BOARD_SELECTOR = '.manager-board-screen[data-manager-board-root]';
let scheduled = false;

function activeWorkspaceTab(boardRoot) {
  return boardRoot?.querySelector('[data-manager-workspace-tab].is-active')?.getAttribute('data-manager-workspace-tab') || 'management';
}

function removeMonthlyInstructorPanel(boardRoot) {
  boardRoot?.querySelectorAll('.manager-board-panel--instructors').forEach((panel) => panel.remove());
}

function syncManagementMonthNavigation(boardRoot) {
  const nav = boardRoot?.querySelector('.manager-board-month-nav');
  if (!nav) return;
  const previous = nav.querySelector('[data-manager-board-month="-1"]');
  const next = nav.querySelector('[data-manager-board-month="1"]');
  if (!previous || !next) return;

  const isManagement = activeWorkspaceTab(boardRoot) === 'management';
  nav.classList.toggle('manager-board-month-nav--labeled', isManagement);

  if (isManagement) {
    previous.textContent = '‹ חודש קודם';
    next.textContent = 'חודש הבא ›';
    previous.title = previous.disabled ? 'זהו החודש הראשון בשנת הפעילות' : 'מעבר לחודש הקודם';
    next.title = next.disabled ? 'זהו החודש האחרון בשנת הפעילות' : 'מעבר לחודש הבא';
  } else {
    previous.textContent = '‹';
    next.textContent = '›';
    previous.removeAttribute('title');
    next.removeAttribute('title');
  }
}

function syncBoard() {
  scheduled = false;
  document.querySelectorAll(BOARD_SELECTOR).forEach((boardRoot) => {
    removeMonthlyInstructorPanel(boardRoot);
    syncManagementMonthNavigation(boardRoot);
  });
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(syncBoard);
}

function start() {
  const root = document.getElementById('app') || document.documentElement;
  const observer = new MutationObserver(scheduleSync);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-manager-workspace-tab], [data-manager-board-month]')) scheduleSync();
  }, true);
  scheduleSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
