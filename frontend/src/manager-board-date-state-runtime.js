function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function directRows(container, selector) {
  return [...container.children].filter((child) => child.matches?.(selector));
}

function rowIso(row) {
  return text(row.querySelector('time[datetime]')?.getAttribute('datetime')).slice(0, 10);
}

function makePastDetails(rows, kind) {
  const details = document.createElement('details');
  details.className = 'manager-board-past-details';
  details.dataset.managerBoardPastKind = kind;

  const summary = document.createElement('summary');
  summary.className = 'manager-board-past-details__toggle';

  const list = document.createElement('div');
  list.className = 'manager-board-past-details__list';
  rows.forEach((row) => list.append(row));

  const noun = kind === 'milestone' ? 'נקודות' : 'תאריכים';
  const updateLabel = () => {
    summary.textContent = `${details.open ? 'סגור' : 'פתח'} ${rows.length} ${noun} שחלפו`;
  };
  details.addEventListener('toggle', updateLabel);
  updateLabel();

  details.append(summary, list);
  return details;
}

export function enhanceContainer(container, selector, kind, today = todayIso()) {
  if (!(container instanceof HTMLElement)) return;

  const previousGroups = [...container.children].filter((child) => child.matches?.('.manager-board-past-details'));
  const direct = directRows(container, selector);
  if (!direct.length && !previousGroups.length) return;

  // Async birthday hydration replaces innerHTML on the same container, retaining its dataset.
  // Reprocess newly rendered rows while leaving already processed lists untouched.
  if (container.dataset.managerBoardDateState === '1' &&
      direct.every((row) => row.dataset.managerBoardDateState === '1')) return;

  const wasExpanded = previousGroups.some((group) => group.open);
  previousGroups.forEach((group) => {
    const list = group.querySelector('.manager-board-past-details__list');
    [...(list?.children || [])].filter((row) => row.matches?.(selector)).forEach((row) => container.append(row));
    group.remove();
  });

  const rows = directRows(container, selector).sort((a, b) => rowIso(a).localeCompare(rowIso(b)));
  if (!rows.length) return;
  rows.forEach((row) => container.append(row));
  const past = [];
  rows.forEach((row) => {
    const iso = rowIso(row);
    row.dataset.managerBoardDateState = '1';
    row.classList.toggle('is-today', iso === today);
    row.classList.toggle('is-past', !!iso && iso < today);
    if (iso && iso < today) past.push(row);
  });

  if (past.length) {
    const details = makePastDetails(past, kind);
    details.open = wasExpanded;
    container.prepend(details);
  }
  container.dataset.managerBoardDateState = '1';
}

function enhanceAll(root = document) {
  root.querySelectorAll?.('.manager-board-milestones').forEach((container) => {
    enhanceContainer(container, '.manager-board-milestone', 'milestone');
  });
  root.querySelectorAll?.('.manager-board-school-events').forEach((container) => {
    enhanceContainer(container, '.manager-board-school-event', 'date');
  });
}

function boot() {
  enhanceAll();
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes.length)) return;
    enhanceAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
