import { escapeHtml } from './shared/html.js';
import { exportActivitiesToExcel } from './shared/excel-export.js';
import { formatDateHe, formatActivityDateColumnsHe } from './shared/format-date.js';
import {
  hebrewColumn,
  visibleActivityCategoryLabel,
  ACTIVITY_TAB_ORDER
} from './shared/ui-hebrew.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState
} from './shared/layout.js';

import { activityWorkDrawerHtml, patchDrawerDatesSection } from './shared/activity-detail-html.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml,
  bindLocalFilters,
  splitVisibleRows
} from './shared/activity-list-filters.js';
import {
  activityManagerDisplayName,
  getActivityCatalog,
  getActivityTypesByFamily,
  getRosterUsers,
  activityTypeDisplayLabel,
  activityTypeMatches,
  normalizeActivityTypeKey,
  normalizeOneDayActivityType,
  getManagerUsers,
  getFilterOptionOverrides,
  cleanUnique,
  NO_ACTIVITY_MANAGER_LABEL
} from './shared/activity-options.js';
import { readActivitiesGapFromQuery, syncActivitiesGapQuery, isActivitiesGapQueryValue } from './shared/route-query.js';
import { rowMatchesActivityGapFilter } from './shared/activity-gap-filter.js';
import { renderActivitiesViewSwitcher, bindActivitiesViewSwitcher } from './shared/view-switcher.js';
import { ACTIVITY_SEASON_OPTIONS, isSummerActivity, normalizeActivitySeason } from './shared/summer-activity.js';

const inflightActivityDetailRequests = new Map();
const ADD_ACTIVITY_TYPE_ORDER = ['workshop', 'escape_room', 'tour', 'after_school'];

function isAdminUser(state) {
  return state?.user?.display_role === 'admin' || state?.user?.role === 'admin';
}

function normalizeAdminSummaryText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeAdminSummarySearchText(value) {
  return normalizeAdminSummaryText(value).toLowerCase().replace(/[\s_\-]+/g, '');
}

function normalizeAdminActivityType(value) {
  const raw = normalizeAdminSummaryText(value);
  const compact = normalizeAdminSummarySearchText(raw);
  if (['course', 'courses', 'קורס', 'קורסים'].includes(compact)) return { key: 'course', label: 'קורסים' };
  if (['workshop', 'workshops', 'סדנה', 'סדנאות'].includes(compact)) return { key: 'workshop', label: 'סדנאות' };
  if (['tour', 'tours', 'סיור', 'סיורים', 'טיול', 'טיולים'].includes(compact)) return { key: 'tour', label: 'סיורים' };
  if (['afterschool', 'after_school', 'חוגאפטרסקול', 'אפטרסקול'].map(normalizeAdminSummarySearchText).includes(compact)) {
    return { key: 'after_school', label: 'אפטרסקול' };
  }
  return { key: 'other', label: raw || 'אחר' };
}

const ADMIN_SUMMARY_TYPES = [
  { key: 'course', label: 'קורסים' },
  { key: 'workshop', label: 'סדנאות' },
  { key: 'tour', label: 'סיורים' },
  { key: 'after_school', label: 'אפטרסקול' }
];
const ADMIN_SUMMARY_TYPE_LABEL_BY_KEY = Object.fromEntries(ADMIN_SUMMARY_TYPES.map((item) => [item.key, item.label]));
const ADMIN_SUMMARY_DEDUPE_ID_FIELDS = ['RowID', 'row_id', 'source_row_id'];
const ADMIN_SUMMARY_DEDUPE_FALLBACK_FIELDS = ['activity_name', 'activity_type', 'school', 'authority', 'start_date', 'end_date'];

function adminSummaryDedupeKey(row = {}) {
  for (const field of ADMIN_SUMMARY_DEDUPE_ID_FIELDS) {
    const value = normalizeAdminSummaryText(row?.[field]);
    if (value) return `id:${field}:${value}`;
  }
  return `fallback:${ADMIN_SUMMARY_DEDUPE_FALLBACK_FIELDS.map((field) => normalizeAdminSummarySearchText(row?.[field])).join('|')}`;
}

function uniqueAdminSummaryRows(rows) {
  const seen = new Set();
  const unique = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = adminSummaryDedupeKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  return unique;
}

function createAdminSummaryBucket(label) {
  return {
    label,
    counts: { course: 0, workshop: 0, tour: 0, after_school: 0, other: 0, total: 0 },
    byName: new Map()
  };
}

function addRowToAdminSummaryBucket(bucket, row = {}) {
  const type = normalizeAdminActivityType(row.activity_type || row.activity_family || row.type);
  const name = normalizeAdminSummaryText(row.activity_name || row.name || row.program_name) || 'ללא שם פעילות';
  bucket.counts.total += 1;
  bucket.counts[type.key] = (bucket.counts[type.key] || 0) + 1;
  const detailKey = `${name}|${type.key}`;
  const existing = bucket.byName.get(detailKey) || { name, typeKey: type.key, typeLabel: type.label, count: 0 };
  existing.count += 1;
  bucket.byName.set(detailKey, existing);
}

function buildAdminActivitiesSummary(rows, settings = {}) {
  void settings;
  const total = createAdminSummaryBucket('');
  uniqueAdminSummaryRows(rows).forEach((row) => {
    addRowToAdminSummaryBucket(total, row);
  });
  return { total };
}

function adminSummaryCountsHtml(bucket) {
  const other = Number(bucket?.counts?.other || 0);
  return `<div class="ds-admin-summary__kpis">
    ${ADMIN_SUMMARY_TYPES.map(({ key, label }) => `<div class="ds-admin-summary__kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(bucket?.counts?.[key] || 0))}</strong></div>`).join('')}
    ${other > 0 ? `<div class="ds-admin-summary__kpi"><span>אחר</span><strong>${escapeHtml(String(other))}</strong></div>` : ''}
    <div class="ds-admin-summary__kpi ds-admin-summary__kpi--total"><span>סה״כ כל הפעילויות</span><strong>${escapeHtml(String(bucket?.counts?.total || 0))}</strong></div>
  </div>`;
}

function adminSummaryDetailsHtml(bucket) {
  const rows = Array.from(bucket?.byName?.values?.() || [])
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he'));
  if (!rows.length) return '<p class="ds-admin-summary__empty">אין פעילויות להצגה.</p>';
  return `<ul class="ds-admin-summary__details">
    ${rows.map((item) => {
      const typeLabel = ADMIN_SUMMARY_TYPE_LABEL_BY_KEY[item.typeKey] || item.typeLabel || 'אחר';
      return `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(String(item.count))} ${escapeHtml(typeLabel)}</strong></li>`;
    }).join('')}
  </ul>`;
}

function adminSummarySectionHtml(bucket) {
  return `<section class="ds-admin-summary__section ds-admin-summary__section--total" dir="rtl">
    ${adminSummaryCountsHtml(bucket)}
    <h3>פירוט לפי שם פעילות</h3>
    ${adminSummaryDetailsHtml(bucket)}
  </section>`;
}

function adminSummaryLoadingHtml() {
  return '<div class="ds-admin-summary" dir="rtl"><p class="ds-admin-summary__loading">טוען סיכום…</p></div>';
}

function adminSummaryErrorHtml() {
  return '<div class="ds-admin-summary" dir="rtl"><p class="ds-admin-summary__error">לא ניתן לטעון את סיכום האדמין כרגע</p></div>';
}

export function renderAdminActivitiesSummary(rows, settings = {}) {
  const summary = buildAdminActivitiesSummary(rows, settings);
  return `<div class="ds-admin-summary" dir="rtl">
    <header class="ds-admin-summary__intro">
      <h2>סיכום אדמין – כלל הפעילויות</h2>
      <p>הסיכום מבוסס על כלל הפעילויות שהוחזרו מהמערכת, ללא סינון חודש או סטטוס.</p>
    </header>
    ${adminSummarySectionHtml(summary.total)}
  </div>`;
}

const ACTIVITIES_SCOPE = 'activities';
const ACTIVITY_FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות', getValues: (row) => [activityManagerDisplayName(row?.activity_manager)] },
  { key: 'instructor', label: 'מדריך', getValues: (row) => [row?.instructor_name, row?.instructor_name_2] },
  { key: 'activity_name', label: 'תוכנית' },
  { key: 'authority', label: 'רשות' },
  { key: 'funding', label: 'מימון' },
  { key: 'school', label: 'בית ספר' },
  { key: 'activity_type', label: 'סוג הפעילות', getOptionLabel: (value) => visibleActivityCategoryLabel(value) }
];
const ACTIVITY_SEARCH_FIELDS = [
  'RowID', 'row_id', 'source_row_id',
  'activity_no', 'activity_number', 'activity_name', 'activity_type', 'activity_family',
  'activity_manager', 'manager_name',
  'instructor_name', 'instructor_name_2', 'Instructor', 'Instructor2',
  'emp_id', 'emp_id_2', 'EmployeeID', 'EmployeeID2',
  'authority', 'school', 'grade', 'class_group', 'group', 'class',
  'funding', 'status',
  'start_date', 'end_date', 'date_1', 'meeting_dates', 'date_cols',
  'notes', 'description',
  (row) => Array.from({ length: 30 }, (_, i) => row?.[`date_${i + 1}`]).filter(Boolean).join(' '),
  (row) => Array.isArray(row?.meeting_dates) ? row.meeting_dates.join(' ') : '',
  (row) => Array.isArray(row?.date_cols) ? row.date_cols.join(' ') : ''
];

/** שם תצוגה למדריך/ים — כולל כינויים מה־API ומ־normalizeData (Employee וכו'). */
function activityInstructorMeta(row, opts = {}) {
  const hideEmpIds = !!opts.hideEmpIds;
  const instructorByEmpId = opts.instructorByEmpId || {};
  const n1 = String(row?.instructor_name ?? row?.Instructor ?? row?.Employee ?? '').trim();
  const n2 = String(row?.instructor_name_2 ?? row?.Instructor2 ?? row?.Employee2 ?? '').trim();
  const e1 = String(row?.emp_id ?? row?.EmployeeID ?? row?.employee_id ?? '').trim();
  const e2 = String(row?.emp_id_2 ?? row?.EmployeeID2 ?? row?.employee_id_2 ?? '').trim();
  const names = [
    n1 || instructorByEmpId[e1] || '',
    n2 || instructorByEmpId[e2] || ''
  ].filter(Boolean);
  const empIds = [e1, e2].filter(Boolean);
  if (names.length) {
    return { text: names.join(' · '), hasInstructor: true, hasName: true, hasEmpId: empIds.length > 0 };
  }
  if (empIds.length) {
    return {
      text: '',
      hasInstructor: true,
      hasName: false,
      hasEmpId: true
    };
  }
  return { text: '', hasInstructor: false, hasName: false, hasEmpId: false };
}

const FAMILY_LABEL_SHORT = 'חד-יומיות';
const FAMILY_LABEL_LONG  = 'תוכניות';
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});
function isOneDayActivityTypeValue(value) {
  return Boolean(normalizeOneDayActivityType(value));
}

function optionsHtml(values, selected = '', placeholder = '—', labelFn = null) {
  const safeSelected = String(selected || '');
  const uniq = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((v) => {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    uniq.push(s);
  });
  if (safeSelected && !seen.has(safeSelected)) uniq.unshift(safeSelected);
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(
      uniq.map((v) => `<option value="${escapeHtml(v)}"${v === safeSelected ? ' selected' : ''}>${escapeHtml(typeof labelFn === 'function' ? (labelFn(v) || v) : v)}</option>`)
    )
    .join('');
}

function activitySeasonOptions(settings = {}) {
  const fromSettings = Array.isArray(settings?.dropdown_options?.activity_season)
    ? settings.dropdown_options.activity_season
    : [];
  const normalized = fromSettings
    .map((item) => {
      if (typeof item === 'string') {
        const value = normalizeActivitySeason(item);
        const fallback = ACTIVITY_SEASON_OPTIONS.find((option) => option.value === value);
        return fallback || { value, label: value };
      }
      const value = normalizeActivitySeason(item?.value);
      const fallback = ACTIVITY_SEASON_OPTIONS.find((option) => option.value === value);
      return { value, label: String(item?.label || fallback?.label || value).trim() };
    })
    .filter((item) => item.value);
  const list = normalized.length ? normalized : ACTIVITY_SEASON_OPTIONS;
  const seen = new Set();
  return list.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function activitySeasonSelectHtml(settings = {}, selected = 'regular') {
  const safeSelected = normalizeActivitySeason(selected);
  return activitySeasonOptions(settings)
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === safeSelected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
}

function decodeJsonAttr(raw, fallback = []) {
  try {
    const decoded = decodeURIComponent(String(raw || ''));
    const parsed = JSON.parse(decoded || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mergeOptions(settings, keys) {
  const map = settings?.dropdown_options || {};
  const out = [];
  const seen = new Set();
  keys.forEach((k) => {
    const arr = Array.isArray(map[k]) ? map[k] : [];
    arr.forEach((v) => {
      const s = String(v || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
  });
  return out;
}

function datalistHtml(id, values) {
  if (!values.length) return '';
  return `<datalist id="${escapeHtml(id)}">${values.map((v) => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`;
}

function addActivityModalHtml(settings) {
  const allActivityNames = getActivityCatalog(settings);
  const allTypes = ADD_ACTIVITY_TYPE_ORDER.slice();
  const rosterUsers = getRosterUsers(settings);
  const rosterNames = rosterUsers.map((u) => u.name);
  const managerRoleNames = getManagerUsers(settings);
  const fundingOptions = mergeOptions(settings, ['funding', 'fundings']);
  const gradeOptions = mergeOptions(settings, ['grade', 'grades']);
  const schoolOptions = mergeOptions(settings, ['school', 'schools']);
  const authorityOptions = mergeOptions(settings, ['authority', 'authorities']);
  const managerOptions = managerRoleNames.length
    ? managerRoleNames
    : mergeOptions(settings, ['activity_manager', 'activity_managers']);
  const instructorOptions = rosterNames.length ? rosterNames : mergeOptions(settings, ['instructor_name', 'instructor_names']);
  const initialType = '';
  const initialActivityNames = [];
  const sessionsList = Array.from({ length: 35 }, (_, i) => String(i + 1));

  const authorityField = `
    <div class="ds-activity-add-field ds-activity-add-field--entity" data-entity-field="authority">
      <div class="ds-activity-add-label-row">
        <span>רשות</span>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-entity-toggle="authority">+ רשות חדשה</button>
      </div>
      <input class="ds-input" name="authority" type="text" list="add-authority-list" autocomplete="off" data-entity-select="authority">
      ${datalistHtml('add-authority-list', authorityOptions)}
      <input class="ds-input" name="authority_custom" type="text" placeholder="הזנת רשות חדשה" style="display:none" data-entity-custom="authority">
    </div>`;

  const schoolField = `
    <div class="ds-activity-add-field ds-activity-add-field--entity" data-entity-field="school">
      <div class="ds-activity-add-label-row">
        <span>בית ספר</span>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-entity-toggle="school">+ בית ספר חדש</button>
      </div>
      <input class="ds-input" name="school" type="text" list="add-school-list" autocomplete="off" data-entity-select="school">
      ${datalistHtml('add-school-list', schoolOptions)}
      <input class="ds-input" name="school_custom" type="text" placeholder="הזנת בית ספר חדש" style="display:none" data-entity-custom="school">
    </div>`;

  return `
    <form class="ds-activity-add-form" dir="rtl" data-add-activity-form
      data-add-activity-names="${escapeHtml(encodeURIComponent(JSON.stringify(allActivityNames)))}"
      data-add-roster-users="${escapeHtml(encodeURIComponent(JSON.stringify(rosterUsers)))}">
      <input type="hidden" name="source" value="catalog">
      <div class="ds-activity-add-grid">
        <p class="ds-activity-add-section">פרטי פעילות</p>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>סוג פעילות</span>
          <select class="ds-input" name="activity_type" data-add-activity-type
            data-all-types="${escapeHtml(JSON.stringify(allTypes))}">
            ${optionsHtml(allTypes.map((type) => normalizeActivityTypeKey(type) || type), '', 'בחרו סוג פעילות', activityTypeDisplayLabel)}
          </select>
        </label>
        <label class="ds-activity-add-field ds-activity-add-field--wide"><span>שם פעילות</span>
          <select class="ds-input" name="activity_name" data-add-activity-name disabled>
            ${optionsHtml(initialActivityNames.map((o) => o.label), '', 'בחרו קודם סוג פעילות')}
          </select>
        </label>
        <input type="hidden" name="activity_no" value="" data-add-activity-no>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-sessions><span>מספר מפגשים</span><select class="ds-input" name="sessions" data-add-sessions>${optionsHtml(sessionsList, '1')}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>עונת פעילות</span><select class="ds-input" name="activity_season">${activitySeasonSelectHtml(settings, 'regular')}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>מימון</span><select class="ds-input" name="funding">${optionsHtml(fundingOptions)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>מחיר</span><input class="ds-input" name="price" type="number" min="0" step="1"></label>
        <label class="ds-activity-add-field"><span>קבוצה / כיתה</span><input class="ds-input" name="class_group" type="text"></label>
        <label class="ds-activity-add-field"><span>שכבה</span><select class="ds-input" name="grade">${optionsHtml(gradeOptions)}</select></label>
        ${authorityField}
        ${schoolField}

        <p class="ds-activity-add-section">תאריכים ושעות</p>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>שעת התחלה</span><select class="ds-input" name="start_time">${optionsHtml(TIME_OPTIONS)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>שעת סיום</span><select class="ds-input" name="end_time">${optionsHtml(TIME_OPTIONS)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-start-date><span>תאריך התחלה</span><input class="ds-input" name="start_date" type="date"></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-end-date><span>תאריך סיום</span><input class="ds-input" name="end_date" type="date"></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-one-day-date style="display:none"><span>תאריך הפעילות</span><input class="ds-input" name="one_day_date" type="date"></label>
        <div class="ds-activity-add-field ds-activity-add-field--span2" data-add-date-rows-wrap>
          <span>תאריכי מפגשים</span>
          <div class="ds-activity-add-date-rows" data-add-date-rows></div>
        </div>

        <p class="ds-activity-add-section">צוות וניהול</p>
        <label class="ds-activity-add-field"><span>מנהל פעילות</span><select class="ds-input" name="activity_manager">${optionsHtml(managerOptions, '', NO_ACTIVITY_MANAGER_LABEL)}</select></label>
        <label class="ds-activity-add-field"><span>מדריך/ה ראשי/ת</span><select class="ds-input" name="instructor_name" data-add-instructor>${optionsHtml(instructorOptions)}</select></label>
        <input type="hidden" name="emp_id" value="">
        <label class="ds-activity-add-field" data-field-instructor2><span>מדריך/ה נוסף/ת (אופציונלי)</span><select class="ds-input" name="instructor_name_2" data-add-instructor-2>${optionsHtml(instructorOptions)}</select></label>
        <input type="hidden" name="emp_id_2" value="">

        <p class="ds-activity-add-section">הערות</p>
        <label class="ds-activity-add-field ds-activity-add-field--span2"><span>הערות</span><textarea class="ds-input" name="notes" rows="2"></textarea></label>
      </div>
      <button type="submit" hidden aria-hidden="true"></button>
      <p class="ds-muted" role="status" data-add-activity-status></p>
    </form>
  `;
}

function resolveOneDayTypes(settings) {
  const legacy = getActivityTypesByFamily(settings, 'short');
  return Array.isArray(legacy) ? legacy : [];
}

function normalizeQuickFilterText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function isShortFamily(row, oneDayTypes) {
  const type = String(row?.activity_type || '').trim();
  const family = normalizeQuickFilterText(row?.activity_family);
  const source = normalizeQuickFilterText(row?.source);
  if (family === 'oneday' || source === 'short') return true;
  if (family === 'program' || source === 'long') return false;
  return oneDayTypes.includes(type);
}

function matchesQuickDistrictOrManager(row = {}, quickValue = '') {
  const wanted = String(quickValue || '').trim();
  if (!wanted) return true;
  return [row.district, row.manager_district, row.activity_manager_district, row.activity_manager]
    .some((value) => String(value || '').trim() === wanted);
}

function isEndingInMonth(row = {}, ym = '') {
  const month = String(ym || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) && String(row?.end_date || row?.date_end || '').slice(0, 7) === month;
}

function applyClientFilters(rows, state, settings) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  const oneDayTypes = resolveOneDayTypes(settings);
  if (state.activityQuickFamily === 'short') {
    out = out.filter((row) => isShortFamily(row, oneDayTypes));
  } else if (state.activityQuickFamily === 'long') {
    out = out.filter((row) => !isShortFamily(row, oneDayTypes));
  } else if (state.activityQuickFamily === 'summer') {
    out = out.filter(isSummerActivity);
  }
  if (state.activityQuickManager) {
    out = out.filter((row) => matchesQuickDistrictOrManager(row, state.activityQuickManager));
  }
  if (state.activityEndingCurrentMonth) {
    out = out.filter((row) => isEndingInMonth(row, state.activitiesMonthYm));
  }
  return out;
}

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYm(ym, delta) {
  const base = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  const d = base ? new Date(Number(base[1]), Number(base[2]) - 1, 1) : new Date();
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    start: `${y}-${String(mo).padStart(2, '0')}-01`,
    end: `${y}-${String(mo).padStart(2, '0')}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`
  };
}

function activityOverlapsMonth(row, ym) {
  const bounds = monthBounds(ym);
  if (!bounds) return true;
  const candidates = [];
  const pushDate = (value) => {
    const date = String(value || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) candidates.push(date);
  };
  const cols = Array.isArray(row?.meeting_dates) ? row.meeting_dates : [];
  const dateCols = Array.isArray(row?.date_cols) ? row.date_cols : [];
  cols.forEach(pushDate);
  dateCols.forEach(pushDate);
  for (let i = 1; i <= 35; i++) {
    pushDate(row?.[`date_${i}`]);
    pushDate(row?.[`Date${i}`]);
  }
  pushDate(row?.start_date);
  pushDate(row?.end_date);
  if (!candidates.length) return false;
  return candidates.some((date) => date >= bounds.start && date <= bounds.end);
}

function hasAnyActivityDate(row) {
  const pushDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim().slice(0, 10));
  if (pushDate(row?.start_date) || pushDate(row?.end_date)) return true;
  const cols = Array.isArray(row?.meeting_dates) ? row.meeting_dates : [];
  const dateCols = Array.isArray(row?.date_cols) ? row.date_cols : [];
  if (cols.some(pushDate) || dateCols.some(pushDate)) return true;
  for (let i = 1; i <= 35; i++) {
    if (pushDate(row?.[`date_${i}`]) || pushDate(row?.[`Date${i}`])) return true;
  }
  return false;
}

function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return '';
  return `${m[1]}-${m[2]}`;
}

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
function heMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return monthLabel(ym);
  return HE_MONTHS[Number(m[2]) - 1] || monthLabel(ym);
}


function compareActivityDefaultOrder(a, b) {
  const collator = compareActivityDefaultOrder._collator || (compareActivityDefaultOrder._collator = new Intl.Collator('he', { sensitivity: 'base', numeric: true }));
  const text = (row, key) => String(row?.[key] || '').trim();
  const byAuthority = collator.compare(text(a, 'authority'), text(b, 'authority'));
  if (byAuthority) return byAuthority;
  const bySchool = collator.compare(text(a, 'school'), text(b, 'school'));
  if (bySchool) return bySchool;
  const instructorA = String(a?.instructor_name || a?.Instructor || a?.instructor_name_2 || a?.Instructor2 || '').trim();
  const instructorB = String(b?.instructor_name || b?.Instructor || b?.instructor_name_2 || b?.Instructor2 || '').trim();
  const byInstructor = collator.compare(instructorA, instructorB);
  if (byInstructor) return byInstructor;
  const byName = collator.compare(text(a, 'activity_name'), text(b, 'activity_name'));
  if (byName) return byName;
  return String(a?.start_date || '').localeCompare(String(b?.start_date || ''));
}

function applyActivitiesGapFilter(rows, gapFilter) {
  const gap = String(gapFilter || '').trim();
  if (!isActivitiesGapQueryValue(gap)) return rows;
  return rows.filter((row) => rowMatchesActivityGapFilter(row, gap));
}

function applyActivitiesLocalFilters(rows, state, settings) {
  const filters = ensureActivityListFilters(state, ACTIVITIES_SCOPE);
  if (!state.activitiesMonthYm) state.activitiesMonthYm = currentYm();
  const familyRows = applyClientFilters(rows, state, settings);
  const monthRows = familyRows.filter((row) => activityOverlapsMonth(row, state.activitiesMonthYm) || !hasAnyActivityDate(row));
  const gapRows = applyActivitiesGapFilter(monthRows, state.activitiesGapFilter);
  prepareRowsForSearch(gapRows, ACTIVITY_SEARCH_FIELDS);
  return applyLocalFilters(gapRows, filters, { filterFields: ACTIVITY_FILTER_FIELDS }).sort(compareActivityDefaultOrder);
}

function activityDrawerContent(row, canSeePrivateNotes, canEdit, canDirectEdit, canRequestEdit, canDeleteActivity, hideEmpIds, hideRowId, hideActivityNo, settings, { datesLoading = false } = {}) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, {
    privateNote,
    canEdit,
    canDirectEdit,
    canRequestEdit,
    canDeleteActivity,
    hideEmpIds: !!hideEmpIds,
    hideRowId,
    hideActivityNo,
    settings,
    showFinance: false,
    showFinanceFields: false,
    datesLoading
  });
}

function editRequestStatusLabel(status) {
  if (status === 'pending') return 'בקשת עריכה ממתינה';
  if (status === 'approved') return 'בקשת העריכה אושרה';
  if (status === 'rejected') return 'בקשת העריכה נדחתה';
  if (status === 'conflict') return 'בקשת העריכה בקונפליקט';
  return '';
}

function buildFallbackOptionsFromRows(rows) {
  const uniqueField = (field) => {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
      const v = String(row?.[field] || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'he'));
  };
  const instructorNames = (() => {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
      [row?.instructor_name, row?.instructor_name_2].forEach((v) => {
        const s = String(v || '').trim();
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      });
    });
    return out.sort((a, b) => a.localeCompare(b, 'he'));
  })();
  const activityNameOptions = (() => {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
      const label = String(row?.activity_name || '').trim();
      const type  = String(row?.activity_type  || '').trim();
      const sig   = `${label}|${normalizeActivityTypeKey(type) || type}`;
      if (!label || seen.has(sig)) return;
      seen.add(sig);
      out.push({
        label,
        activity_no:   String(row?.activity_no || '').trim(),
        activity_type: type,
        parent_value:  type
      });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, 'he'));
  })();
  const allActivityTypes = uniqueField('activity_type');
  const oneDayTypesFromRows = cleanUnique(rows
    .filter((row) => String(row?.activity_family || '').trim() === 'one_day' || String(row?.source || '').trim() === 'short')
    .map((row) => String(row?.activity_type || '').trim())
    .filter(Boolean));
  const programTypesFromRows = cleanUnique(rows
    .filter((row) => String(row?.activity_family || '').trim() !== 'one_day' && String(row?.source || '').trim() !== 'short')
    .map((row) => String(row?.activity_type || '').trim())
    .filter(Boolean));
  return {
    _activityTypesFromRows: allActivityTypes,
    _oneDayActivityTypesFromRows: oneDayTypesFromRows,
    _programActivityTypesFromRows: programTypesFromRows,
    funding: uniqueField('funding'),
    fundings: uniqueField('funding'),
    grade: uniqueField('grade'),
    grades: uniqueField('grade'),
    school: uniqueField('school'),
    schools: uniqueField('school'),
    authority: uniqueField('authority'),
    authorities: uniqueField('authority'),
    activity_manager: uniqueField('activity_manager'),
    activity_managers: uniqueField('activity_manager'),
    instructor_name: instructorNames,
    instructor_names: instructorNames,
    activity_names: activityNameOptions
  };
}

function mergeSettingsWithFallback(base, fallbackOpts) {
  const baseOpts = (base && base.dropdown_options && typeof base.dropdown_options === 'object')
    ? base.dropdown_options : {};
  const merged = { ...baseOpts };
  const {
    _activityTypesFromRows,
    _oneDayActivityTypesFromRows,
    _programActivityTypesFromRows,
    ...dropdownFallback
  } = fallbackOpts;
  Object.keys(dropdownFallback).forEach((k) => {
    const existing = Array.isArray(baseOpts[k]) ? baseOpts[k] : [];
    if (!existing.length && Array.isArray(dropdownFallback[k]) && dropdownFallback[k].length) {
      merged[k] = dropdownFallback[k];
    }
  });
  const result = { ...base, dropdown_options: merged };
  if (Array.isArray(_activityTypesFromRows) && _activityTypesFromRows.length) {
    const hasShort = Array.isArray(base?.one_day_activity_types) && base.one_day_activity_types.length;
    const hasLong  = Array.isArray(base?.program_activity_types)  && base.program_activity_types.length;
    if (!hasShort) {
      result.one_day_activity_types = Array.isArray(_oneDayActivityTypesFromRows) && _oneDayActivityTypesFromRows.length
        ? _oneDayActivityTypesFromRows
        : [];
    }
    if (!hasLong) {
      result.program_activity_types = Array.isArray(_programActivityTypesFromRows) && _programActivityTypesFromRows.length
        ? _programActivityTypesFromRows
        : _activityTypesFromRows;
    }
  }
  return result;
}

function activityDetailCacheKey(summaryRow) {
  return `activityDetail:${summaryRow.source_sheet || ''}:${summaryRow.RowID || ''}`;
}

function getCachedActivityDetail(summaryRow, s) {
  const entry = s?.screenDataCache?.[activityDetailCacheKey(summaryRow)];
  return entry ? entry.data : null;
}

function putCachedActivityDetail(summaryRow, row, s) {
  if (s?.screenDataCache) {
    s.screenDataCache[activityDetailCacheKey(summaryRow)] = { data: row, t: Date.now() };
  }
}

function activityDatesCacheKey(summaryRow) {
  return `activityDates:${summaryRow.source_sheet || ''}:${summaryRow.RowID || ''}`;
}

function getCachedActivityDates(summaryRow, s) {
  const entry = s?.screenDataCache?.[activityDatesCacheKey(summaryRow)];
  return entry ? entry.data : null;
}

function putCachedActivityDates(summaryRow, data, s) {
  if (s?.screenDataCache) {
    s.screenDataCache[activityDatesCacheKey(summaryRow)] = { data, t: Date.now() };
  }
}

/**
 * Returns the nearest upcoming meeting date (today or future) from a row's date columns.
 * Returns '' if all dates have passed or none exist.
 */
function nextMeetingDate(row) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [];
  // Collect from meeting_dates / date_cols array (already normalised)
  const cols = Array.isArray(row?.meeting_dates) ? row.meeting_dates
    : Array.isArray(row?.date_cols) ? row.date_cols : [];
  for (const d of cols) {
    const s = String(d || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) dates.push(s);
  }
  // Also scan date_1..date_35 / Date1..Date35 directly
  for (let i = 1; i <= 35; i++) {
    const v = row?.[`date_${i}`] || row?.[`Date${i}`] || '';
    const s = String(v).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !dates.includes(s)) dates.push(s);
  }
  if (!dates.length) return '';
  const future = dates.filter((d) => d >= today).sort();
  return future.length ? future[0] : '';
}

export const activitiesScreen = {
  async load({ api, state }) {
    if (!state.activitiesMonthYm) state.activitiesMonthYm = currentYm();
    return api.activities({
      activity_type: 'all',
      month: state.activitiesMonthYm
    });
  },

  render(data, { state }) {
    const allRows       = Array.isArray(data?.rows) ? data.rows : [];
    if (!state.activitiesMonthYm) state.activitiesMonthYm = currentYm();
    const filteredRows  = applyActivitiesLocalFilters(allRows, state, state?.clientSettings);

    const listFilters   = ensureActivityListFilters(state, ACTIVITIES_SCOPE);
    const { visible: safeRows, hasMore, total, nextCount } = splitVisibleRows(filteredRows, listFilters);
    const canSeePrivateNotes = ['operation_manager', 'admin'].includes(state?.user?.display_role);
    const hideEmpIds    = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId     = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const role = String(state?.user?.display_role || state?.user?.role || '').trim();
    const canDeleteActivity = ['admin', 'operation_manager'].includes(role);
    const canAddActivity = !!state?.user?.can_add_activity || role === 'operation_manager' || role === 'admin';
    const isAdmin = isAdminUser(state);

    const rosterUsers = getRosterUsers(state?.clientSettings || {});
    const instructorByEmpId = rosterUsers.reduce((acc, user) => {
      const empId = String(user?.emp_id || '').trim();
      const fullName = String(user?.name || '').trim();
      if (empId && fullName && !acc[empId]) acc[empId] = fullName;
      return acc;
    }, {});
    const tableRows = safeRows
      .map((row) => {
        const instructorMeta = activityInstructorMeta(row, { hideEmpIds, instructorByEmpId });
        const instructorDisplay = instructorMeta.hasInstructor
          ? `<span class="ds-activities-instructor-name${instructorMeta.hasName ? '' : ' is-derived'}">${escapeHtml(instructorMeta.text)}</span>`
          : '<span class="ds-chip ds-chip--status ds-chip--warn ds-chip--instructor-empty">ללא מדריך</span>';
        const activityTypeLabel = escapeHtml(visibleActivityCategoryLabel(row.activity_type));
        const activityName = escapeHtml(row.activity_name || '—');
        const editStatus = editRequestStatusLabel(String(row.edit_request_status || ''));
        const editStatusBadge = editStatus
          ? `<span class="ds-chip ds-chip--status ds-chip--warn" title="${escapeHtml(editStatus)}">${escapeHtml(editStatus)}</span>`
          : '';
        const startHe = formatDateHe(row.start_date) || '—';
        const endRaw = String(row?.end_date || row?.date_end || '').trim() || String(row?.start_date || '').trim();
        const endHe = endRaw ? formatDateHe(endRaw) || '—' : '—';
        const managerLabel = activityManagerDisplayName(row.activity_manager);
        const rowSearch = [
          hideRowId ? '' : row.RowID,
          visibleActivityCategoryLabel(row.activity_type),
          row.activity_name,
          row.start_date,
          row.end_date,
          row.school,
          row.authority,
          row.instructor_name,
          row.instructor_name_2,
          row.activity_manager,
          managerLabel,
          hideEmpIds ? '' : row.emp_id,
          hideEmpIds ? '' : row.emp_id_2,
          formatActivityDateColumnsHe(row)
        ]
          .filter(Boolean)
          .join(' ');
        return `
      <tr class="ds-data-row ds-activities-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="" data-row-id="${escapeHtml(row.RowID)}">
        <td class="ds-activities-col ds-activities-col--program"><div class="ds-activities-program-cell"><strong class="ds-activities-program-name" title="${activityName}">${activityName}</strong><span class="ds-activities-program-type" title="${activityTypeLabel}">${activityTypeLabel}</span>${editStatusBadge}</div></td>
        <td class="ds-activities-col ds-activities-col--authority"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(row.authority || '—')}">${escapeHtml(row.authority || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--school"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(row.school || '—')}">${escapeHtml(row.school || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--instructor"><div class="ds-activities-instructor-wrap">${instructorDisplay}<span class="ds-activities-manager-line" title="${escapeHtml(managerLabel || '—')}">מנהל: ${escapeHtml(managerLabel || '—')}</span></div></td>
        <td class="ds-activities-col ds-activities-col--date"><time class="ds-activities-date">${escapeHtml(startHe)}</time></td>
        <td class="ds-activities-col ds-activities-col--date"><time class="ds-activities-date">${escapeHtml(endHe)}</time></td>
        <td class="ds-activities-col ds-activities-col--meetings">${(() => { const nd = nextMeetingDate(row); const ndHe = nd ? (formatDateHe(nd) || nd) : ''; return ndHe ? `<time class="ds-activities-date" title="${escapeHtml(nd)}">${escapeHtml(ndHe)}</time>` : '<span class="ds-activities-date ds-activities-date--none">—</span>'; })()}</td>
        <td class="ds-activities-col ds-activities-col--notes"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(String(row.notes || '—'))}">${escapeHtml(String(row.notes || '—'))}</span></td>
      </tr>
    `;
      })
      .join('');


    const fundingOptions = mergeOptions(state?.clientSettings || {}, ['funding', 'fundings']);
    const centralOptions = getFilterOptionOverrides(state?.clientSettings || {});
    const bareFilters = filtersToolbarHtml(ACTIVITIES_SCOPE, filteredRows, state, {
      filterFields: ACTIVITY_FILTER_FIELDS,
      search: false,
      clear: false,
      bare: true,
      optionsOverrides: { ...centralOptions, funding: fundingOptions }
    });
    const loadMoreHtml = hasMore
      ? `<div style="display:flex;justify-content:center;padding:12px 0"><button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${ACTIVITIES_SCOPE}" data-next-count="${nextCount}">הצג עוד</button></div>`
      : '';

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState(allRows.length === 0
            ? 'אין פעילויות רשומות בחודש זה'
            : 'לא נמצאו פעילויות התואמות לסינון הנוכחי')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--activities-list" dir="rtl">
                <colgroup>
                  <col class="ds-activities-col--program">
                  <col class="ds-activities-col--authority">
                  <col class="ds-activities-col--school">
                  <col class="ds-activities-col--instructor">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--meetings">
                  <col class="ds-activities-col--notes">
                </colgroup>
                <thead><tr><th>תוכנית / סוג</th><th>רשות</th><th>בית ספר</th><th>מדריך</th><th>תאריך התחלה</th><th>תאריך סיום</th><th>המפגש הבא</th><th>הערות</th></tr></thead>
                <tbody>${tableRows}</tbody>
              </table>`) + loadMoreHtml;

    const isNavLoading = !!state.activitiesNavLoading;
    const navLoadingChip = isNavLoading ? '<span class="ds-inline-loading-dot is-inline-loading" aria-hidden="true"></span>' : '';
    const viewSwitcher = renderActivitiesViewSwitcher(state, 'activities');
    const mainToolbar = `<div class="ds-activities-main-toolbar" dir="rtl" data-local-filters="${ACTIVITIES_SCOPE}">
      <input type="search" class="ds-input ds-input--sm ds-activities-search-sm" data-filter-search="${ACTIVITIES_SCOPE}" value="${escapeHtml(listFilters.q || '')}" placeholder="חיפוש" aria-label="חיפוש פעילויות" title="חיפוש לפי פעילות / מדריך / רשות / בית ספר" />
      ${bareFilters}
      <div class="ds-activities-main-toolbar__actions">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-btn--icon-only" data-filter-clear="${ACTIVITIES_SCOPE}" aria-label="ניקוי סינון" title="ניקוי סינון">↻</button>
        ${isAdmin ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-activities-toolbar-btn" data-activities-export-all title="ייצוא כל הפעילויות לאקסל">ייצוא לאקסל</button><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-activities-toolbar-btn" data-activities-admin-summary title="סיכום אדמין לכלל הפעילויות">סיכום אדמין</button>` : ''}
        ${canAddActivity ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-btn--icon-only" data-activities-add-btn aria-label="הוספת פעילות" title="הוספת פעילות">+</button>` : ''}
      </div>
    </div>`;

    const titleNavRow = `<nav class="ds-activities-title-row${isNavLoading ? ' is-nav-loading' : ''}" aria-label="ניווט חודשי לפעילויות" dir="rtl">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-activities-month-prev aria-label="חודש קודם" title="חודש קודם" ${isNavLoading ? 'disabled' : ''}>▶</button>
      <h2 class="ds-activities-page-title">ניהול פעילויות · ${escapeHtml(heMonthLabel(state.activitiesMonthYm))} · ${total} פעילויות ${navLoadingChip}</h2>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-activities-month-next aria-label="חודש הבא" title="חודש הבא" ${isNavLoading ? 'disabled' : ''}>◀</button>
    </nav>`;

    const html = dsScreenStack(`<section class="ds-activities-screen">
      ${viewSwitcher}
      ${titleNavRow}
      ${mainToolbar}
      ${dsCard({ body: tableSection, padded: false })}
    </section>`);
    return html;
  },

  bind({ root, data, state, rerender, rerenderActivitiesView, ui, api, clearScreenDataCache }) {

    (function showOverdueWarningIfNeeded() {
      if (!root) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const allRows = Array.isArray(data?.rows) ? data.rows : [];
      const overdue = allRows.filter((row) => {
        const status = String(row?.status || '').trim();
        const isLegacyActiveOneDay = isOneDayActivityTypeValue(row?.activity_type || row?.item_type) && status === 'פעיל';
        if (status === 'סגור' || status === 'closed' || status === 'inactive') return false;
        if (status !== 'פתוח' && !isLegacyActiveOneDay) return false;
        const endRaw = String(row?.end_date || '').trim();
        if (!endRaw) return false;
        const endDate = new Date(endRaw);
        return !isNaN(endDate.getTime()) && endDate < today;
      });
      if (!overdue.length) return;
      const existing = root.querySelector('[data-overdue-warning]');
      if (existing) return;
      const el = document.createElement('div');
      el.setAttribute('data-overdue-warning', '');
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('dir', 'rtl');
      el.className = 'ds-overdue-overlay';
      el.innerHTML = `
        <div class="ds-overdue-dialog">
          <div class="ds-overdue-icon" aria-hidden="true">⚠️</div>
          <h3 class="ds-overdue-title">פעילויות פתוחות שתאריך הסיום שלהן חלף</h3>
          <p class="ds-overdue-body">קיימות <strong>${overdue.length}</strong> פעילויות בסטטוס <strong>פתוח</strong> שתאריך הסיום שלהן כבר עבר.<br>מומלץ לבדוק ולעדכן את הסטטוס שלהן.</p>
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-overdue-close>הבנתי</button>
        </div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-overdue-close]') || e.target === el) el.remove();
      });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { el.remove(); document.removeEventListener('keydown', onKey); }
      }, { once: true });
      root.appendChild(el);
    })();

    const activitiesRows = Array.isArray(data?.rows) ? data.rows : [];
    const filteredRows      = applyActivitiesLocalFilters(activitiesRows, state, state?.clientSettings);
    const canSeePrivateNotes = ['operation_manager', 'admin'].includes(state?.user?.display_role);
    const canEditActivity   = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const hideEmpIds        = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId         = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo    = !!state?.clientSettings?.hide_activity_no_on_screens;
    const role = String(state?.user?.display_role || state?.user?.role || '').trim();
    const canDeleteActivity = ['admin', 'operation_manager'].includes(
      String(state?.user?.display_role || state?.user?.role || '').trim()
    );
    const canAddActivity = !!state?.user?.can_add_activity || role === 'operation_manager' || role === 'admin';
    const isAdmin = isAdminUser(state);

    const rerenderLocal = () => {
      if (typeof rerenderActivitiesView === 'function') rerenderActivitiesView();
      else rerender();
    };

    bindActivitiesViewSwitcher(root, state, rerender);

    const upsertLocalRow = (rowId, patch) => {
      const hit = activitiesRows.find((row) => String(row?.RowID || '') === String(rowId || ''));
      if (!hit) return false;
      Object.assign(hit, patch || {});
      return true;
    };
    const patchLocalRowFromSave = ({ sourceRowId, changes }) => {
      const normalizedStatus = String(changes?.status || '').trim();
      if (normalizedStatus === 'נמחק') {
        const rowId = String(sourceRowId || '');
        const removeByRowId = (arr) => {
          const idx = arr.findIndex((row) => String(row?.RowID || '') === rowId);
          if (idx >= 0) arr.splice(idx, 1);
        };
        removeByRowId(activitiesRows);
        removeByRowId(filteredRows);
        return;
      }
      if (!upsertLocalRow(sourceRowId, changes || {})) return;
      const summaryHit = filteredRows.find((row) => String(row?.RowID || '') === String(sourceRowId || ''));
      if (summaryHit) Object.assign(summaryHit, changes || {});
    };
    const scheduleQuietRefresh = async () => {
      try {
        const refreshMonth = state.activitiesMonthYm || currentYm();
        const fresh = await api.activities({ activity_type: 'all', month: refreshMonth });
        const freshRows = Array.isArray(fresh?.rows) ? fresh.rows : [];
        activitiesRows.splice(0, activitiesRows.length, ...freshRows);
        state.screenDataCache[`activities:${refreshMonth}`] = { data: { ...fresh, rows: activitiesRows }, t: Date.now() };
      } catch {
        // keep local optimistic view on failure
      }
    };

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, {
        api,
        ui,
        clearScreenDataCache,
        rerender,
        onRowSaved: ({ sourceSheet, sourceRowId, changes }) => {
          patchLocalRowFromSave({ sourceRowId, changes });
          const key = `activityDetail:${sourceSheet || ''}:${sourceRowId || ''}`;
          const entry = state?.screenDataCache?.[key];
          if (entry?.data && typeof entry.data === 'object') Object.assign(entry.data, changes || {});
        },
        onSaveSuccess: async ({ sourceSheet, sourceRowId, contentRoot }) => {
          try {
            const rsp = await api.activityDetail(sourceRowId, sourceSheet || 'activities');
            const freshRow = rsp?.row;
            if (freshRow && contentRoot) {
              putCachedActivityDetail({ RowID: sourceRowId, source_sheet: sourceSheet || 'activities' }, freshRow, state);
              contentRoot.innerHTML = activityDrawerContent(
                freshRow, canSeePrivateNotes, canEditActivity, !!state?.user?.can_edit_direct, !!state?.user?.can_request_edit,
                canDeleteActivity,
                hideEmpIds, hideRowId, hideActivityNo,
                mergeSettingsWithFallback(state?.clientSettings || {}, buildFallbackOptionsFromRows(activitiesRows)),
                { datesLoading: false }
              );
              hideShellHeader(contentRoot);
              bindActivityEditForm(contentRoot);
            }
          } catch (err) {
            console.warn('[activity-refresh-after-save:failed]', { sourceRowId, error: err?.message || String(err) });
          }
          rerenderLocal();
          void scheduleQuietRefresh();
          const rowNode = Array.from(root.querySelectorAll('.ds-data-row'))
            .find((node) => String(node?.dataset?.rowId || '') === String(sourceRowId || ''));
          rowNode?.classList.add('is-just-saved');
          setTimeout(() => rowNode?.classList.remove('is-just-saved'), 1200);
        }
      });

    async function loadDetailRow(summaryRow) {
      const key = activityDetailCacheKey(summaryRow);
      let request = inflightActivityDetailRequests.get(key);
      if (!request) {
        request = api.activityDetail(summaryRow.RowID, summaryRow.source_sheet)
          .finally(() => {
            inflightActivityDetailRequests.delete(key);
          });
        inflightActivityDetailRequests.set(key, request);
      }
      const rsp = await request;
      const row = rsp?.row || summaryRow;
      putCachedActivityDetail(summaryRow, row, state);
      return row;
    }

    function hideShellHeader(contentRoot) {
      const shellHdr = contentRoot.closest('.ds-drawer')?.querySelector(':scope > header');
      if (shellHdr) shellHdr.hidden = true;
    }

    function makeOnOpen(contentRoot) {
      hideShellHeader(contentRoot);
      bindActivityEditForm(contentRoot);
    }

    async function openActivityDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      const cachedDetail = getCachedActivityDetail(summaryRow, state);
      const cachedDates  = getCachedActivityDates(summaryRow, state);
      const canDirectEdit = !!state?.user?.can_edit_direct;
      const canRequestEdit = !!state?.user?.can_request_edit;
      const settings = mergeSettingsWithFallback(
        state?.clientSettings || {},
        buildFallbackOptionsFromRows(activitiesRows)
      );

      if (cachedDetail) {
        ui.openDrawer({
          title: '',
          content: activityDrawerContent(
            cachedDetail, canSeePrivateNotes, canEditActivity, canDirectEdit, canRequestEdit,
            canDeleteActivity,
            hideEmpIds, hideRowId, hideActivityNo, settings, { datesLoading: false }
          ),
          onOpen: makeOnOpen,
          onClose: () => {
            const shellHdr = document.querySelector('.ds-drawer > header');
            if (shellHdr) shellHdr.hidden = false;
          }
        });
        return;
      }

      const needDates = !cachedDates;
      ui.openDrawer({
        title: '',
        content: activityDrawerContent(
          summaryRow, canSeePrivateNotes, canEditActivity, canDirectEdit, canRequestEdit,
          canDeleteActivity,
          hideEmpIds, hideRowId, hideActivityNo, settings, { datesLoading: needDates }
        ),
        onOpen: makeOnOpen,
        onClose: () => {
          const shellHdr = document.querySelector('.ds-drawer > header');
          if (shellHdr) shellHdr.hidden = false;
        }
      });

      if (cachedDates && !needDates) {
        const sectionEl = document.querySelector('[data-dates-section]');
        if (sectionEl) patchDrawerDatesSection(sectionEl, cachedDates);
      }

      const srcRowId    = summaryRow.source_row_id || summaryRow.RowID;
      const srcSheet    = summaryRow.source_sheet || '';

      if (needDates) {
        api.activityDates(srcRowId, srcSheet)
          .then((datesData) => {
            putCachedActivityDates(summaryRow, datesData, state);
            const sectionEl = document.querySelector('[data-dates-section]');
            if (sectionEl) patchDrawerDatesSection(sectionEl, datesData);
          })
          .catch(() => {
            const sectionEl = document.querySelector('[data-dates-section]');
            if (sectionEl) sectionEl.removeAttribute('data-dates-loading');
          });
      }

      loadDetailRow(summaryRow)
        .then((row) => { putCachedActivityDetail(summaryRow, row, state); })
        .catch(() => {});
    }

    const gapFromQuery = readActivitiesGapFromQuery();
    if (gapFromQuery) state.activitiesGapFilter = gapFromQuery;
    else if (!isActivitiesGapQueryValue(state.activitiesGapFilter)) {
      state.activitiesGapFilter = '';
    }
    syncActivitiesGapQuery(state.activitiesGapFilter);

    bindLocalFilters(root, state, ACTIVITIES_SCOPE, rerenderLocal, { debounceMs: 150, onClear: () => {
      state.activityQuickFamily = '';
      state.activityQuickManager = '';
      state.activityEndingCurrentMonth = false;
      state.activitiesGapFilter = '';
      syncActivitiesGapQuery('');
      state.activityTab = 'all';
      state.activityFinanceStatus = '';
    } });
    const runMonthShift = (delta) => {
      if (state.activitiesNavLoading) return;
      const startedAt = Date.now();
      state.activitiesNavLoading = true;
      state.activitiesMonthYm = shiftYm(state.activitiesMonthYm || currentYm(), delta);
      rerenderLocal();
      const minMs = 420;
      setTimeout(() => {
        state.activitiesNavLoading = false;
        rerenderLocal();
      }, Math.max(0, minMs - (Date.now() - startedAt)));
    };

    async function loadAllActivitiesForAdmin() {
      return typeof api.allActivities === 'function' ? api.allActivities() : api.activities({ activity_type: 'all' });
    }

    root.querySelector('[data-activities-export-all]')?.addEventListener('click', async (ev) => {
      if (!isAdmin) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'מייצא…';
      try {
        const res = await loadAllActivitiesForAdmin();
        exportActivitiesToExcel(Array.isArray(res?.rows) ? res.rows : [], 'כל_הפעילויות');
      } catch (err) {
        console.error('Failed to export all activities to Excel', err);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });

    root.querySelector('[data-activities-admin-summary]')?.addEventListener('click', async (ev) => {
      if (!isAdmin || !ui) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      ui.openDrawer({ title: 'סיכום אדמין – כלל הפעילויות', content: adminSummaryLoadingHtml() });
      try {
        const res = await loadAllActivitiesForAdmin();
        const drawerContent = document.querySelector('.ds-drawer__content');
        if (drawerContent) drawerContent.innerHTML = renderAdminActivitiesSummary(Array.isArray(res?.rows) ? res.rows : [], state?.clientSettings || {});
      } catch (err) {
        console.error('[admin-summary:failed]', err);
        const drawerContent = document.querySelector('.ds-drawer__content');
        if (drawerContent) drawerContent.innerHTML = adminSummaryErrorHtml();
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector('[data-activities-month-prev]')?.addEventListener('click', () => runMonthShift(-1));
    root.querySelector('[data-activities-month-next]')?.addEventListener('click', () => runMonthShift(1));
    root.querySelector(`[data-list-show-more="${ACTIVITIES_SCOPE}"]`)?.addEventListener('click', (ev) => {
      const next = Number(ev.currentTarget?.dataset?.nextCount || 200);
      ensureActivityListFilters(state, ACTIVITIES_SCOPE).visibleCount = next;
      rerenderLocal();
    });

    if (root._addActivityAbort) root._addActivityAbort.abort();
    root._addActivityAbort = new AbortController();
    const addActivitySig = { signal: root._addActivityAbort.signal };

    function refreshActivityNameSelect(form) {
      const typeSel = form.querySelector('[data-add-activity-type]');
      const nameSel = form.querySelector('[data-add-activity-name]');
      const noInput = form.querySelector('[data-add-activity-no]');
      if (!typeSel || !nameSel || !noInput) return;
      const all = decodeJsonAttr(form.dataset.addActivityNames, []);
      const type = normalizeActivityTypeKey(typeSel.value);
      const hasTagged = all.some((o) => String(o?.parent_value || o?.activity_type || '').trim());
      let list = type ? all.filter((o) => activityTypeMatches(o?.parent_value || o?.activity_type, type)) : [];
      if (type && !list.length && !hasTagged) list = all;
      const current = String(nameSel.value || '').trim();
      const currentStillValid = list.some((o) => String(o?.label || '').trim() === current);
      const nextValue = currentStillValid ? current : '';
      nameSel.innerHTML = optionsHtml(list.map((o) => o.label), nextValue, type ? 'בחרו שם פעילות' : 'בחרו קודם סוג פעילות');
      nameSel.disabled = !type;
      nameSel.value = nextValue;
      const hit = list.find((o) => String(o?.label || '').trim() === String(nameSel.value || '').trim());
      noInput.value = String(hit?.activity_no || '');
    }

    function updateAddFormByFamily(form) {
      const sourceInput = form.querySelector('input[name="source"]');
      if (sourceInput) sourceInput.value = 'catalog';

      const sessionsSel = form.querySelector('[data-add-sessions]');
      if (sessionsSel) sessionsSel.value = String(sessionsSel.value || '1') || '1';

      const typeSel = form.querySelector('[data-add-activity-type]');
      if (typeSel) {
        let allTypes = [];
        try { allTypes = JSON.parse(typeSel.dataset.allTypes || '[]'); } catch {}
        const normalizedTypes = allTypes.map((type) => normalizeActivityTypeKey(type) || type);
        typeSel.innerHTML = optionsHtml(normalizedTypes, '', 'בחרו סוג פעילות', activityTypeDisplayLabel);
      }
      refreshActivityNameSelect(form);
      syncSessionDateRows(form);
    }

    function computeNextSessionDate(baseIso, index) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(baseIso || ''))) return '';
      const base = new Date(`${baseIso}T00:00:00`);
      base.setDate(base.getDate() + (index * 7));
      return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    }

    function syncSessionDateRows(form) {
      const typeValue = String(form.querySelector('[name="activity_type"]')?.value || '').trim();
      const isOneDay = isOneDayActivityTypeValue(typeValue);
      const sessionsInput = form.querySelector('[data-add-sessions]');
      const sessionsField = form.querySelector('[data-field-sessions]');
      const oneDayDateField = form.querySelector('[data-field-one-day-date]');
      const startDateField = form.querySelector('[data-field-start-date]');
      const endDateField = form.querySelector('[data-field-end-date]');
      const sessionsDatesWrap = form.querySelector('[data-add-date-rows-wrap]');
      const startDateInput = form.querySelector('[name="start_date"]');
      const endDateInput = form.querySelector('[name="end_date"]');
      const oneDayDateInput = form.querySelector('[name="one_day_date"]');
      if (isOneDay) {
        const fallbackDate = String(oneDayDateInput?.value || startDateInput?.value || endDateInput?.value || '').trim();
        if (oneDayDateInput) oneDayDateInput.value = fallbackDate;
        if (startDateInput) startDateInput.value = fallbackDate;
        if (endDateInput) endDateInput.value = fallbackDate;
      }
      if (oneDayDateField) oneDayDateField.style.display = isOneDay ? '' : 'none';
      if (startDateField) startDateField.style.display = isOneDay ? 'none' : '';
      if (endDateField) endDateField.style.display = isOneDay ? 'none' : '';
      if (sessionsDatesWrap) sessionsDatesWrap.style.display = isOneDay ? 'none' : '';
      if (sessionsInput) {
        sessionsInput.value = isOneDay ? '1' : String(sessionsInput.value || '1');
        sessionsInput.disabled = isOneDay;
      }
      if (sessionsField) sessionsField.style.display = isOneDay ? 'none' : '';
      const sessions = isOneDay ? 1 : Math.max(1, Number(sessionsInput?.value || '1'));
      const container = form.querySelector('[data-add-date-rows]');
      if (!container) return;
      const startDate = String(form.querySelector('[name="start_date"]')?.value || '').trim();
      const prev = Array.from(container.querySelectorAll('input[data-add-session-date]')).map((input) => String(input.value || '').trim());
      container.innerHTML = Array.from({ length: sessions }, (_, idx) => {
        const value = prev[idx] || computeNextSessionDate(startDate, idx);
        return `<label class="ds-add-date-row"><span>מפגש ${idx + 1}</span><input class="ds-input ds-input--sm" type="date" data-add-session-date="${idx + 1}" value="${escapeHtml(value)}"></label>`;
      }).join('');
    }

    function bindAddActivityForm() {
      const modalContent = document.querySelector('.ds-modal__content');
      const form = modalContent?.querySelector('[data-add-activity-form]');
      if (!form || form.dataset.boundAddActivity === 'yes') return;
      form.dataset.boundAddActivity = 'yes';

      updateAddFormByFamily(form);
      syncSessionDateRows(form);
      form.querySelector('[data-add-activity-type]')?.addEventListener('change', () => {
        refreshActivityNameSelect(form);
        syncSessionDateRows(form);
      }, addActivitySig);

      form.querySelector('[data-add-activity-name]')?.addEventListener('change', () => {
        refreshActivityNameSelect(form);
      }, addActivitySig);
      form.querySelector('[data-add-sessions]')?.addEventListener('change', () => syncSessionDateRows(form), addActivitySig);
      form.querySelector('[name="start_date"]')?.addEventListener('change', () => syncSessionDateRows(form), addActivitySig);
      form.querySelector('[name="one_day_date"]')?.addEventListener('change', () => syncSessionDateRows(form), addActivitySig);
      bindEntityFieldToggle(form, 'authority');
      bindEntityFieldToggle(form, 'school');
    }

    function bindEntityFieldToggle(form, entityKey) {
      const toggleBtn = form.querySelector(`[data-entity-toggle="${entityKey}"]`);
      const selectInput = form.querySelector(`[data-entity-select="${entityKey}"]`);
      const customInput = form.querySelector(`[data-entity-custom="${entityKey}"]`);
      if (!toggleBtn || !selectInput || !customInput) return;
      let useCustom = false;
      const render = () => {
        selectInput.style.display = useCustom ? 'none' : '';
        customInput.style.display = useCustom ? '' : 'none';
        customInput.disabled = !useCustom;
        selectInput.disabled = useCustom;
        toggleBtn.textContent = useCustom
          ? (entityKey === 'authority' ? 'בחירה מהרשימה' : 'בחירה מהרשימה')
          : (entityKey === 'authority' ? '+ רשות חדשה' : '+ בית ספר חדש');
        if (useCustom) {
          selectInput.value = '';
          customInput.focus();
        } else {
          customInput.value = '';
          selectInput.focus();
        }
      };
      toggleBtn.addEventListener('click', () => {
        useCustom = !useCustom;
        render();
      }, addActivitySig);
      render();
    }

    async function submitAddActivityForm(form, submitBtn) {
      if (form.dataset.submitting === 'yes') return;
      form.dataset.submitting = 'yes';
      const statusEl = form.querySelector('[data-add-activity-status]');
      const activityMap = decodeJsonAttr(form.dataset.addActivityNames, []);
      const roster = decodeJsonAttr(form.dataset.addRosterUsers, []);
      const fd = new (window?.FormData || FormData)(form);
      const get = (k) => String(fd.get(k) || '').trim();
      const formSource = get('source') || 'catalog';
      const authorityCustom = get('authority_custom');
      const schoolCustom = get('school_custom');
      const authorityValue = authorityCustom || get('authority');
      const schoolValue = schoolCustom || get('school');
      const selectedName = get('activity_name');
      const selectedType = normalizeOneDayActivityType(get('activity_type')) || normalizeActivityTypeKey(get('activity_type'));
      const hit = activityMap.find((x) => {
        const label = String(x?.label || '').trim();
        const parent = x?.parent_value || x?.activity_type;
        return label === selectedName && activityTypeMatches(parent, selectedType);
      });
      if (!selectedType || !selectedName || !hit) {
        if (statusEl) statusEl.textContent = 'יש לבחור סוג פעילות ושם פעילות מתוך הרשימה המסוננת';
        form.dataset.submitting = 'no';
        return;
      }
      const pickEmp = (name) => {
        const u = roster.find((r) => String(r?.name || '').trim() === name);
        return String(u?.emp_id || '').trim();
      };
      const sessionsValue = get('sessions') || '1';
      const isOneDay = isOneDayActivityTypeValue(get('activity_type'));
      const oneDayDate = String(get('one_day_date') || get('start_date') || get('end_date') || '').trim();
      let meetingDateValues = [];
      const payload = {
        source: isOneDay ? 'short' : (formSource === 'short' ? 'long' : formSource),
        activity_family: isOneDay ? 'one_day' : 'program',
        activity_manager: get('activity_manager'),
        authority: authorityValue,
        school: schoolValue,
        grade: get('grade'),
        class_group: get('class_group'),
        activity_type: selectedType || get('activity_type'),
        item_type: isOneDay ? selectedType : '',
        activity_season: normalizeActivitySeason(get('activity_season')),
        activity_name: selectedName,
        activity_no: String(hit?.activity_no || get('activity_no') || ''),
        sessions: isOneDay ? '1' : sessionsValue,
        price: get('price'),
        funding: get('funding'),
        start_time: get('start_time'),
        end_time: get('end_time'),
        instructor_name: get('instructor_name'),
        emp_id: pickEmp(get('instructor_name')),
        instructor_name_2: get('instructor_name_2'),
        emp_id_2: pickEmp(get('instructor_name_2')),
        start_date: isOneDay ? oneDayDate : get('start_date'),
        end_date: isOneDay ? oneDayDate || null : get('end_date') || null,
        status: isOneDay ? 'פתוח' : 'פעיל',
        notes: get('notes')
      };
      if (isOneDay) {
        const selectedDate = String(oneDayDate || payload.start_date || payload.end_date || '').trim();
        if (selectedDate) {
          meetingDateValues = [selectedDate];
          payload.start_date = selectedDate;
          payload.end_date = selectedDate;
          payload.Date1 = selectedDate;
          payload.date_1 = selectedDate;
        }
      } else {
        const dateInputs = Array.from(form.querySelectorAll('input[data-add-session-date]'));
        meetingDateValues = dateInputs.map((input) => String(input.value || '').trim());
        dateInputs.forEach((input, index) => {
          payload[`Date${index + 1}`] = String(input.value || '').trim();
        });
      }
      if (!payload.end_date) {
        const lastDate = meetingDateValues.filter(Boolean).pop();
        payload.end_date = lastDate || payload.start_date || null;
      }

      if (isOneDay && (!String(payload.activity_name || '').trim() || GENERIC_ONE_DAY_ACTIVITY_NAMES.has(String(payload.activity_name || '').trim()))) {
        if (statusEl) statusEl.textContent = 'יש לבחור שם פעילות מתוך הרשימה';
        form.dataset.submitting = 'no';
        return;
      }

      const required = [
        ['activity_type', 'סוג פעילות'],
        ['activity_name', 'שם פעילות'],
        ['authority', 'רשות'],
        ['school', 'בית ספר'],
        ...(isOneDay ? [['start_date', 'תאריך פעילות חד־יומית'], ['end_date', 'תאריך סיום'], ['date_1', 'תאריך פעילות']] : [])
      ];
      const missing = required.filter(([key]) => !String(payload[key] || '').trim()).map(([, label]) => label);
      if (missing.length) {
        if (statusEl) statusEl.textContent = `יש להשלים שדות חובה: ${missing.join(' ,')}`;
        form.dataset.submitting = 'no';
        return;
      }

      const originalText = submitBtn?.textContent || 'שמור';
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'שומר...';
        }
        if (statusEl) statusEl.textContent = 'שומר...';
        console.info('[addActivity] submit fired');
        console.info('[addActivity] payload', payload);
        const rsp = await api.addActivity(payload);
        console.info('[addActivity] success', rsp);
        clearScreenDataCache?.();
        const hasSavedDate = !!String(payload.start_date || payload.end_date || meetingDateValues.find(Boolean) || '').trim();
        if (statusEl) statusEl.textContent = hasSavedDate
          ? 'הפעילות נשמרה'
          : 'הפעילות נשמרה ללא תאריך ותופיע ברשימת ממתינות לתיאום תאריך.';
        const activityMonth = String(payload.start_date || payload.end_date || meetingDateValues.find(Boolean) || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(activityMonth) && state.activitiesMonthYm !== activityMonth) {
          state.activitiesMonthYm = activityMonth;
        }
        ui?.closeModal?.();
        await scheduleQuietRefresh();
      } catch (err) {
        console.error('[addActivity] failed', err);
        if (statusEl) statusEl.textContent = `שגיאה בשמירה: ${String(err?.message || '')}`;
      } finally {
        form.dataset.submitting = 'no';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    }

    const modalRoot = document;
    const addActivityForm = modalRoot.querySelector('[data-add-activity-form]');
    if (addActivityForm && addActivityForm.dataset.submitBound !== 'yes') {
      addActivityForm.dataset.submitBound = 'yes';
      addActivityForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitBtn = document.querySelector('[data-add-activity-submit]');
        if (submitBtn?.disabled) return;
        await submitAddActivityForm(addActivityForm, submitBtn);
      }, addActivitySig);
    }
    if (document.body?.dataset?.globalActivitySubmitBound !== 'yes') {
      document.body.dataset.globalActivitySubmitBound = 'yes';
      document.addEventListener('submit', async (event) => {
        const form = event.target?.closest?.('[data-add-activity-form]');
        if (!form) return;
        event.preventDefault();
        const submitBtn = document.querySelector('[data-add-activity-submit]');
        if (submitBtn?.disabled) return;
        await submitAddActivityForm(form, submitBtn);
      }, addActivitySig);
    }

    document.addEventListener('click', (ev) => {
      const submit = ev.target.closest('[data-add-activity-submit]');
      if (!submit) return;
      const modal = document.querySelector('.ds-modal__content');
      const form = modal?.querySelector('[data-add-activity-form]');
      if (!form) return;
      if (submit.disabled) return;
      form.requestSubmit?.();
    }, addActivitySig);

    const addBtn = root.querySelector('[data-activities-add-btn]');
    if (canAddActivity && ui && addBtn) {
      addBtn.addEventListener('click', () => {
        ui.openModal({
          title: 'הוספת פעילות',
          // חשוב: חלון הוספת פעילות חייב להשתמש ב-client settings האחידים
          // (כמו admin), ללא בניית רשימות fallback מתוך rows חלקיים של המסך.
          content: addActivityModalHtml(state?.clientSettings || {}),
          actions: `
            <button type="button" class="ds-btn ds-btn--primary" data-add-activity-submit>שמור</button>
            <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>
          `
        });
        bindAddActivityForm();
      }, addActivitySig);
    }


    root.querySelectorAll('.ds-data-row').forEach((n) => {
      n.tabIndex = 0;
      n.setAttribute('role', 'button');
    });
    if (root._rowAbort) root._rowAbort.abort();
    root._rowAbort = new AbortController();
    const rowSig = { signal: root._rowAbort.signal };
    root.addEventListener('click', (ev) => {
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.stopPropagation();
      const rowId = rowNode.dataset.rowId;
      const hit = filteredRows.find((row) => row.RowID === rowId);
      if (!hit || !ui) return;
      openActivityDetail(hit).catch(() => {});
    }, rowSig);
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.preventDefault();
      rowNode.click();
    }, rowSig);

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('activity:')) return;
      const rowId = action.replace('activity:', '');
      const row = filteredRows.find((r) => r.RowID === rowId);
      if (!row) return;
      openActivityDetail(row).catch(() => {});
    });
  }
};
