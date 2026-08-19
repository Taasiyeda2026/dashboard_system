const BOARD_SELECTOR = '.manager-board-screen[data-manager-board-root]';
let scheduled = false;
let openPhoneChip = null;

function activeWorkspaceTab(boardRoot) {
  return boardRoot?.querySelector('[data-manager-workspace-tab].is-active')?.getAttribute('data-manager-workspace-tab') || 'management';
}

function removeMonthlyInstructorPanel(boardRoot) {
  boardRoot?.querySelectorAll('.manager-board-panel--instructors').forEach((panel) => panel.remove());
}

function setButtonText(button, value) {
  if (button && button.textContent !== value) button.textContent = value;
}

function setButtonTitle(button, value) {
  if (!button) return;
  if (value) {
    if (button.title !== value) button.title = value;
  } else if (button.hasAttribute('title')) {
    button.removeAttribute('title');
  }
}

function closePhonePopover() {
  if (!openPhoneChip) return;
  openPhoneChip.querySelector('.manager-board-phone-popover')?.remove();
  openPhoneChip.classList.remove('is-phone-open');
  openPhoneChip.setAttribute('aria-expanded', 'false');
  openPhoneChip = null;
}

function togglePhonePopover(chip) {
  if (!chip) return;
  const alreadyOpen = openPhoneChip === chip && chip.querySelector('.manager-board-phone-popover');
  closePhonePopover();
  if (alreadyOpen) return;

  const popover = document.createElement('span');
  popover.className = 'manager-board-phone-popover';
  popover.dir = 'ltr';
  popover.textContent = String(chip.dataset.instructorMobile || '').trim() || '—';
  chip.style.position = 'relative';
  chip.classList.add('is-phone-open');
  chip.setAttribute('aria-expanded', 'true');
  chip.appendChild(popover);
  openPhoneChip = chip;
}

function syncManagementMonthNavigation(boardRoot) {
  const nav = boardRoot?.querySelector('.manager-board-month-nav');
  if (!nav) return;
  const previous = nav.querySelector('[data-manager-board-month="-1"]');
  const next = nav.querySelector('[data-manager-board-month="1"]');
  if (!previous || !next) return;

  const isManagement = activeWorkspaceTab(boardRoot) === 'management';
  nav.classList.toggle('manager-board-month-nav--arrows', isManagement);
  nav.classList.remove('manager-board-month-nav--labeled');

  if (isManagement) {
    // RTL timeline: previous month is on the right and next month is on the left.
    setButtonText(previous, '›');
    setButtonText(next, '‹');
    setButtonTitle(previous, previous.disabled ? 'זהו החודש הראשון בשנת הפעילות' : 'החודש הקודם');
    setButtonTitle(next, next.disabled ? 'זהו החודש האחרון בשנת הפעילות' : 'החודש הבא');
  } else {
    setButtonText(previous, '‹');
    setButtonText(next, '›');
    setButtonTitle(previous, '');
    setButtonTitle(next, '');
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

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const instructorChip = target.closest('button.manager-board-team-strip__chip[data-instructor-mobile]');
  if (instructorChip) {
    // Delegated handling keeps phone clicks working after every board re-render and avoids double-toggle with the older per-chip listener.
    event.preventDefault();
    event.stopImmediatePropagation();
    togglePhonePopover(instructorChip);
    return;
  }

  if (!target.closest('.manager-board-phone-popover')) closePhonePopover();
  if (target.closest('[data-manager-workspace-tab], [data-manager-board-month]')) scheduleSync();
}

function start() {
  const root = document.getElementById('app') || document.documentElement;
  const observer = new MutationObserver(scheduleSync);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
  document.addEventListener('click', handleDocumentClick, true);
  scheduleSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
