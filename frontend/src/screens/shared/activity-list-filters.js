import { escapeHtml } from './html.js';

export const MIN_SEARCH_CHARS = 1;
export const SEARCH_DEBOUNCE_MS = 150;
const DEFAULT_SEARCH_DEBOUNCE_MS = SEARCH_DEBOUNCE_MS;
const DEFAULT_VISIBLE_LIMIT = 200;
const OPERATIONS_MANAGEMENT_STATUS_OPTIONS = ['פתוח', 'סגור'];
const OPERATIONS_MANAGEMENT_EXCLUDED_STATUSES = ['בוטל', 'cancelled', 'canceled'];
const OPERATIONS_AUTHORITIES_TAB = 'authorities';
const OPERATIONS_SUMMER_SEASON = 'summer_2026';
const OPERATIONS_SUMMER_FROM = '2026-06-15';
const OPERATIONS_SUMMER_TO = '2026-08-31';
const FILTER_OPTIONS_CACHE = new WeakMap();
const SEARCH_FIELDS_IDS = new WeakMap();
let searchFieldsIdSeq = 0;

// The operations screen historically treats an empty status as "use the default",
// while the status select also uses an empty value for "הכל". This truthy object
// stringifies to an empty string, so the screen preserves the explicit "all"
// selection without changing its public filtering contract.
const OPERATIONS_ALL_STATUS = Object.freeze({
  toString: () => '',
  valueOf: () => ''
});

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
    .normalize('NFKC')
    .replace(/[\u05F3\u05F4'"`´”“„״׳]/g, '')
    .replace(/[\u2010-\u2015\u2212\-_/\\]+/g, ' ')
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
  const filters = state.listFilters[scope];

  if (scope === 'operations-management') {
    // Convert only an explicitly selected empty status to the all-status marker.
    // A missing status property is left untouched so the operations screen may
    // still apply its initial default of "פתוח".
    if (Object.prototype.hasOwnProperty.call(filters, 'status') && filters.status === '') {
      filters.status = OPERATIONS_ALL_STATUS;
    }
    filters.optionOverrides = {
      ...(filters.optionOverrides || {}),
      status: OPERATIONS_MANAGEMENT_STATUS_OPTIONS
    };
    filters.excludedValues = {
      ...(filters.excludedValues || {}),
      status: OPERATIONS_MANAGEMENT_EXCLUDED_STATUSES
    };

    const isAuthoritiesTab = state?.operationsManagement?.tab === OPERATIONS_AUTHORITIES_TAB;
    if (isAuthoritiesTab) {
      filters.requiredActivitySeason = OPERATIONS_SUMMER_SEASON;
      state.operationsManagement.period = 'regular';
      state.operationsManagement.dateFrom = OPERATIONS_SUMMER_FROM;
      state.operationsManagement.dateTo = OPERATIONS_SUMMER_TO;
    } else {
      delete filters.requiredActivitySeason;
    }
  }

  if (!Object.prototype.hasOwnProperty.call(filters, 'appliedQ')) {
    const q = normalizeText(filters.q || '');
    filters.appliedQ = q.length >= MIN_SEARCH_CHARS ? filters.q : '';
  }
  if (typeof filters.visibleCount !== 'number') {
    filters.visibleCount = DEFAULT_VISIBLE_LIMIT;
  }
  return filters;
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

const DEPENDENT_EXCLUDE = new Set(['-', 'לא משויך', 'ללא שיוך']);

function rowMatchesRequiredActivitySeason(row, filters) {
  const requiredSeason = String(filters?.requiredActivitySeason || '').trim().toLowerCase();
  if (!requiredSeason) return true;

  const activitySeason = String(row?.activity_season ?? row?.activitySeason ?? '').trim().toLowerCase();
  if (activitySeason === requiredSeason || (requiredSeason === OPERATIONS_SUMMER_SEASON && activitySeason === 'summer')) return true;

  const rowId = String(row?.row_id ?? row?.RowID ?? row?.id ?? '').trim().toLowerCase();
  return requiredSeason === OPERATIONS_SUMMER_SEASON && rowId.startsWith('summer_');
}

function rowPassesConfiguredExclusions(row, filters) {
  if (!rowMatchesRequiredActivitySeason(row, filters)) return false;

  const excludedValues = filters?.excludedValues;
  if (!excludedValues || typeof excludedValues !== 'object') return true;

  return Object.entries(excludedValues).every(([key, rawValues]) => {
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const blocked = new Set(values.map(normalizeText).filter(Boolean));
    return !blocked.has(normalizeText(row?.[key]));
  });
}

/**
 * Builds filter options where each field's options come from rows that pass
 * all OTHER active filters (and the active free-text search), so the user
 * never sees values that would yield empty results.
 */
export function collectDependentFilterOptions(rows, filterFields, activeFilters, searchText) {
  const list = Array.isArray(rows) ? rows : [];
  const fields = Array.isArray(filterFields) ? filterFields : [];
  const filters = activeFilters || {};
  const search = normalizeText(searchText || '');

  const result = {};
  fields.forEach((field) => {
    const overrideValues = filters?.optionOverrides?.[field.key];
    if (Array.isArray(overrideValues)) {
      result[field.key] = Array.from(new Set(
        overrideValues
          .map((value) => String(value || '').trim())
          .filter((value) => value && !DEPENDENT_EXCLUDE.has(value))
      ));
      return;
    }

    const subset = list.filter((row) => {
      if (!rowPassesConfiguredExclusions(row, filters)) return false;
      if (search && !String(row?.__searchText || '').includes(search)) return false;
      for (const f of fields) {
        if (f.key === field.key) continue;
        const selected = String(filters[f.key] || '').trim();
        if (!selected) continue;
        const vals = typeof f.getValues === 'function' ? f.getValues(row) : [row?.[f.key]];
        const ok = (Array.isArray(vals) ? vals : [vals]).some((v) => String(v || '').trim() === selected);
        if (!ok) return false;
      }
      return true;
    });

    const values = new Set();
    subset.forEach((row) => {
      const rawVals = typeof field.getValues === 'function' ? field.getValues(row) : [row?.[field.key]];
      (Array.isArray(rawVals) ? rawVals : [rawVals]).forEach((value) => {
        const text = String(value || '').trim();
        if (text && !DEPENDENT_EXCLUDE.has(text)) values.add(text);
      });
    });
    result[field.key] = Array.from(values).sort((a, b) => a.localeCompare(b, 'he'));
  });
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
    if (!rowPassesConfiguredExclusions(row, scoped)) return false;
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

  let optionsMap;
  if (config.dependent) {
    const searchText = Object.prototype.hasOwnProperty.call(filters, 'appliedQ') ? filters.appliedQ : (filters.q || '');
    optionsMap = collectDependentFilterOptions(rows, filterFields, filters, searchText);
    filterFields.forEach((field) => {
      const selected = String(filters[field.key] || '').trim();
      if (selected && !(optionsMap[field.key] || []).includes(selected)) {
        filters[field.key] = '';
      }
    });
  } else {
    optionsMap = collectFilterOptions(rows, filterFields);
    if (config.optionsOverrides && typeof config.optionsOverrides === 'object') {
      Object.keys(config.optionsOverrides).forEach((key) => {
        if (Array.isArray(config.optionsOverrides[key]) && config.optionsOverrides[key].length) {
          optionsMap[key] = Array.from(new Set([...(optionsMap[key] || []), ...config.optionsOverrides[key]]))
            .sort((a, b) => a.localeCompare(b, 'he'));
        }
      });
    }
  }

  const showSearch = config.search !== false;
  const showClear = config.clear !== false;
  const searchPlaceholder = config.searchPlaceholder || 'חיפוש…';

  if (config.layout === 'panel') {
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
  searchInput?.addEventListener('input', (event) => {
    const nextValue = event.target?.value || '';
    const cursorPos = event.target?.selectionStart ?? nextValue.length;
    clearTimeout(searchTimer);
    filters.q = nextValue;

    const apply = () => {
      filters.appliedQ = nextValue;
      filters.visibleCount = DEFAULT_VISIBLE_LIMIT;
      rerender();
      const newInput = root.querySelector(`[data-filter-search="${scope}"]`);
      if (newInput) {
        newInput.focus();
        try { newInput.setSelectionRange(cursorPos, cursorPos); } catch (_) { /* ignore */ }
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
    node.addEventListener('change', (event) => {
      const field = event.target?.dataset?.filterField;
      if (!field) return;
      state.listFilters[scope][field] = event.target?.value || '';
      state.listFilters[scope].visibleCount = DEFAULT_VISIBLE_LIMIT;
      rerender();
    });
  });

  clearBtn?.addEventListener('click', () => {
    const prevVisibleCount = state.listFilters?.[scope]?.visibleCount;
    state.listFilters[scope] = {
      q: '',
      appliedQ: '',
      visibleCount: typeof prevVisibleCount === 'number' ? prevVisibleCount : DEFAULT_VISIBLE_LIMIT
    };
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
