const CUSTOM_TAB_SELECTOR = '[data-ops-custom-tab="summer_training_matrix"], [data-ops-custom-tab="course_training_matrix"], [data-ops-custom-tab="course_print_kits"]';

let observer = null;
let queued = false;

function operations2027Root() {
  return document.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027');
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

    .ds-ops-mgmt-screen .ops2027-table--transposed {
      width: max-content !important;
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

  const rowLabels = sourceRows.map((row) => String(row.cells?.[0]?.textContent || '').trim());
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
    nameCell.textContent = String(headerCell.textContent || '').trim();
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

function titleNodeForShell(shell, view) {
  const section = shell.closest('.ops2027-section, .ops2027-history-group');
  const sectionTitle = section?.querySelector(':scope > .ops2027-history-group-title, :scope > .ops2027-section-title');
  if (sectionTitle) return sectionTitle;

  const shells = Array.from(view?.querySelectorAll?.('.ops2027-table-shell') || []);
  if (shells.length === 1) return view?.querySelector?.('.ops2027-header .ops2027-title') || null;
  return null;
}

function attachTableTitle(shell) {
  if (!shell || shell.querySelector(':scope > .ops2027-attached-title')) return;
  const view = shell.closest('.ops2027-view');
  const titleNode = titleNodeForShell(shell, view);
  const title = String(titleNode?.textContent || '').trim();
  if (!title) return;

  const caption = document.createElement('div');
  caption.className = 'ops2027-attached-title';
  caption.textContent = title;
  shell.insertBefore(caption, shell.firstChild);
  titleNode.remove();

  const header = view?.querySelector?.(':scope > .ops2027-header');
  if (header && !String(header.textContent || '').trim()) header.remove();
}

function fixOperationsTables() {
  const root = operations2027Root();
  if (!root) return;
  ensureStyle();

  root.querySelectorAll('.ops2027-table').forEach((table) => transposeMatrixTable(table));
  root.querySelectorAll('.ops2027-table-shell').forEach((shell) => attachTableTitle(shell));
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

export { transposeMatrixTable, attachTableTitle };
