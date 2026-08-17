const GANTT_TAB_ID = 'gantt';
const BOARD_SELECTOR = '.manager-board-screen[data-manager-board-root]';
const TAB_SELECTOR = '[data-manager-workspace-tab]';
let ganttActive = false;
let observer = null;
let syncScheduled = false;

function ensureStyles() {
  if (document.getElementById('manager-gantt-placeholder-styles')) return;
  const style = document.createElement('style');
  style.id = 'manager-gantt-placeholder-styles';
  style.textContent = `
${BOARD_SELECTOR}.is-manager-gantt-placeholder .manager-workspace-management-alerts,
${BOARD_SELECTOR}.is-manager-gantt-placeholder .manager-workspace-view,
${BOARD_SELECTOR}.is-manager-gantt-placeholder .manager-board-kpis,
${BOARD_SELECTOR}.is-manager-gantt-placeholder .manager-board-layout,
${BOARD_SELECTOR}.is-manager-gantt-placeholder .manager-board-panel--instructors{display:none!important}
.manager-gantt-placeholder{min-height:360px;display:grid;place-items:center;border:1px solid #dbe3ea;border-radius:14px;background:#fff;margin-top:14px;box-shadow:0 2px 8px rgba(15,23,42,.04)}
.manager-gantt-placeholder strong{font-size:clamp(1.35rem,2.5vw,2rem);letter-spacing:.08em;color:#64748b;font-weight:800}
`;
  document.head.appendChild(style);
}

function ganttPanel(board) {
  let panel = board.querySelector('[data-manager-gantt-placeholder]');
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'manager-gantt-placeholder';
    panel.dataset.managerGanttPlaceholder = 'true';
    panel.setAttribute('dir', 'rtl');
    panel.innerHTML = '<strong>COMING SOON...</strong>';
    const tabs = board.querySelector('[data-manager-workspace-tabs]');
    tabs?.insertAdjacentElement('afterend', panel);
  }
  panel.hidden = !ganttActive;
  return panel;
}

function ensureGanttTab(board) {
  const tabs = board.querySelector('[data-manager-workspace-tabs]');
  if (!tabs) return null;
  let button = tabs.querySelector(`[data-manager-workspace-tab="${GANTT_TAB_ID}"]`);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'manager-workspace-tab';
    button.dataset.managerWorkspaceTab = GANTT_TAB_ID;
    button.setAttribute('aria-selected', 'false');
    button.textContent = 'גאנט';
    tabs.appendChild(button);
  }
  return button;
}

function applyGanttState(board) {
  const button = ensureGanttTab(board);
  if (!button) return;
  const panel = ganttPanel(board);
  board.classList.toggle('is-manager-gantt-placeholder', ganttActive);
  if (ganttActive) {
    board.querySelectorAll(TAB_SELECTOR).forEach((tab) => {
      const selected = tab.dataset.managerWorkspaceTab === GANTT_TAB_ID;
      tab.classList.toggle('is-active', selected);
      const ariaSelected = selected ? 'true' : 'false';
      if (tab.getAttribute('aria-selected') !== ariaSelected) tab.setAttribute('aria-selected', ariaSelected);
    });
  }
  if (panel) panel.hidden = !ganttActive;
}

function sync() {
  syncScheduled = false;
  ensureStyles();
  const board = document.querySelector(BOARD_SELECTOR);
  if (!board) return;
  ensureGanttTab(board);
  applyGanttState(board);
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(sync);
}

function handleWorkspaceClick(event) {
  const target = event.target instanceof Element ? event.target.closest(TAB_SELECTOR) : null;
  if (!target) return;
  const board = target.closest(BOARD_SELECTOR);
  if (!board) return;
  const tabId = target.dataset.managerWorkspaceTab;
  if (tabId === GANTT_TAB_ID) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ganttActive = true;
    applyGanttState(board);
    window.setTimeout(() => applyGanttState(board), 80);
    return;
  }
  if (ganttActive) {
    ganttActive = false;
    board.classList.remove('is-manager-gantt-placeholder');
    board.querySelector('[data-manager-gantt-placeholder]')?.setAttribute('hidden', '');
  }
}

function start() {
  const app = document.getElementById('app');
  if (!app || observer) return;
  ensureStyles();
  window.addEventListener('click', handleWorkspaceClick, true);
  observer = new MutationObserver(scheduleSync);
  observer.observe(app, { childList: true, subtree: true });
  scheduleSync();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
