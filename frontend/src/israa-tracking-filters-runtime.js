const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const FILTERS_ATTR = 'data-israa-v2-filters';
const DEBOUNCE_MS = 70;

let timer = null;
const filterState = {
  query: '',
  status: '',
  probability: '',
  nature: ''
};

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).toLocaleLowerCase('he-IL');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectStyles() {
  if (document.getElementById('israa-tracking-filters-styles')) return;

  const style = document.createElement('style');
  style.id = 'israa-tracking-filters-styles';
  style.textContent = `
    .israa-v2__kpis {
      width: 100% !important;
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      gap: 10px !important;
      align-items: stretch !important;
    }

    .israa-v2__kpi {
      width: auto !important;
      min-width: 0 !important;
      max-width: none !important;
      min-height: 66px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .israa-v2__kpi-label,
    .israa-v2__kpi-value {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .israa-v2__filters-shell {
      width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      margin: 0 0 8px;
      scrollbar-width: thin;
    }

    .israa-v2__filters {
      width: 100%;
      min-width: 840px;
      box-sizing: border-box;
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      border: 1px solid #dbe3ec;
      border-radius: 9px;
      background: #fff;
      white-space: nowrap;
    }

    .israa-v2__filter-search {
      flex: 1 1 320px;
      min-width: 240px;
      height: 34px;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 10px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      box-sizing: border-box;
    }

    .israa-v2__filter-search:focus-within {
      border-color: #0891b2;
      box-shadow: 0 0 0 2px rgba(8, 145, 178, .12);
    }

    .israa-v2__filter-search-icon {
      flex: 0 0 auto;
      color: #64748b;
      font-size: 13px;
      line-height: 1;
    }

    .israa-v2__filter-search input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: #0f172a;
      font: inherit;
      font-size: 12px;
    }

    .israa-v2__filter-select {
      flex: 0 0 auto;
      height: 34px;
      min-width: 112px;
      max-width: 165px;
      padding: 0 9px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      color: #334155;
      font: inherit;
      font-size: 11.5px;
      box-sizing: border-box;
    }

    .israa-v2__filter-select--status { width: 150px; }
    .israa-v2__filter-select--probability { width: 118px; }
    .israa-v2__filter-select--nature { width: 138px; }

    .israa-v2__filter-reset {
      flex: 0 0 auto;
      height: 34px;
      padding: 0 12px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #f8fafc;
      color: #475569;
      font: inherit;
      font-size: 11.5px;
      font-weight: 750;
      cursor: pointer;
    }

    .israa-v2__filter-reset:hover { background: #f1f5f9; }

    .israa-v2__filter-count {
      flex: 0 0 86px;
      color: #64748b;
      font-size: 11px;
      font-weight: 750;
      text-align: center;
    }

    .israa-v2__filter-empty td {
      padding: 24px !important;
      text-align: center;
      color: #64748b;
      background: #fff;
    }

    @media (max-width: 900px) {
      .israa-v2__kpis {
        grid-template-columns: repeat(4, minmax(150px, 1fr)) !important;
        overflow-x: auto;
      }
    }
  `;
  document.head.appendChild(style);
}

function getHeaderMap(table) {
  const map = new Map();
  table.querySelectorAll('thead th').forEach((th, index) => {
    map.set(clean(th.textContent), index);
  });
  return map;
}

function cellText(row, headerMap, label) {
  const index = headerMap.get(label);
  if (index == null) return '';
  return clean(row.cells?.[index]?.textContent);
}

function rowSearchText(row) {
  const titles = [...row.querySelectorAll('[title]')]
    .map((element) => clean(element.getAttribute('title')))
    .filter(Boolean)
    .join(' ');
  return normalized(`${row.textContent || ''} ${titles}`);
}

function rowMatches(row, headerMap) {
  if (row.classList.contains('is-editing') || row.dataset.v2RowId === '__new__') return true;

  const query = normalized(filterState.query);
  if (query && !rowSearchText(row).includes(query)) return false;

  if (filterState.status) {
    const status = normalized(cellText(row, headerMap, 'סטטוס'));
    if (status !== normalized(filterState.status)) return false;
  }

  if (filterState.probability) {
    const probability = cellText(row, headerMap, 'סבירות').replace(/[^0-9]/g, '');
    if (probability !== filterState.probability) return false;
  }

  if (filterState.nature) {
    const nature = normalized(row.querySelector('.israa-v2__nature')?.textContent);
    if (nature !== normalized(filterState.nature)) return false;
  }

  return true;
}

function setSelectOptions(select, values, allLabel, selectedValue) {
  if (!select) return;
  const unique = [...new Set(values.map(clean).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
  const options = [`<option value="">${escapeHtml(allLabel)}</option>`]
    .concat(unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
  select.innerHTML = options.join('');
  select.value = unique.includes(selectedValue) ? selectedValue : '';
}

function collectFilterValues(table, headerMap) {
  const rows = [...table.querySelectorAll('tbody > tr.israa-v2__row[data-v2-row-id]')]
    .filter((row) => row.dataset.v2RowId !== '__new__');

  return {
    statuses: rows.map((row) => cellText(row, headerMap, 'סטטוס')),
    probabilities: rows
      .map((row) => cellText(row, headerMap, 'סבירות').replace(/[^0-9]/g, ''))
      .filter(Boolean)
      .map((value) => `${value}%`),
    natures: rows.map((row) => clean(row.querySelector('.israa-v2__nature')?.textContent))
  };
}

function applyFilters(container) {
  const table = container.querySelector('.israa-v2__table');
  const filters = container.querySelector(`[${FILTERS_ATTR}]`);
  if (!table || !filters) return;

  const headerMap = getHeaderMap(table);
  const rows = [...table.querySelectorAll('tbody > tr.israa-v2__row[data-v2-row-id]')]
    .filter((row) => row.dataset.v2RowId !== '__new__');

  let visible = 0;
  rows.forEach((row) => {
    const matches = rowMatches(row, headerMap);
    row.hidden = !matches;
    if (matches) visible += 1;

    const rowId = row.dataset.v2RowId;
    if (rowId) {
      const detail = table.querySelector(`tbody > tr.israa-v2__detail[data-v2-detail-for="${CSS.escape(rowId)}"]`);
      if (detail) detail.hidden = !matches;
    }
  });

  let emptyRow = table.querySelector('tbody > tr.israa-v2__filter-empty');
  if (rows.length > 0 && visible === 0) {
    if (!emptyRow) {
      emptyRow = document.createElement('tr');
      emptyRow.className = 'israa-v2__filter-empty';
      emptyRow.innerHTML = `<td colspan="${table.querySelectorAll('thead th').length}">לא נמצאו תוצאות התואמות לחיפוש ולסינון.</td>`;
      table.tBodies[0]?.appendChild(emptyRow);
    }
    emptyRow.hidden = false;
  } else if (emptyRow) {
    emptyRow.remove();
  }

  const count = filters.querySelector('[data-israa-v2-filter-count]');
  if (count) count.textContent = `${visible} מתוך ${rows.length}`;
}

function bindFilters(container, shell) {
  if (shell.dataset.bound === 'true') return;
  shell.dataset.bound = 'true';

  const queryInput = shell.querySelector('[data-israa-v2-filter-query]');
  const statusSelect = shell.querySelector('[data-israa-v2-filter-status]');
  const probabilitySelect = shell.querySelector('[data-israa-v2-filter-probability]');
  const natureSelect = shell.querySelector('[data-israa-v2-filter-nature]');
  const resetButton = shell.querySelector('[data-israa-v2-filter-reset]');

  queryInput?.addEventListener('input', () => {
    filterState.query = queryInput.value;
    applyFilters(container);
  });

  statusSelect?.addEventListener('change', () => {
    filterState.status = statusSelect.value;
    applyFilters(container);
  });

  probabilitySelect?.addEventListener('change', () => {
    filterState.probability = probabilitySelect.value.replace(/[^0-9]/g, '');
    applyFilters(container);
  });

  natureSelect?.addEventListener('change', () => {
    filterState.nature = natureSelect.value;
    applyFilters(container);
  });

  resetButton?.addEventListener('click', () => {
    filterState.query = '';
    filterState.status = '';
    filterState.probability = '';
    filterState.nature = '';
    if (queryInput) queryInput.value = '';
    if (statusSelect) statusSelect.value = '';
    if (probabilitySelect) probabilitySelect.value = '';
    if (natureSelect) natureSelect.value = '';
    applyFilters(container);
  });
}

function enhanceContainer(container) {
  const table = container.querySelector('.israa-v2__table');
  const toolbar = container.querySelector('.israa-v2__toolbar');
  if (!table || !toolbar) return;

  let shell = container.querySelector(`[${FILTERS_ATTR}]`);
  if (!shell) {
    shell = document.createElement('div');
    shell.className = 'israa-v2__filters-shell';
    shell.setAttribute(FILTERS_ATTR, 'true');
    shell.innerHTML = `
      <div class="israa-v2__filters" role="search" aria-label="חיפוש וסינון בטבלת המעקב">
        <label class="israa-v2__filter-search">
          <span class="israa-v2__filter-search-icon" aria-hidden="true">⌕</span>
          <input type="search" data-israa-v2-filter-query autocomplete="off"
            placeholder="חיפוש: בית ספר, רשות, מספר הצעה, תוכנית או גפ״ן">
        </label>
        <select class="israa-v2__filter-select israa-v2__filter-select--status" data-israa-v2-filter-status aria-label="סינון לפי סטטוס"></select>
        <select class="israa-v2__filter-select israa-v2__filter-select--probability" data-israa-v2-filter-probability aria-label="סינון לפי סבירות"></select>
        <select class="israa-v2__filter-select israa-v2__filter-select--nature" data-israa-v2-filter-nature aria-label="סינון לפי אופי ההצעה"></select>
        <button type="button" class="israa-v2__filter-reset" data-israa-v2-filter-reset>ניקוי</button>
        <span class="israa-v2__filter-count" data-israa-v2-filter-count></span>
      </div>
    `;
    toolbar.insertAdjacentElement('afterend', shell);
    bindFilters(container, shell);
  }

  const queryInput = shell.querySelector('[data-israa-v2-filter-query]');
  if (queryInput && queryInput.value !== filterState.query) queryInput.value = filterState.query;

  const headerMap = getHeaderMap(table);
  const values = collectFilterValues(table, headerMap);
  setSelectOptions(
    shell.querySelector('[data-israa-v2-filter-status]'),
    values.statuses,
    'כל הסטטוסים',
    filterState.status
  );
  setSelectOptions(
    shell.querySelector('[data-israa-v2-filter-probability]'),
    values.probabilities,
    'כל הסבירויות',
    filterState.probability ? `${filterState.probability}%` : ''
  );
  setSelectOptions(
    shell.querySelector('[data-israa-v2-filter-nature]'),
    values.natures,
    'כל סוגי ההצעה',
    filterState.nature
  );

  applyFilters(container);
}

function run() {
  injectStyles();
  document.querySelectorAll(CONTAINER_SELECTOR).forEach(enhanceContainer);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
} else {
  schedule();
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('resize', schedule, { passive: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('israa-tracking-updated', schedule);
