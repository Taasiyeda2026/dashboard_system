import {
  getActivityNamesForType,
  humanDisplayText,
  normalizeActivityTypeKey
} from './screens/shared/activity-options.js';

const ENHANCED_ATTR = 'data-activity-drawer-inline-layout';
const POLISHED_ATTR = 'data-activity-drawer-edit-dedup';
const INITIAL_REFRESH_GUARD_ATTR = 'data-activity-initial-refresh-guard';
const TEST_FLAG = '__ACTIVITY_DRAWER_EDIT_DEDUP_TEST__';
const GENERIC_ONE_DAY_ACTIVITY_NAMES = new Set(['סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה']);

const SEASON_OPTIONS = [
  { value: 'regular', label: '2026' },
  { value: 'school_2027', label: '2027' }
];

function clean(value) {
  return humanDisplayText(value);
}

function labelKey(value) {
  return clean(value).toLocaleLowerCase('he-IL');
}

function parseExportRow(form) {
  try {
    return JSON.parse(form?.dataset?.exportRow || '{}') || {};
  } catch {
    return {};
  }
}

function normalizeSeason(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'school_2027' || raw === '2027') return 'school_2027';
  if (raw === 'summer_2026' || raw === 'summer' || raw === 'קיץ 2026') return 'summer_2026';
  return 'regular';
}

function rebuildSeasonSelect(form, row) {
  const select = form.querySelector('[name="activity_season"]');
  if (!select) return false;

  const selectedSeason = normalizeSeason(row.activity_season || select.value);
  const options = SEASON_OPTIONS.slice();
  if (selectedSeason === 'summer_2026') {
    options.splice(1, 0, { value: 'summer_2026', label: 'קיץ 2026' });
  }

  select.replaceChildren(...options.map(({ value, label }) => {
    const option = form.ownerDocument.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedSeason;
    return option;
  }));
  select.value = selectedSeason;
  return true;
}

function dedupeCatalogItems(items, currentActivityNo) {
  const byLabel = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const label = clean(item?.label || item?.activity_name || item?.value);
    if (!label) return;
    const key = labelKey(label);
    const candidate = {
      label,
      activity_no: String(item?.activity_no || '').trim(),
      activity_type: normalizeActivityTypeKey(item?.activity_type || item?.parent_value || item?.type)
    };
    const existing = byLabel.get(key);
    if (!existing || (currentActivityNo && candidate.activity_no === currentActivityNo)) {
      byLabel.set(key, candidate);
    }
  });
  return [...byLabel.values()];
}

function rebuildActivityNameSelect(form, settings, row) {
  const select = form.querySelector('[data-role="activity-name-select"], [name="activity_name"]');
  const typeSelect = form.querySelector('[name="activity_type"]');
  if (!select || !typeSelect) return false;

  const currentName = clean(select.value || row.activity_name || row.program_name || row.title || row.name);
  const currentActivityNo = String(form.querySelector('[name="activity_no"]')?.value || row.activity_no || '').trim();
  const activityType = normalizeActivityTypeKey(typeSelect.value || row.activity_type || row.item_type);
  const catalogItems = dedupeCatalogItems(getActivityNamesForType(settings || {}, activityType), currentActivityNo);

  if (currentName && !catalogItems.some((item) => labelKey(item.label) === labelKey(currentName))) {
    catalogItems.unshift({
      label: currentName,
      activity_no: currentActivityNo,
      activity_type: activityType
    });
  }

  const placeholder = form.ownerDocument.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '—';

  const options = catalogItems.map((item) => {
    const option = form.ownerDocument.createElement('option');
    option.value = item.label;
    option.textContent = item.label;
    option.dataset.activityNo = item.activity_no;
    option.dataset.activityType = item.activity_type || activityType;
    option.selected = labelKey(item.label) === labelKey(currentName);
    return option;
  });

  select.replaceChildren(placeholder, ...options);
  select.value = currentName;
  select.disabled = !activityType;
  return true;
}

export function guardInitialValueRefreshWhileEditing(form) {
  if (!form || form.hasAttribute(INITIAL_REFRESH_GUARD_ATTR)) return false;
  const refreshInitialValues = form._refreshInitialValues;
  if (typeof refreshInitialValues !== 'function') return false;

  form._refreshInitialValues = (...args) => {
    if (String(form.dataset.editing || '') === 'yes') return form._initialValues;
    return refreshInitialValues(...args);
  };
  form.setAttribute(INITIAL_REFRESH_GUARD_ATTR, 'true');
  return true;
}

export function primeLegacyActivityNameForSave(form, row = parseExportRow(form)) {
  const select = form?.querySelector?.('[data-role="activity-name-select"], [name="activity_name"]');
  const selectedName = clean(select?.value);
  const storedName = clean(row?.activity_name);
  const initialValues = form?._initialValues;

  if (!selectedName || !storedName) return false;
  if (!GENERIC_ONE_DAY_ACTIVITY_NAMES.has(storedName)) return false;
  if (GENERIC_ONE_DAY_ACTIVITY_NAMES.has(selectedName)) return false;
  if (!initialValues || typeof initialValues !== 'object') return false;

  // Legacy rows may store only "סיור"/"סדנה" while the visible catalog choice
  // comes from program_name. Mark the real selected name as a change so the
  // save payload repairs activity_name before backend one-day validation runs.
  initialValues.activity_name = storedName;
  return true;
}

export function polishActivityDrawerEditOptions(form, settings = {}) {
  if (!form || !form.hasAttribute(ENHANCED_ATTR)) return false;
  if (form.hasAttribute(POLISHED_ATTR)) return false;

  const row = parseExportRow(form);
  rebuildSeasonSelect(form, row);
  rebuildActivityNameSelect(form, settings, row);
  guardInitialValueRefreshWhileEditing(form);

  const typeSelect = form.querySelector('[name="activity_type"]');
  if (typeSelect && !form.dataset.activityNameType) {
    form.dataset.activityNameType = normalizeActivityTypeKey(typeSelect.value);
  }
  typeSelect?.addEventListener('change', () => {
    const nextType = normalizeActivityTypeKey(typeSelect.value);
    const previousType = normalizeActivityTypeKey(form.dataset.activityNameType);
    if (nextType === previousType) return;

    // A genuine type change must not carry a legacy name/activity_no into the
    // new type. Clear both the live controls and every row fallback before the
    // polished catalog is rebuilt. The shared type marker is advanced only
    // after this reset, so the second form-level listener safely no-ops.
    const nameSelect = form.querySelector('[data-role="activity-name-select"], [name="activity_name"]');
    if (nameSelect) nameSelect.value = '';
    const activityNoInput = form.querySelector('[name="activity_no"], [data-activity-no]');
    if (activityNoInput) activityNoInput.value = '';
    rebuildActivityNameSelect(form, settings, {
      ...row,
      activity_type: nextType,
      item_type: nextType,
      activity_name: '',
      program_name: '',
      title: '',
      name: '',
      activity_no: ''
    });
    form.dataset.activityNameType = nextType;
  });

  form.addEventListener('click', (event) => {
    // bindActivityEditForm assigns _refreshInitialValues during drawer setup.
    // Re-check on interaction so the guard is installed even if polishing ran first.
    guardInitialValueRefreshWhileEditing(form);
    if (event.target?.closest?.('[data-action="save-edit"]')) {
      primeLegacyActivityNameForSave(form, row);
    }
  }, true);

  form.setAttribute(POLISHED_ATTR, 'true');
  return true;
}

export function polishActivityDrawerEditOptionsIn(root = document, settings = {}) {
  root.querySelectorAll?.(`[data-drawer-form][${ENHANCED_ATTR}]`).forEach((form) => {
    polishActivityDrawerEditOptions(form, settings);
  });
}
