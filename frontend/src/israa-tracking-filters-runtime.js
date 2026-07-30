const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const FILTERS_ATTR = 'data-israa-v2-filters';
const DEBOUNCE_MS = 70;

let timer = null;
const filterState = { query: '', authority: '', school: '', program: '', status: '' };

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
    .israa-v2__filters-shell{width:100%;max-width:100%;min-width:0;margin:0 0 10px;overflow:visible;box-sizing:border-box}
    .israa-v2__filters{width:100%;min-width:0;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 8px;border:1px solid #dbe3ec;border-radius:9px;background:#fff;white-space:nowrap;overflow:hidden}
    .israa-v2__filter-query,.israa-v2__filter-select{flex:0 1 auto;min-width:0;height:32px;padding:0 9px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#334155;font:inherit;font-size:12px;box-sizing:border-box}
    .israa-v2__filter-query{width:260px}.israa-v2__filter-select[data-israa-v2-filter-authority]{width:155px}.israa-v2__filter-select[data-israa-v2-filter-school]{width:165px}.israa-v2__filter-select[data-israa-v2-filter-program]{width:165px}.israa-v2__filter-select[data-israa-v2-filter-status]{width:135px}
    .israa-v2__filter-query:focus,.israa-v2__filter-select:focus{outline:0;border-color:#0891b2;box-shadow:0 0 0 2px rgba(8,145,178,.12)}
    .israa-v2__filter-reset{flex:0 0 auto;width:fit-content;height:32px;padding:0 9px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;color:#475569;font:inherit;font-size:12px;font-weight:750;cursor:pointer}
    .israa-v2__filter-reset:hover{background:#f1f5f9}.israa-v2__filter-empty td{padding:24px!important;text-align:center;color:#64748b;background:#fff}
    @media(max-width:760px){.israa-v2__filters{white-space:normal;overflow:visible}.israa-v2__filter-query{width:min(100%,260px)}}
  `;
  document.head.appendChild(style);
}

function getHeaderMap(table) {
  const map = new Map();
  table.querySelectorAll('thead th').forEach((th, index) => map.set(clean(th.textContent), index));
  return map;
}

function headerIndex(headerMap, label) {
  if (headerMap.has(label)) return headerMap.get(label);
  if (label === 'שם בית הספר' && headerMap.has('בית ספר')) return headerMap.get('בית ספר');
  if (label === 'שם הפעילות' && headerMap.has('תוכניות')) return headerMap.get('תוכניות');
  return null;
}

function cellText(row, headerMap, label) {
  const index = headerIndex(headerMap, label);
  if (index == null) return '';
  return clean(row.cells?.[index]?.textContent);
}

function programNames(row) {
  const indexed = clean(row.dataset.v2Programs);
  if (indexed) return indexed.split('|').map(clean).filter(Boolean);
  return [clean(row.textContent)].filter(Boolean);
}

function rowMatches(row, headerMap) {
  if (filterState.query && !normalized(row.dataset.v2SearchText).includes(normalized(filterState.query))) return false;
  if (filterState.authority && normalized(cellText(row, headerMap, 'רשות')) !== normalized(filterState.authority)) return false;
  if (filterState.school && normalized(cellText(row, headerMap, 'שם בית הספר')) !== normalized(filterState.school)) return false;
  if (filterState.program && !programNames(row).map(normalized).includes(normalized(filterState.program))) return false;
  if (filterState.status && normalized(cellText(row, headerMap, 'סטטוס')) !== normalized(filterState.status)) return false;
  return true;
}

function setSelectOptions(select, values, allLabel, selectedValue) {
  if (!select) return;
  const unique = [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  select.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join('');
  select.value = unique.includes(selectedValue) ? selectedValue : '';
}

function collectFilterValues(table, headerMap) {
  const tableRows = [...table.querySelectorAll('tbody > tr.israa-v2__row[data-v2-row-id]')];
  return {
    authorities: tableRows.map((row) => cellText(row, headerMap, 'רשות')),
    schools: tableRows.map((row) => cellText(row, headerMap, 'שם בית הספר')),
    programs: tableRows.flatMap(programNames),
    statuses: tableRows.map((row) => cellText(row, headerMap, 'סטטוס')),
  };
}

function applyFilters(container) {
  const table = container.querySelector('.israa-v2__table');
  const filters = container.querySelector(`[${FILTERS_ATTR}]`);
  if (!table || !filters) return;
  const headerMap = getHeaderMap(table);
  const tableRows = [...table.querySelectorAll('tbody > tr.israa-v2__row[data-v2-row-id]')];
  let visible = 0;
  tableRows.forEach((row) => {
    const matches = rowMatches(row, headerMap);
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  let emptyRow = table.querySelector('tbody > tr.israa-v2__filter-empty');
  if (tableRows.length && visible === 0) {
    if (!emptyRow) {
      emptyRow = document.createElement('tr');
      emptyRow.className = 'israa-v2__filter-empty';
      emptyRow.innerHTML = `<td colspan="${table.querySelectorAll('thead th').length}">לא נמצאו תוצאות התואמות לסינון.</td>`;
      table.tBodies[0]?.appendChild(emptyRow);
    }
    emptyRow.hidden = false;
  } else if (emptyRow) {
    emptyRow.remove();
  }
}

function bindFilters(container, shell) {
  if (shell.dataset.bound === 'true') return;
  shell.dataset.bound = 'true';
  shell.querySelector('[data-israa-v2-filter-query]')?.addEventListener('input', (event) => {
    filterState.query = event.target.value;
    applyFilters(container);
  });
  for (const key of ['authority', 'school', 'program', 'status']) {
    shell.querySelector(`[data-israa-v2-filter-${key}]`)?.addEventListener('change', (event) => {
      filterState[key] = event.target.value;
      applyFilters(container);
    });
  }
  shell.querySelector('[data-israa-v2-filter-reset]')?.addEventListener('click', () => {
    for (const key of Object.keys(filterState)) {
      filterState[key] = '';
      const control = shell.querySelector(`[data-israa-v2-filter-${key}]`);
      if (control) control.value = '';
    }
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
      <div class="israa-v2__filters" role="search" aria-label="סינון טבלת המעקב">
        <input class="israa-v2__filter-query" type="search" placeholder="חיפוש בעמוד" aria-label="חיפוש בעמוד" data-israa-v2-filter-query>
        <select class="israa-v2__filter-select" data-israa-v2-filter-authority aria-label="סינון לפי רשות"></select>
        <select class="israa-v2__filter-select" data-israa-v2-filter-school aria-label="סינון לפי בית ספר"></select>
        <select class="israa-v2__filter-select" data-israa-v2-filter-program aria-label="סינון לפי תוכנית"></select>
        <select class="israa-v2__filter-select" data-israa-v2-filter-status aria-label="סינון לפי סטטוס"></select>
        <button type="button" class="israa-v2__filter-reset" data-israa-v2-filter-reset>נקה סינון</button>
      </div>`;
    toolbar.insertAdjacentElement('afterend', shell);
    bindFilters(container, shell);
  }
  const headerMap = getHeaderMap(table);
  const values = collectFilterValues(table, headerMap);
  setSelectOptions(shell.querySelector('[data-israa-v2-filter-authority]'), values.authorities, 'כל הרשויות', filterState.authority);
  setSelectOptions(shell.querySelector('[data-israa-v2-filter-school]'), values.schools, 'כל בתי הספר', filterState.school);
  setSelectOptions(shell.querySelector('[data-israa-v2-filter-program]'), values.programs, 'כל הפעילויות', filterState.program);
  setSelectOptions(shell.querySelector('[data-israa-v2-filter-status]'), values.statuses, 'כל הסטטוסים', filterState.status);
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
else schedule();
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('resize', schedule, { passive: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('israa-tracking-updated', schedule);
