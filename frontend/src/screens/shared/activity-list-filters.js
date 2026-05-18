import { escapeHtml } from './html.js';

export const MIN_SEARCH_CHARS = 1;
export const SEARCH_DEBOUNCE_MS = 150;
const DEFAULT_SEARCH_DEBOUNCE_MS = SEARCH_DEBOUNCE_MS;
const DEFAULT_VISIBLE_LIMIT = 200;
const FILTER_OPTIONS_CACHE = new WeakMap();
const SEARCH_FIELDS_IDS = new WeakMap();
let searchFieldsIdSeq = 0;

function searchFieldsKey(fields) {
  if (!Array.isArray(fields)) return 'default';
  let id = SEARCH_FIELDS_IDS.get(fields);
  if (!id) {
    id = `fields:${++searchFieldsIdSeq}`;
    SEARCH_FIELDS_IDS.set(fields, id);
  }
  return id;
}

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
  const fieldsKey = searchFieldsKey(fields);
  list.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    if (row.__searchFieldsKey === fieldsKey && typeof row.__searchText === 'string') return;
    const searchText = buildSearchText(row, fields);
    try {
      Object.defineProperty(row, '__searchText', { value: searchText, writable: true, configurable: true });
      Object.defineProperty(row, '__searchFieldsKey', { value: fieldsKey, writable: true, configurable: true });
    } catch (_) {
      row.__searchText = searchText;
      row.__searchFieldsKey = fieldsKey;
    }
  });
  return list;
}

export function ensureActivityListFilters(state, scope) {
  state.listFilters = state.listFilters || {};
  state.listFilters[scope] = state.listFilters[scope] || { q: '', appliedQ: '', visibleCount: DEFAULT_VISIBLE_LIMIT };
  if (!Object.prototype.hasOwnProperty.call(state.listFilters[scope], 'appliedQ')) {
    const q = normalizeText(state.listFilters[scope].q || '');
    state.listFilters[scope].appliedQ = q.length >= MIN_SEARCH_CHARS ? state.listFilters[scope].q : '';
  }
  if (typeof state.listFilters[scope].visibleCount !== 'number') {
    state.listFilters[scope].visibleCount = DEFAULT_VISIBLE_LIMIT;
  }
  return state.listFilters[scope];
}

export function collectFilterOptions(rows, fields) {
  const list = Array.isArray(rows) ? rows : [];
  const normalizedFields = Array.isArray(fields) ? fields : [];
  let perRowsCache = FILTER_OPTIONS_CACHE.get(list);
  if (!perRowsCache) {
    perRowsCache = new WeakMap();
    FILTER_OPTIONS_CACHE.set(list, perRowsCache);
  } else {
    const cached = perRowsCache.get(normalizedFields);
    if (cached) return cached;
  }

  const result = {};
  normalizedFields.forEach((field) => {
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
  perRowsCache.set(normalizedFields, result);
  return result;
}

export function applyLocalFilters(rows, filters, config = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const scoped = filters || {};
  const rawSearch = Object.prototype.hasOwnProperty.call(scoped, 'appliedQ') ? scoped.appliedQ : scoped.q;
  const normalizedSearch = normalizeText(rawSearch || '');
  const search = normalizedSearch.length >= MIN_SEARCH_CHARS ? normalizedSearch : '';
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
        optionsMap[k] = Array.from(new Set([...(optionsMap[k] || []), ...config.optionsOverrides[k]]))
          .sort((a, b) => a.localeCompare(b, 'he'));
      }
    });
  }

  const showSearch = config.search !== false;
  const showClear = config.clear !== false;
  const searchPlaceholder = config.searchPlaceholder || 'חיפוש…';

  const isPanel = config.layout === 'panel';
  if (isPanel) {
    return `<section class="ds-filter-panel ds-filter-panel--grid-only" dir="rtl" data-local-filters="${escapeHtml(scope)}">
      <div class="ds-filter-panel__grid">
        ${filterFields.map((field) => selectInlineHtml(scope, field, filters, optionsMap)).join('')}
      </div>
    </section>`;
  }

  if (config.bare) {
    return filterFields.map((field) => selectInlineHtml(scope, field, filters, optionsMap)).join('');
  }

  return `<div class="ds-toolbar ds-toolbar--filters-inline" dir="rtl" data-local-filters="${escapeHtml(scope)}">
    ${showSearch ? `<input type="search" class="ds-input ds-input--sm ds-filter-search-sm" data-filter-search="${escapeHtml(scope)}" value="${escapeHtml(filters.q || '')}" placeholder="${escapeHtml(searchPlaceholder)}" />` : ''}
    ${filterFields.map((field) => selectInlineHtml(scope, field, filters, optionsMap)).join('')}
    ${showClear ? `<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-filter-clear="${escapeHtml(scope)}">ניקוי</button>` : ''}
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
    const cursorPos = ev.target?.selectionStart ?? nextValue.length;
    clearTimeout(searchTimer);

    // Keep the typed value in state immediately and debounce only the local
    // filtering/rerendering work so one-character searches feel responsive.
    filters.q = nextValue;

    const apply = () => {
      filters.appliedQ = nextValue;
      filters.visibleCount = DEFAULT_VISIBLE_LIMIT;
      rerender();
      const newInput = root.querySelector(`[data-filter-search="${scope}"]`);
      if (newInput) {
        newInput.focus();
        try { newInput.setSelectionRange(cursorPos, cursorPos); } catch (_) {}
      }
    };

    const trimmedLength = normalizeText(nextValue).length;
    if (trimmedLength === 0 || debounceMs <= 0) {
      apply();
      return;
    }
    searchTimer = setTimeout(apply, debounceMs);
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
    state.listFilters[scope] = { q: '', appliedQ: '', visibleCount: typeof prevVisibleCount === 'number' ? prevVisibleCount : DEFAULT_VISIBLE_LIMIT };
    if (typeof options.onClear === 'function') options.onClear();
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
