import { config } from '../config.js';
import { operationsManagementScreen } from './operations-management.js';

const INSTALL_MARKER = '__operations2027EmptyDataFilterInstalled';
const HOTFIX_MARKER = 'ops-2027-empty-data-filter-20260807-v1';
const CONTROLLER_TABS = new Set(['summer_training_matrix', 'course_training_matrix', 'course_print_kits']);
const STOCK_LOCATION_LABELS = new Set(['מחסן', 'הילה', 'עידן', 'גיל']);

if (!String(config.HOTFIX_VERSION || '').includes(HOTFIX_MARKER)) {
  config.HOTFIX_VERSION = `${String(config.HOTFIX_VERSION || '').replace(/-$/, '')}-${HOTFIX_MARKER}`;
}

function cellHasMeaningfulData(cell) {
  if (!cell) return false;
  return Boolean(cell.querySelector([
    '.ops2027-status.is-yes',
    '.ops2027-status.is-no',
    '.ops2027-cell-button.is-yes',
    '.ops2027-cell-button.is-no',
    '[data-trained="1"]',
    '[data-assigned="1"]',
    '[data-ops-kit-return]'
  ].join(',')));
}

function removeEmptyMatrixRowsAndColumns(table) {
  const bodyRows = Array.from(table?.tBodies?.[0]?.rows || []);
  const headerRow = table?.tHead?.rows?.[0];
  if (!headerRow || !bodyRows.length) return false;

  const meaningfulRows = bodyRows.filter((row) =>
    Array.from(row.cells).slice(1).some(cellHasMeaningfulData)
  );
  bodyRows.filter((row) => !meaningfulRows.includes(row)).forEach((row) => row.remove());

  const dataColumnCount = Math.max(0, headerRow.cells.length - 1);
  const emptyColumnIndexes = [];
  for (let columnIndex = 1; columnIndex <= dataColumnCount; columnIndex += 1) {
    const hasData = meaningfulRows.some((row) => cellHasMeaningfulData(row.cells[columnIndex]));
    if (!hasData) emptyColumnIndexes.push(columnIndex);
  }
  emptyColumnIndexes.reverse().forEach((columnIndex) => {
    headerRow.cells[columnIndex]?.remove();
    meaningfulRows.forEach((row) => row.cells[columnIndex]?.remove());
  });

  return meaningfulRows.length > 0 && headerRow.cells.length > 1;
}

function numericCellValue(cell) {
  if (!cell) return 0;
  const input = cell.querySelector('input[type="number"]');
  const raw = input ? input.value : cell.textContent;
  const value = Number(String(raw || '').replace(/,/g, '').trim());
  return Number.isFinite(value) ? value : 0;
}

function filterPrintKitStockTable(table) {
  const bodyRows = Array.from(table?.tBodies?.[0]?.rows || []);
  const headerRow = table?.tHead?.rows?.[0];
  if (!headerRow || !bodyRows.length) return false;

  const locationIndexes = Array.from(headerRow.cells)
    .map((cell, index) => ({ index, label: String(cell.textContent || '').trim() }))
    .filter(({ label }) => STOCK_LOCATION_LABELS.has(label))
    .map(({ index }) => index);

  locationIndexes
    .filter((index) => bodyRows.every((row) => numericCellValue(row.cells[index]) === 0))
    .sort((a, b) => b - a)
    .forEach((index) => {
      headerRow.cells[index]?.remove();
      bodyRows.forEach((row) => row.cells[index]?.remove());
    });

  bodyRows.forEach((row) => {
    const values = Array.from(row.cells).slice(1).map(numericCellValue);
    if (values.every((value) => value === 0)) row.remove();
  });

  return Boolean(table.tBodies[0]?.rows?.length);
}

export function filterOperations2027EmptyData(root) {
  const view = root?.querySelector?.('.ops2027-view[data-ops-controller-tab]');
  const tabKey = String(view?.dataset?.opsControllerTab || '');
  if (!view || !CONTROLLER_TABS.has(tabKey)) return;

  if (tabKey === 'course_print_kits') {
    const stockTable = view.querySelector('.ops2027-print-kit-stock table');
    const stockSection = stockTable?.closest('.ops2027-section');
    if (stockTable && !filterPrintKitStockTable(stockTable)) stockSection?.remove();

    view.querySelectorAll('.ops2027-print-kit-matrix table').forEach((table) => {
      if (!removeEmptyMatrixRowsAndColumns(table)) table.closest('.ops2027-section')?.remove();
    });
    return;
  }

  const table = view.querySelector('.ops2027-table');
  if (table && !removeEmptyMatrixRowsAndColumns(table)) {
    table.closest('.ops2027-table-shell')?.remove();
  }
}

function installFilter() {
  if (operationsManagementScreen[INSTALL_MARKER]) return;
  operationsManagementScreen[INSTALL_MARKER] = true;
  const originalBind = operationsManagementScreen.bind;

  operationsManagementScreen.bind = function wrappedOperations2027EmptyFilter(context = {}) {
    originalBind.call(this, context);
    const root = context.root;
    if (!root) return;

    const apply = () => filterOperations2027EmptyData(root);
    queueMicrotask(apply);

    const content = root.querySelector?.('.ds-ops-mgmt-content');
    if (!content || content.dataset.ops2027EmptyFilterObserved === '1') return;
    content.dataset.ops2027EmptyFilterObserved = '1';
    const observer = new MutationObserver(() => queueMicrotask(apply));
    observer.observe(content, { childList: true, subtree: true });
  };
}

installFilter();
