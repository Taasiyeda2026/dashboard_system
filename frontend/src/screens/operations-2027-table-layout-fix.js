const TAB_WORKSHOP_TRAINING = 'summer_training_matrix';
const TAB_PRINT_KITS = 'course_print_kits';
const CUSTOM_TAB_SELECTOR = '[data-ops-custom-tab="summer_training_matrix"], [data-ops-custom-tab="course_training_matrix"], [data-ops-custom-tab="course_print_kits"]';

let observer = null;
let queued = false;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function operations2027Root() {
  return document.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027');
}

function activeCustomTab(root) {
  return root
    ?.querySelector?.('.ds-ops-mgmt-tab.is-active[data-ops-custom-tab]')
    ?.dataset?.opsCustomTab || '';
}

function ensureStyle() {
  if (document.getElementById('ops-2027-table-layout-fix-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-2027-table-layout-fix-style';
  style.textContent = `
    .ds-ops-mgmt-screen[data-ops-year="2027"] [data-ops-2027-runtime-marker],
    .ds-ops-mgmt-screen.ops-year-2027 [data-ops-2027-runtime-marker] {
      display: none !important;
      position: absolute !important;
      width: 0 !important;
      height: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }

    .ds-ops-mgmt-screen .ops2027-table-shell {
      overflow-x: auto;
      border-radius: 10px;
    }

    .ds-ops-mgmt-screen .ops2027-attached-title {
      position: sticky;
      inset-inline-start: 0;
      box-sizing: border-box;
      width: 100%;
      min-width: max-content;
      padding: 8px 12px;
      border-bottom: 1px solid var(--ds-border, #dbe3ec);
      background: #eef8fc;
      color: #17365d;
      text-align: right;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.25;
    }

    .ds-ops-mgmt-screen .ops2027-table,
    .ds-ops-mgmt-screen .ops2027-table th,
    .ds-ops-mgmt-screen .ops2027-table td {
      font-size: 11px !important;
    }

    .ds-ops-mgmt-screen .ops2027-table th,
    .ds-ops-mgmt-screen .ops2027-table td {
      padding: 4px 6px !important;
      line-height: 1.2 !important;
    }

    .ds-ops-mgmt-screen .ops2027-table--transposed,
    .ds-ops-mgmt-screen .ops2027-workshop-training-table,
    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-table {
      width: max-content !important;
      min-width: 0 !important;
      max-width: none !important;
      table-layout: fixed !important;
    }

    .ds-ops-mgmt-screen .ops2027-table--transposed .ops2027-instructor-row-label {
      width: 136px !important;
      min-width: 136px !important;
      max-width: 136px !important;
      padding-inline: 8px !important;
      text-align: right !important;
      white-space: normal !important;
      font-size: 11px !important;
      font-weight: 700 !important;
    }

    .ds-ops-mgmt-screen .ops2027-table--transposed .ops2027-course-header-col,
    .ds-ops-mgmt-screen .ops2027-table--transposed .ops2027-matrix-cell {
      width: 82px !important;
      min-width: 82px !important;
      max-width: 82px !important;
      text-align: center !important;
    }

    .ds-ops-mgmt-screen .ops2027-table--transposed .ops2027-course-header-col {
      height: 52px !important;
      padding: 4px !important;
      white-space: normal !important;
      overflow-wrap: anywhere;
      vertical-align: middle !important;
      font-size: 10px !important;
      font-weight: 700 !important;
    }

    .ds-ops-mgmt-screen .ops2027-table--transposed .ops2027-matrix-cell {
      height: 30px !important;
    }

    .ds-ops-mgmt-screen .ops2027-workshop-training-table .ops2027-workshop-row-label {
      width: 190px !important;
      min-width: 190px !important;
      max-width: 190px !important;
      padding-inline: 8px !important;
      text-align: right !important;
      white-space: normal !important;
      overflow-wrap: anywhere;
      font-weight: 700 !important;
    }

    .ds-ops-mgmt-screen .ops2027-workshop-training-table .ops2027-instructor-header-col,
    .ds-ops-mgmt-screen .ops2027-workshop-training-table .ops2027-matrix-cell {
      width: 82px !important;
      min-width: 82px !important;
      max-width: 82px !important;
      text-align: center !important;
      vertical-align: middle !important;
    }

    .ds-ops-mgmt-screen .ops2027-workshop-training-table .ops2027-instructor-header-col {
      height: 52px !important;
      padding: 4px !important;
      white-space: normal !important;
      overflow-wrap: anywhere;
      font-size: 10px !important;
      font-weight: 700 !important;
    }

    .ds-ops-mgmt-screen .ops2027-print-kit-stock .ops2027-table th:nth-last-child(-n+3),
    .ds-ops-mgmt-screen .ops2027-print-kit-stock .ops2027-table td:nth-last-child(-n+3) {
      box-sizing: border-box !important;
      width: 118px !important;
      min-width: 118px !important;
      max-width: 118px !important;
      text-align: center !important;
      white-space: normal !important;
      vertical-align: middle !important;
    }

    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-table th:first-child,
    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-table td:first-child {
      box-sizing: border-box !important;
      width: 154px !important;
      min-width: 154px !important;
      max-width: 154px !important;
      padding-inline: 8px !important;
      text-align: right !important;
      white-space: normal !important;
      overflow-wrap: anywhere;
      font-weight: 700 !important;
    }

    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-table th:not(:first-child),
    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-table td:not(:first-child) {
      box-sizing: border-box !important;
      width: 72px !important;
      min-width: 72px !important;
      max-width: 72px !important;
      padding: 4px !important;
      text-align: center !important;
      vertical-align: middle !important;
    }

    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-table th:not(:first-child) {
      height: 58px !important;
      white-space: normal !important;
      overflow-wrap: anywhere;
      font-size: 10px !important;
      line-height: 1.15 !important;
    }

    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-cell-button,
    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-history-status {
      margin-inline: auto !important;
    }

    .ds-ops-mgmt-screen .ops2027-instructor-name,
    .ds-ops-mgmt-screen .ops2027-course-col {
      font-size: 11px !important;
      line-height: 1.2 !important;
    }

    .ds-ops-mgmt-screen .ops2027-cell-button,
    .ds-ops-mgmt-screen .ops2027-toggle-button,
    .ds-ops-mgmt-screen .ops2027-history-status {
      display: inline-grid !important;
      place-items: center !important;
      min-width: 22px !important;
      width: 22px !important;
      min-height: 22px !important;
      height: 22px !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      font-size: 18px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
    }

    .ds-ops-mgmt-screen .ops2027-cell-button.is-yes,
    .ds-ops-mgmt-screen .ops2027-toggle-button.is-yes,
    .ds-ops-mgmt-screen .ops2027-history-status.is-yes {
      color: #15803d !important;
      background: transparent !important;
    }

    .ds-ops-mgmt-screen .ops2027-cell-button.is-no,
    .ds-ops-mgmt-screen .ops2027-toggle-button.is-no,
    .ds-ops-mgmt-screen .ops2027-history-status.is-no {
      color: #dc2626 !important;
      background: transparent !important;
    }

    .ds-ops-mgmt-screen .ops2027-out {
      padding: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #dc2626 !important;
      font-size: 10px !important;
    }

    .ds-ops-mgmt-screen .ops2027-history-note {
      font-size: 11px !important;
    }
  `;
  document.head.appendChild(style);
}

function transposeMatrixTable(table) {
  if (!table || table.dataset.opsMatrixTransposed === '1') return;
  const headerRow = table.tHead?.rows?.[0];
  const body = table.tBodies?.[0];
  if (!headerRow || !body || headerRow.cells.length < 2) return;

  const instructorHeaders = Array.from(headerRow.cells).slice(1);
  if (!instructorHeaders.some((cell) => cell.querySelector('.ops2027-instructor-name'))) return;

  const sourceRows = Array.from(body.rows);
  if (!sourceRows.length) return;

  const rowLabels = sourceRows.map((row) => cleanText(row.cells?.[0]?.textContent));
  const sourceCells = sourceRows.map((row) => Array.from(row.cells).slice(1));

  const newHead = document.createElement('thead');
  const newHeadRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'ops2027-instructor-row-label';
  corner.textContent = 'שם מדריך';
  newHeadRow.appendChild(corner);
  rowLabels.forEach((label) => {
    const th = document.createElement('th');
    th.className = 'ops2027-course-header-col';
    th.textContent = label;
    newHeadRow.appendChild(th);
  });
  newHead.appendChild(newHeadRow);

  const newBody = document.createElement('tbody');
  instructorHeaders.forEach((headerCell, instructorIndex) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'ops2027-instructor-row-label';
    nameCell.textContent = cleanText(headerCell.textContent);
    row.appendChild(nameCell);

    sourceCells.forEach((cells) => {
      const sourceCell = cells[instructorIndex];
      if (sourceCell) {
        sourceCell.classList.add('ops2027-matrix-cell');
        row.appendChild(sourceCell);
      } else {
        const emptyCell = document.createElement('td');
        emptyCell.className = 'ops2027-matrix-cell';
        row.appendChild(emptyCell);
      }
    });
    newBody.appendChild(row);
  });

  table.replaceChildren(newHead, newBody);
  table.classList.add('ops2027-table--transposed');
  table.dataset.opsMatrixTransposed = '1';
}

function orientWorkshopTrainingTable(table) {
  if (!table || table.dataset.opsWorkshopRows === '1') return;
  const headerRow = table.tHead?.rows?.[0];
  const body = table.tBodies?.[0];
  if (!headerRow || !body || headerRow.cells.length < 2) return;
  if (cleanText(headerRow.cells[0]?.textContent) !== 'שם מדריך') return;

  const workshopHeaders = Array.from(headerRow.cells).slice(1);
  const instructorRows = Array.from(body.rows);
  if (!workshopHeaders.length || !instructorRows.length) return;

  const instructorNames = instructorRows.map((row) => cleanText(row.cells?.[0]?.textContent));
  const sourceCells = instructorRows.map((row) => Array.from(row.cells).slice(1));

  const newHead = document.createElement('thead');
  const newHeadRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'ops2027-workshop-row-label';
  corner.textContent = 'שם סדנה';
  newHeadRow.appendChild(corner);
  instructorNames.forEach((name) => {
    const th = document.createElement('th');
    th.className = 'ops2027-instructor-header-col';
    th.textContent = name;
    newHeadRow.appendChild(th);
  });
  newHead.appendChild(newHeadRow);

  const newBody = document.createElement('tbody');
  workshopHeaders.forEach((headerCell, workshopIndex) => {
    const row = document.createElement('tr');
    const workshopCell = document.createElement('td');
    workshopCell.className = 'ops2027-workshop-row-label';
    workshopCell.textContent = cleanText(headerCell.textContent);
    row.appendChild(workshopCell);

    sourceCells.forEach((cells) => {
      const sourceCell = cells[workshopIndex];
      if (sourceCell) {
        sourceCell.classList.add('ops2027-matrix-cell');
        row.appendChild(sourceCell);
      } else {
        const emptyCell = document.createElement('td');
        emptyCell.className = 'ops2027-matrix-cell';
        row.appendChild(emptyCell);
      }
    });
    newBody.appendChild(row);
  });

  table.replaceChildren(newHead, newBody);
  table.classList.remove('ops2027-table--transposed');
  table.classList.add('ops2027-workshop-training-table');
  table.dataset.opsMatrixTransposed = '1';
  table.dataset.opsWorkshopRows = '1';
}

function sectionTitle(section) {
  return cleanText(section?.querySelector?.(
    ':scope > .ops2027-history-group-title, :scope > .ops2027-section-title, :scope > .ops2027-table-shell > .ops2027-attached-title'
  )?.textContent);
}

function cleanupPrintKitView(root) {
  const view = root?.querySelector?.(`.ops2027-view[data-ops-history-fix="${TAB_PRINT_KITS}"]`);
  if (!view) return;

  const header = view.querySelector(':scope > .ops2027-header');
  if (cleanText(header?.textContent) === 'ערכות דפוס') header.remove();

  view.querySelectorAll(':scope > .ops2027-section, :scope > .ops2027-history-group').forEach((section) => {
    const title = sectionTitle(section);
    if (title === 'סיכום צורך בערכות') {
      section.remove();
      return;
    }
    if (title === 'מלאי ערכות') section.classList.add('ops2027-print-kit-stock');
    if (title === 'מדריכים פעילים' || title === 'מדריכים לא פעילים שמחזיקים ערכה') {
      section.classList.add('ops2027-print-kit-matrix');
    }
  });
}

function titleNodeForShell(shell, view) {
  const section = shell.closest('.ops2027-section, .ops2027-history-group');
  const sectionTitleNode = section?.querySelector(':scope > .ops2027-history-group-title, :scope > .ops2027-section-title');
  if (sectionTitleNode) return sectionTitleNode;

  const shells = Array.from(view?.querySelectorAll?.('.ops2027-table-shell') || []);
  if (shells.length === 1) return view?.querySelector?.('.ops2027-header .ops2027-title') || null;
  return null;
}

function attachTableTitle(shell) {
  if (!shell || shell.querySelector(':scope > .ops2027-attached-title')) return;
  const view = shell.closest('.ops2027-view');
  const titleNode = titleNodeForShell(shell, view);
  const title = cleanText(titleNode?.textContent);
  if (!title) return;

  const caption = document.createElement('div');
  caption.className = 'ops2027-attached-title';
  caption.textContent = title;
  shell.insertBefore(caption, shell.firstChild);
  titleNode.remove();

  const header = view?.querySelector?.(':scope > .ops2027-header');
  if (header && !cleanText(header.textContent)) header.remove();
}

function fixOperationsTables() {
  const root = operations2027Root();
  if (!root) return;
  ensureStyle();

  cleanupPrintKitView(root);

  const tab = activeCustomTab(root);
  root.querySelectorAll('.ops2027-table').forEach((table) => {
    if (tab === TAB_WORKSHOP_TRAINING) orientWorkshopTrainingTable(table);
    else transposeMatrixTable(table);
  });

  root.querySelectorAll('.ops2027-table-shell').forEach((shell) => attachTableTitle(shell));
  cleanupPrintKitView(root);
}

function queueFix(delay = 0) {
  if (queued) return;
  queued = true;
  window.setTimeout(() => {
    queued = false;
    fixOperationsTables();
  }, delay);
}

function observeOperations() {
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return;
  observer?.disconnect?.();
  observer = new MutationObserver(() => queueFix());
  observer.observe(app, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  ensureStyle();
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.(CUSTOM_TAB_SELECTOR)) {
      queueFix(0);
      window.setTimeout(() => queueFix(0), 180);
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      queueFix();
      observeOperations();
    }, { once: true });
  } else {
    queueFix();
    observeOperations();
  }
}

export {
  transposeMatrixTable,
  orientWorkshopTrainingTable,
  cleanupPrintKitView,
  attachTableTitle
};
