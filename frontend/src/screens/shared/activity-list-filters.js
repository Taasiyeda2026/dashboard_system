import { escapeHtml } from './html.js';

const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_VISIBLE_LIMIT = 200;

export function normalizeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildSearchText(row, fields) {
  const keys = Array.isArray(fields) ? fields : [];
  return normalizeText(
    keys
      .map((field) => {
        if (typeof field === 'function') return field(row);
        return row?.[field];
      })
      .filter(Boolean)
      .join(' ')
  );
}

export function prepareRowsForSearch(rows, fields) {
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    if (!row.__searchText) row.__searchText = buildSearchText(row, fields);
  });
  return list;
}

export function ensureActivityListFilters(state, scope) {
  state.listFilters = state.listFilters || {};
  state.listFilters[scope] = state.listFilters[scope] || { q: '', visibleCount: DEFAULT_VISIBLE_LIMIT };
  if (typeof state.listFilters[scope].visibleCount !== 'number') {
    state.listFilters[scope].visibleCount = DEFAULT_VISIBLE_LIMIT;
  }
  return state.listFilters[scope];
}

export function collectFilterOptions(rows, fields) {
  const result = {};
  const list = Array.isArray(rows) ? rows : [];
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = field.key;
    const values = new Set();
    list.forEach((row) => {
      const rawValues = typeof field.getValues === 'function' ? field.getValues(row) : [row?.[key]];
      (Array.isArray(rawValues) ? rawValues : [rawValues]).forEach((value) => {
        const text = String(value || '').trim();
        if (text) values.add(text);
      });
    });
    result[key] = Array.from(values).sort((a, b) => a.localeCompare(b, 'he'));
  });
  return result;
}

export function applyLocalFilters(rows, filters, config = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const scoped = filters || {};
  const search = normalizeText(scoped.q || '');
  const filterFields = Array.isArray(config.filterFields) ? config.filterFields : [];

  return list.filter((row) => {
    if (search && !String(row?.__searchText || '').includes(search)) return false;
    for (const field of filterFields) {
      const selected = String(scoped[field.key] || '').trim();
      if (!selected) continue;
      const values = typeof field.getValues === 'function' ? field.getValues(row) : [row?.[field.key]];
      const ok = (Array.isArray(values) ? values : [values]).some((value) => String(value || '').trim() === selected);
      if (!ok) return false;
    }
    return true;
  });
}

function selectHtml(scope, field, filters, optionsMap) {
  const selected = String(filters?.[field.key] || '');
  const options = optionsMap?.[field.key] || [];
  return `<label class="ds-filter-field">
    <span class="ds-filter-field__label">${escapeHtml(field.label)}</span>
    <select class="ds-input ds-input--sm" data-filter-scope="${escapeHtml(scope)}" data-filter-field="${escapeHtml(field.key)}">
      <option value="">הכל</option>
      ${options
    .map((value) => {
      const label = typeof field.getOptionLabel === 'function' ? field.getOptionLabel(value) : value;
      return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('')}
    </select>
  </label>`;
}

function selectInlineHtml(scope, field, filters, optionsMap) {
  const selected = String(filters?.[field.key] || '');
  const options = optionsMap?.[field.key] || [];
  return `<select class="ds-input ds-input--sm ds-filter-select-inline${selected ? ' is-active' : ''}" data-filter-scope="${escapeHtml(scope)}" data-filter-field="${escapeHtml(field.key)}" title="${escapeHtml(field.label)}">
    <option value="">${escapeHtml(field.label)}</option>
    ${options.map((value) => {
      const label = typeof field.getOptionLabel === 'function' ? field.getOptionLabel(value) : value;
      return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('')}
  </select>`;
}

export function filtersToolbarHtml(scope, rows, state, config = {}) {
  const filters = ensureActivityListFilters(state, scope);
  const filterFields = Array.isArray(config.filterFields) ? config.filterFields : [];
  const optionsMap = collectFilterOptions(rows, filterFields);

  if (config.optionsOverrides && typeof config.optionsOverrides === 'object') {
    Object.keys(config.optionsOverrides).forEach((k) => {
      if (Array.isArray(config.optionsOverrides[k]) && config.optionsOverrides[k].length) {
        optionsMap[k] = config.optionsOverrides[k];
      }
    });
  }

  const showSearch = config.search !== false;
  const searchPlaceholder = config.searchPlaceholder || 'חיפוש…';

  const isPanel = config.layout === 'panel';
  if (isPanel) {
    return `<section class="ds-filter-panel ds-filter-panel--grid-only" dir="rtl" data-local-filters="${escapeHtml(scope)}">
      <div class="ds-filter-panel__grid">
        ${filterFields.map((field) => selectInlineHtml(scope, field, filters, optionsMap)).join('')}
      </div>
    </section>`;
  }

  return `<div class="ds-toolbar ds-toolbar--filters-inline" dir="rtl" data-local-filters="${escapeHtml(scope)}">
    ${showSearch ? `<input type="search" class="ds-input ds-input--sm ds-filter-search-sm" data-filter-search="${escapeHtml(scope)}" value="${escapeHtml(filters.q || '')}" placeholder="${escapeHtml(searchPlaceholder)}" />` : ''}
    ${filterFields.map((field) => selectInlineHtml(scope, field, filters, optionsMap)).join('')}
    <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-filter-clear="${escapeHtml(scope)}">ניקוי</button>
  </div>`;
}

export function bindLocalFilters(root, state, scope, rerender, options = {}) {
  const filters = ensureActivityListFilters(state, scope);
  const searchInput = root.querySelector(`[data-filter-search="${scope}"]`);
  const clearBtn = root.querySelector(`[data-filter-clear="${scope}"]`);
  const debounceMs = Number(options.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS);

  let searchTimer;
  searchInput?.addEventListener('input', (ev) => {
    const nextValue = ev.target?.value || '';
    if (nextValue === String(filters.q || '')) return;
    clearTimeout(searchTimer);
    const apply = () => {
      filters.q = nextValue;
      filters.visibleCount = DEFAULT_VISIBLE_LIMIT;
      rerender();
    };
    if (debounceMs <= 0) apply();
    else searchTimer = setTimeout(apply, debounceMs);
  });

  root.querySelectorAll(`[data-filter-scope="${scope}"][data-filter-field]`).forEach((node) => {
    node.addEventListener('change', (ev) => {
      const field = ev.target?.dataset?.filterField;
      if (!field) return;
      state.listFilters[scope][field] = ev.target?.value || '';
      state.listFilters[scope].visibleCount = DEFAULT_VISIBLE_LIMIT;
      rerender();
    });
  });

  clearBtn?.addEventListener('click', () => {
    const prevVisibleCount = state.listFilters?.[scope]?.visibleCount;
    state.listFilters[scope] = { q: '', visibleCount: typeof prevVisibleCount === 'number' ? prevVisibleCount : DEFAULT_VISIBLE_LIMIT };
    rerender();
  });
}

export function splitVisibleRows(rows, filters, limit = DEFAULT_VISIBLE_LIMIT) {
  const visibleLimit = Math.max(150, Math.min(200, Number(limit || filters?.visibleCount || DEFAULT_VISIBLE_LIMIT)));
  const visibleCount = Number(filters?.visibleCount || visibleLimit);
  const list = Array.isArray(rows) ? rows : [];
  return {
    visible: list.slice(0, visibleCount),
    hasMore: list.length > visibleCount,
    total: list.length,
    visibleCount,
    nextCount: visibleCount + visibleLimit
  };
}
