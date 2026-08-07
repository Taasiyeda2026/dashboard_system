const TRAINING_TABS = new Set(['summer_training_matrix', 'course_training_matrix']);
const LOCATION_LABELS = new Set(['מחסן', 'הילה', 'עידן', 'גיל']);

function hasData(cell) {
  return Boolean(String(cell?.textContent || '').trim());
}

function setColumnHidden(table, index, hidden) {
  table.querySelectorAll('tr').forEach((row) => {
    const cell = row.children[index];
    if (cell) cell.hidden = hidden;
  });
}

function filterMatrix(table) {
  const rows = Array.from(table.tBodies?.[0]?.rows || []);
  const count = table.tHead?.rows?.[0]?.cells?.length || 0;
  rows.forEach((row) => { row.hidden = !Array.from(row.cells).slice(1).some(hasData); });
  for (let index = 1; index < count; index += 1) {
    setColumnHidden(table, index, !rows.some((row) => hasData(row.cells[index])));
  }
  const shell = table.closest('.ops2027-table-shell');
  if (shell) shell.hidden = rows.length > 0 && rows.every((row) => row.hidden);
}

function numericValue(cell) {
  const input = cell?.querySelector?.('input');
  return Number(input ? input.value : cell?.textContent) || 0;
}

function filterStock(table) {
  const header = table.tHead?.rows?.[0];
  const rows = Array.from(table.tBodies?.[0]?.rows || []);
  if (!header) return;
  Array.from(header.cells).forEach((cell, index) => {
    if (!LOCATION_LABELS.has(String(cell.textContent || '').trim())) return;
    setColumnHidden(table, index, !rows.some((row) => numericValue(row.cells[index]) !== 0));
  });
}

export function filterOperations2027EmptyData(root = document) {
  root.querySelectorAll('.ops2027-view[data-ops-controller-tab]').forEach((view) => {
    const tab = view.getAttribute('data-ops-controller-tab');
    if (TRAINING_TABS.has(tab)) {
      const table = view.querySelector('.ops2027-table');
      if (table) filterMatrix(table);
      return;
    }
    if (tab !== 'course_print_kits') return;
    const stock = view.querySelector('.ops2027-print-kit-stock .ops2027-table');
    if (stock) filterStock(stock);
    view.querySelectorAll('.ops2027-print-kit-matrix .ops2027-table').forEach(filterMatrix);
    view.querySelectorAll('.ops2027-section').forEach((section) => {
      const shell = section.querySelector('.ops2027-table-shell');
      section.hidden = Boolean((shell && shell.hidden) || (!shell && section.querySelector('.ops2027-empty')));
    });
  });
}

if (typeof document !== 'undefined' && !globalThis.__ops2027EmptyDataFilterInstalled) {
  globalThis.__ops2027EmptyDataFilterInstalled = true;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      filterOperations2027EmptyData(document);
    });
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  schedule();
}
