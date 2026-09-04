import { escapeHtml } from './html.js';
import { formatDateHe, formatDateHeWithWeekday, formatTimeShort, formatTimeRangeShort, formatActivityDateColumnsHe } from './format-date.js';
import { activityManagerDisplayName, activityTypeDisplayLabel, activityTypeMatches, cleanActivityManagerName, getActivityCatalog, getManagerUsers, getContactsInstructorUsers, getRosterUsers, getValidInstructorUsers, humanDisplayText, INVALID_ACTIVITY_INSTRUCTOR_STATUS, validateInstructorBinding, NO_ACTIVITY_MANAGER_LABEL, normalizeActivityTypeKey, normalizeOneDayActivityType, resolveActivityInstructorName, resolveGradeOptions } from './activity-options.js';
import { activityAllowsSecondInstructor, schoolBelongsToAuthority, schoolsForAuthority } from './activity-form-rules.js';
import { resolveSchool2027Contact } from './school-2027-contact.js';
import { ACTIVITY_SEASON_OPTIONS, ACTIVITY_SEASON_SCHOOL_2027, activityPeriodDisplayLabel, activitySeasonLabel, normalizeActivitySeason } from './summer-activity.js';
import { isActivitySchedulingEligible } from './activity-scheduling-eligibility.js';
import { applyReadOnlyActivityCapabilities, isReadOnlyActivityRow } from './activity-readonly-period.js';
import { activityTimeOptions, normalizeActivityTime } from './activity-time-options.js';

const ONCE_TYPES = ['workshop', 'tour', 'escape_room'];
const ACTIVITY_EDIT_TYPE_ORDER = ['course', 'workshop', 'escape_room', 'tour', 'after_school'];

function timeSelectHtml({ name, value, minimum = '' }) {
  const selected = normalizeActivityTime(value);
  const safeValue = minimum && selected < minimum ? minimum : selected;
  return `<select class="ds-input" name="${escapeHtml(name)}">${safeValue ? '' : '<option value="" selected>—</option>'}${activityTimeOptions({ minimum, selected: safeValue })
    .map((time) => `<option value="${time}"${time === safeValue ? ' selected' : ''}>${time}</option>`)
    .join('')}</select>`;
}

const ACTIVITY_TYPE_PILL_LABEL = {
  course: 'קורס',
  after_school: 'אפטרסקול',
  workshop: 'סדנה',
  tour: 'סיור',
  escape_room: 'חדר בריחה',
};

const ACTIVITY_NAME_LABEL = {
  course: 'שם קורס',
  after_school: 'שם חוג אפטרסקול',
  workshop: 'שם סדנה',
  tour: 'שם סיור',
  escape_room: 'שם פעילות',
};

function activityTypeLabel(type) {
  const normalized = normalizeActivityTypeKey(type);
  return ACTIVITY_TYPE_PILL_LABEL[normalized] || activityTypeDisplayLabel(type) || 'פעילות';
}

function activityNameLabel(type) {
  return ACTIVITY_NAME_LABEL[normalizeActivityTypeKey(type)] || 'שם פעילות';
}

function fallback(v) {
  return humanDisplayText(v) || '—';
}

function managerFallback(v) {
  return activityManagerDisplayName(v);
}

function viewVal(v) {
  return humanDisplayText(v) || '';
}

function viewMgr(v) {
  return activityManagerDisplayName(v) || '';
}

function fieldViewCard(label, val) {
  return `<div class="activity-drawer__field">
    <div class="activity-drawer__label">${escapeHtml(label)}</div>
    <div class="activity-drawer__view">${escapeHtml(String(val || ''))}</div>
  </div>`;
}

function viewField(label, value) {
  const displayVal = String(value || '').trim();
  return `<div class="activity-view-field">
    <span class="activity-view-field__label">${escapeHtml(label)}</span>
    <span class="activity-view-field__value">${escapeHtml(displayVal)}</span>
  </div>`;
}

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function countDoneMeetings(schedule) {
  const today = todayStr();
  return Array.isArray(schedule)
    ? schedule.filter((m) => {
      const performed = String(m?.performed || '').trim().toLowerCase() === 'yes';
      const date = String(m?.date || '').trim();
      const autoDoneByDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
      return performed || autoDoneByDate;
    }).length
    : 0;
}

function numericOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Resolve the persisted number of meetings without treating an empty dates response as zero. */
export function resolveActivitySessionTotal(row, schedule = row?.meeting_schedule) {
  const activityType = normalizeActivityTypeKey(row?.activity_type || row?.item_type);
  if (ONCE_TYPES.includes(activityType)) return 1;

  const validCount = (value) => {
    const count = Number(value);
    return Number.isInteger(count) && count >= 1 && count <= 35 ? count : null;
  };
  const persisted = validCount(row?.sessions) ?? validCount(row?.meetings_total);
  if (persisted != null) return persisted;

  let lastPopulatedDate = 0;
  for (let index = 1; index <= 35; index += 1) {
    if (String(row?.[`date_${index}`] || '').trim()) lastPopulatedDate = index;
  }
  if (lastPopulatedDate) return lastPopulatedDate;

  const scheduleCount = Array.isArray(schedule) && schedule.length ? Math.min(35, schedule.length) : null;
  return scheduleCount || 1;
}

function normStatus(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (raw === 'closed' || raw === 'סגור') return 'closed';
  if (raw === 'פעיל' || raw === 'active' || raw === 'open' || raw === 'פתוח') return 'open';
  return 'open';
}

function statusText(status) {
  return normStatus(status) === 'closed' ? 'הסתיים' : 'פתוח';
}

function toOptions(values) {
  return (Array.isArray(values) ? values : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

/** Merge string lists from dropdown_options for alternate sheet keys (e.g. school vs schools). */
function mergeListStrings(map, keys) {
  const out = [];
  const seen = new Set();
  if (!map || typeof map !== 'object') return out;
  keys.forEach((k) => {
    const arr = map[k];
    if (!Array.isArray(arr)) return;
    arr.forEach((v) => {
      const s = String(v ?? '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
  });
  return out;
}

function buildInstructorLookup(settings) {
  const users = settings?.dropdown_options?.instructor_users;
  const map = {};
  if (!Array.isArray(users)) return map;
  users.forEach((u) => {
    const empId = String(u?.emp_id || '').trim();
    const name = String(u?.name || '').trim();
    if (empId && name && !map[empId]) map[empId] = name;
  });
  return map;
}

function resolveInstructorDisplayName(name, empId, lookup) {
  const direct = humanDisplayText(name);
  if (direct) return direct;
  const emp = String(empId || '').trim();
  if (emp && lookup?.[emp]) return lookup[emp];
  return '';
}

function instructorViewDisplay(name, empId, contactsUsers) {
  const result = validateInstructorBinding({ empId, instructorName: name }, contactsUsers);
  if (!result.valid && (empId || name)) return INVALID_ACTIVITY_INSTRUCTOR_STATUS;
  return result.name || name;
}

function normalizeActivityNameOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((o) => {
    if (typeof o === 'string') {
      const label = String(o || '').trim();
      if (label) out.push({ label, activity_no: '', parent_value: '', activity_type: '' });
      return;
    }
    if (o && typeof o === 'object') {
      const label = humanDisplayText(o.activity_name || o.label_he || o.label || o.value);
      if (!label) return;
      out.push({
        label,
        activity_no: String(o.activity_no || '').trim(),
        gefen_number: String(o.gefen_number || '').trim(),
        meetings_count: o.meetings_count ?? '',
        parent_value: normalizeActivityTypeKey(o.parent_value || o.activity_type || ''),
        activity_type: normalizeActivityTypeKey(o.activity_type || o.parent_value || '')
      });
    }
  });
  return out;
}

function instructorSelectHtml({ name, value, rosterUsers, klass = 'ds-input', placeholder = '—', attrs = '' }) {
  const safeValue = String(value || '').trim();
  const seen = new Set();
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat((Array.isArray(rosterUsers) ? rosterUsers : [])
      .map((u) => ({ name: humanDisplayText(u?.name), emp_id: String(u?.emp_id || '').trim() }))
      .filter((u) => u.name && u.emp_id)
      .filter((u) => {
        if (seen.has(u.emp_id)) return false;
        seen.add(u.emp_id);
        return true;
      })
      .map((u) => `<option value="${escapeHtml(u.emp_id)}"${u.emp_id === safeValue ? ' selected' : ''}>${escapeHtml(u.name)}</option>`))
    .join('');
  return `<select class="${escapeHtml(klass)}" name="${escapeHtml(name)}" ${attrs}>${opts}</select>`;
}

function selectHtml({ name, value, options, klass = 'ds-input', placeholder = '—', attrs = '' }) {
  const isActivityTypeField = name === 'activity_type' || name === 'item_type';
  const safeValue = isActivityTypeField
    ? normalizeActivityTypeKey(value)
    : (['authority', 'school', 'instructor_name', 'instructor_name_2', 'activity_manager', 'activity_name', 'program_name', 'name', 'title'].includes(name)
      ? humanDisplayText(value)
      : String(value || '').trim());
  const normalized = toOptions(options).map((option) => {
    if (isActivityTypeField) return normalizeActivityTypeKey(option) || option;
    if (['authority', 'school', 'instructor_name', 'instructor_name_2', 'activity_manager', 'activity_name', 'program_name', 'name', 'title'].includes(name)) return humanDisplayText(option);
    return option;
  });
  const seen = new Set();
  const unique = normalized.filter((option) => {
    if (!option || seen.has(option)) return false;
    seen.add(option);
    return true;
  });
  const all = isActivityTypeField
    ? unique
    : (unique.includes(safeValue) || !safeValue ? unique : [safeValue, ...unique]);
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(
      all.map((o) => {
        const selected = o === safeValue ? ' selected' : '';
        const label = isActivityTypeField ? (activityTypeDisplayLabel(o) || o) : o;
        return `<option value="${escapeHtml(o)}"${selected}>${escapeHtml(label)}</option>`;
      })
    )
    .join('');
  return `<select class="${escapeHtml(klass)}" name="${escapeHtml(name)}" ${attrs}>${opts}</select>`;
}

function gradeSelectHtml({ name, value, options, klass = 'ds-input', placeholder = '— בחרו כיתה —' }) {
  const safeValue = String(value || '').trim();
  const seen = new Set();
  const unique = [];
  (Array.isArray(options) ? options : []).forEach((o) => {
    const s = String(o || '').trim();
    if (s && !seen.has(s)) { seen.add(s); unique.push(s); }
  });
  if (safeValue && !seen.has(safeValue)) unique.unshift(safeValue);
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(unique.map((o) => `<option value="${escapeHtml(o)}"${o === safeValue ? ' selected' : ''}>${escapeHtml(o)}</option>`))
    .join('');
  return `<select class="${escapeHtml(klass)}" name="${escapeHtml(name)}">${opts}</select>`;
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
  const opts = activitySeasonOptions(settings)
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === safeSelected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
  return `<select class="ds-input" name="activity_season">${opts}</select>`;
}

function inputHtml({ name, value, type = 'text', klass = 'ds-input', attrs = '' }) {
  const safeValue = ['authority', 'school', 'instructor_name', 'instructor_name_2', 'activity_manager', 'activity_name', 'program_name', 'name', 'title'].includes(name)
    ? humanDisplayText(value)
    : String(value || '');
  return `<input class="${escapeHtml(klass)}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(safeValue)}" ${attrs}>`;
}

function textareaHtml({ name, value, klass = 'ds-input', rows = 3, attrs = '' }) {
  return `<textarea class="${escapeHtml(klass)}" name="${escapeHtml(name)}" rows="${rows}" ${attrs}>${escapeHtml(String(value || ''))}</textarea>`;
}

function resolveActivityNameOptions(settings, activityType) {
  const opts = (settings && settings.dropdown_options) ? settings.dropdown_options : {};
  const keys = [
    'activity_names', 'activity_name',
    'program_names', 'course_names', 'workshop_names', 'tour_names', 'escape_room_names'
  ];
  let all = [];
  for (let i = 0; i < keys.length; i++) {
    const arr = opts[keys[i]];
    if (Array.isArray(arr) && arr.length > 0) { all = normalizeActivityNameOptions(arr); break; }
  }
  if (!all.length) return [];
  const type = normalizeActivityTypeKey(activityType);
  if (!type) return all;
  const filtered = all.filter((o) => activityTypeMatches(o?.parent_value || o?.activity_type, type));
  // Fall back to full list only when nothing is tagged — avoids empty dropdown for legacy data.
  const hasTagged = all.some((o) => String(o?.parent_value || o?.activity_type || '').trim());
  return (filtered.length || hasTagged) ? filtered : all;
}

function buildActivityNameOpts(options, safeValue, activityType, selectedIdentity = {}) {
  const normalizedType = normalizeActivityTypeKey(activityType);
  if (!normalizedType) return '<option value="">בחרו קודם סוג פעילות</option>';
  const sourceOptions = Array.isArray(options) ? options : [];
  let filtered = sourceOptions.filter((o) => activityTypeMatches(o?.parent_value || o?.activity_type, normalizedType));
  const hasTagged = sourceOptions.some((o) => String(o?.parent_value || o?.activity_type || '').trim());
  if (!filtered.length && !hasTagged) filtered = sourceOptions;
  const all = filtered.slice();
  const selectedActivityNo = String(selectedIdentity.activity_no || '').trim();
  const selectedGefenNumber = String(selectedIdentity.gefen_number || '').trim();
  const hasStableSelection = Boolean(selectedActivityNo || selectedGefenNumber);
  const matchingSelectedOption = all.some((option) => {
    const label = String(option?.label || '').trim();
    const activityNo = String(option?.activity_no || '').trim();
    const gefenNumber = String(option?.gefen_number || '').trim();
    return label === safeValue && (!hasStableSelection || activityNo === selectedActivityNo || gefenNumber === selectedGefenNumber);
  });
  if (safeValue && !matchingSelectedOption) {
    all.unshift({
      label: safeValue,
      activity_no: selectedActivityNo,
      gefen_number: selectedGefenNumber,
      parent_value: normalizedType,
      activity_type: normalizedType
    });
  }
  return [`<option value="">—</option>`]
    .concat(
      all.map((o) => {
        const label = String(o?.label || '').trim();
        const selected = label === safeValue ? ' selected' : '';
        const actNo = String(o?.activity_no || '').trim();
        const gefenNumber = String(o?.gefen_number || '').trim();
        const meetingsCount = String(o?.meetings_count ?? '').trim();
        const actType = String(o?.parent_value || o?.activity_type || activityType || '').trim();
        const isStableMatch = !hasStableSelection || actNo === selectedActivityNo || gefenNumber === selectedGefenNumber;
        return `<option value="${escapeHtml(label)}" data-activity-no="${escapeHtml(actNo)}" data-gefen-number="${escapeHtml(gefenNumber)}" data-meetings-count="${escapeHtml(meetingsCount)}" data-activity-type="${escapeHtml(actType)}"${selected && isStableMatch ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      })
    )
    .join('');
}

function activityNameSelectHtml(name, value, options, activityType, selectedIdentity = {}) {
  const safeValue = String(value || '').trim();
  const normalizedType = normalizeActivityTypeKey(activityType);
  const allJson = escapeHtml(encodeURIComponent(JSON.stringify(Array.isArray(options) ? options : [])));
  const opts = buildActivityNameOpts(options, safeValue, normalizedType, selectedIdentity);
  const disabled = normalizedType ? '' : ' disabled';
  return `<select class="ds-input" name="${escapeHtml(name)}" data-role="activity-name-select" data-all-activity-names="${allJson}"${disabled}>${opts}</select>`;
}

function autoEndDate(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  return schedule
    .map((meeting) => String(meeting?.date || '').trim().slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()
    .at(-1) || '';
}

function resolvedEndDate(row) {
  return [
    autoEndDate(row),
    String(row?.end_date || '').trim().slice(0, 10)
  ]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()
    .at(-1) || '';
}

function fmtWeekdayShort(iso) {
  const formatted = formatDateHeWithWeekday(iso);
  if (!formatted || formatted === '—') return '—';
  return String(formatted).split(' · ')[0] || '—';
}

function fieldViewEdit(label, viewHtml, editHtml) {
  return `
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">${escapeHtml(label)}</div>
      <div class="activity-drawer__view" data-mode="view">${viewHtml}</div>
      <div class="activity-drawer__edit" data-mode="edit" hidden>${editHtml}</div>
    </div>
  `;
}

function fieldEditOnly(label, editHtml, extraClass = '') {
  const cls = ['activity-drawer__field', extraClass].filter(Boolean).join(' ');
  return `
    <div class="${escapeHtml(cls)}">
      <label class="activity-drawer__label">${escapeHtml(label)}</label>
      ${editHtml}
    </div>
  `;
}

function resolveAllActivityTypes() {
  return ACTIVITY_EDIT_TYPE_ORDER.slice();
}

function fieldViewOnly(label, viewHtml) {
  return `
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">${escapeHtml(label)}</div>
      <div class="activity-drawer__view" data-mode="view">${viewHtml}</div>
    </div>
  `;
}

function headerActionsHtml(exportAction) {
  return `
    <div class="activity-drawer__header-actions" aria-label="פעולות חלון">
      ${exportAction ? '<button type="button" class="activity-drawer__export" data-action="export-activity-excel" title="ייצוא פעילות לאקסל" aria-label="ייצוא פעילות לאקסל">⇩</button>' : ''}
      <button type="button" class="activity-drawer__close" data-action="close-drawer" data-ui-close-drawer aria-label="סגירה">✕</button>
    </div>
  `;
}

function headerHtml(row, { mode = 'single', summaryDate = '', exportAction = true } = {}) {
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const main = rows[0] || {};
    const instructorName = fallback(
      main.instructor_name ||
      main.instructor_name_2 ||
      main.Instructor ||
      main.Instructor2 ||
      main.Employee ||
      main.Employee2 ||
      main.emp_id ||
      main.emp_id_2 ||
      'ללא מדריך'
    );
    const dateLabel = formatDateHe(summaryDate) || fallback(summaryDate);
    return `
      <div class="activity-drawer__header">
        <div class="activity-drawer__header-top">
          <div class="activity-drawer__heading">
            <h2 class="activity-drawer__title">${escapeHtml(instructorName)}</h2>
            <div class="activity-drawer__meta">${escapeHtml(`${dateLabel} · ${rows.length} פעילויות`)}</div>
          </div>
          ${headerActionsHtml(exportAction)}
        </div>
      </div>
    `;
  }
  {
    const typeTag = activityTypeLabel(row?.activity_type);
    const statusVal = statusText(row?.status);
    const schoolVal = humanDisplayText(row?.school) || '';
    const authorityVal = humanDisplayText(row?.authority) || '';
    const isOpen = normStatus(row?.status) !== 'closed';
    const metaTags = [
      typeTag ? `<span class="activity-drawer__meta-tag">${escapeHtml(typeTag)}</span>` : '',
      statusVal ? `<span class="activity-drawer__meta-tag activity-drawer__meta-tag--status${isOpen ? ' activity-drawer__meta-tag--open' : ' activity-drawer__meta-tag--closed'}">${escapeHtml(statusVal)}</span>` : '',
      authorityVal ? `<span class="activity-drawer__meta-tag">${escapeHtml(authorityVal)}</span>` : '',
      schoolVal ? `<span class="activity-drawer__meta-tag">${escapeHtml(schoolVal)}</span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="activity-drawer__header activity-drawer__header--sticky">
        <div class="activity-drawer__header-top">
          <div class="activity-drawer__heading">
            <h2 class="activity-drawer__title">${escapeHtml(fallback(row?.activity_name))}</h2>
            <div class="activity-drawer__meta activity-drawer__meta--tags">${metaTags}</div>
          </div>
          ${headerActionsHtml(exportAction)}
        </div>
      </div>
    `;
  }
}

function blockActivityDetails(row, { settings = {} } = {}) {
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const allActivityNames = resolveActivityNameOptions(settings, '');
  if (!allActivityNames.length) {
    // eslint-disable-next-line no-console
    console.warn('[activity-edit] activity name options missing from client settings');
  }
  const isOneDay = Boolean(normalizeOneDayActivityType(activityType));
  const is2027Row = normalizeActivitySeason(row.activity_season) === ACTIVITY_SEASON_SCHOOL_2027;
  const statusOptions = is2027Row
    ? ['פתוח', 'בתהליך', 'סגור']
    : ['פתוח', 'מאושר - ממתין לשיבוץ', 'סגור'];
  const rawStatus = String(row.status || '').trim();
  const status2027Normalized = rawStatus === 'מוכן לשיבוץ' ? 'בתהליך' : rawStatus;
  const normalizedStatus = statusOptions.includes(is2027Row ? status2027Normalized : rawStatus)
    ? (is2027Row ? status2027Normalized : rawStatus)
    : (is2027Row ? 'בתהליך' : (normStatus(row.status) === 'closed' ? 'סגור' : 'פתוח'));

  return `
    <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden>
      <h3 class="activity-drawer__section-title">פרטי פעילות</h3>
      <div class="activity-drawer__details-edit-grid">
        ${fieldEditOnly(
          'סוג פעילות',
          selectHtml({ name: 'activity_type', value: activityType, options: resolveAllActivityTypes(settings), placeholder: 'בחרו סוג פעילות' })
        )}
        ${fieldEditOnly(
          activityNameLabel(activityType),
          activityNameSelectHtml('activity_name', row.activity_name || row.program_name || row.title || row.name, allActivityNames, activityType, row),
          'activity-drawer__field--full'
        )}
        ${fieldEditOnly(
          'סטטוס',
          selectHtml({ name: 'status', value: normalizedStatus, options: statusOptions, placeholder: 'פתוח' })
        )}
        ${is2027Row ? fieldEditOnly(
          'תחום פעילות',
          selectHtml({
            name: 'activity_domain',
            value: ['E', 'Y'].includes(String(row.activity_domain || '').trim().toUpperCase())
              ? String(row.activity_domain).trim().toUpperCase()
              : '',
            options: ['E', 'Y'],
            placeholder: 'בחרו תחום'
          })
        ) : ''}
      </div>
    </section>
  `;
}

function blockAssignment(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const schoolRecords = Array.isArray(options.school_records) ? options.school_records : [];
  const authorities = mergeListStrings(options, ['authority', 'authorities']);
  const grades = resolveGradeOptions(settings);
  const authorityId = String(row.authority_id || '').trim();
  const schools = schoolsForAuthority(schoolRecords, authorityId).map((school) => school.name || school.value).filter(Boolean);
  const invalidSchoolLink = Boolean(row.school_id && authorityId && !schoolBelongsToAuthority(schoolRecords, row.school_id, authorityId));

  return `
    <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden>
      <h3 class="activity-drawer__section-title">שיוך ומיקום</h3>
      <div class="activity-drawer__details-edit-grid">
        ${fieldEditOnly(
          'רשות',
          authorities.length
            ? selectHtml({ name: 'authority', value: row.authority, options: authorities, attrs: 'data-role="activity-authority"' })
            : inputHtml({ name: 'authority', value: row.authority, attrs: 'data-role="activity-authority"' })
        )}
        <input type="hidden" name="authority_id" value="${escapeHtml(authorityId)}" data-role="activity-authority-id">
        ${fieldEditOnly(
          'בית ספר',
          `${inputHtml({ name: 'school', value: row.school, type: 'search', attrs: `list="activity-school-list" autocomplete="off" placeholder="חיפוש בית ספר…" data-role="activity-school"` })}
          <datalist id="activity-school-list" data-role="activity-school-options">${schools.map((school) => `<option value="${escapeHtml(school)}"></option>`).join('')}</datalist>
          ${invalidSchoolLink ? '<p class="ds-error-text" role="alert">בית הספר השמור אינו שייך לרשות של הפעילות. יש לתקן את השיוך לפני השמירה.</p>' : ''}`
        )}
        <input type="hidden" name="school_id" value="${escapeHtml(String(row.school_id || ''))}" data-role="activity-school-id">
        ${fieldEditOnly(
          'כיתה / קבוצה',
          `<div class="activity-drawer__field-controls activity-drawer__field-controls--inline">
            ${gradeSelectHtml({ name: 'grade', value: row.grade, options: grades })}
            ${inputHtml({ name: 'class_group', value: row.class_group, attrs: 'placeholder="קבוצה"' })}
          </div>`
        )}
      </div>
    </section>
  `;
}

function blockTeamTimes(row, { settings = {}, schedulingManaged = false } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = getManagerUsers(settings || {});
  const rosterUsers = getValidInstructorUsers(settings || {});
  const instructorLookup = buildInstructorLookup(settings);
  const contactsUsers = getContactsInstructorUsers(settings || {});
  const legacyRosterUsers = getRosterUsers(settings || {});
  const instructor1Display = resolveActivityInstructorName(row) || resolveInstructorDisplayName(row.instructor_name, row.emp_id, instructorLookup);
  const instructor2Display = resolveActivityInstructorName(row, { secondary: true }) || resolveInstructorDisplayName(row.instructor_name_2, row.emp_id_2, instructorLookup);
  const instructor1EmpId = String(row.emp_id || '').trim();
  const instructor2EmpId = String(row.emp_id_2 || '').trim();
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const twoInstructors = activityAllowsSecondInstructor(row, getActivityCatalog(settings));
  try {
    console.info('[activity-edit][instructors-options]', {
      contacts_count: contactsUsers.length,
      roster_count: legacyRosterUsers.length,
      valid_count: rosterUsers.length,
      selected_emp_id: instructor1EmpId,
      selected_instructor_name: instructor1Display
    });
  } catch (_) { /* diagnostic only */ }
  const instructorBindingWarning = [
    validateInstructorBinding({ empId: instructor1EmpId, instructorName: instructor1Display }, rosterUsers),
    validateInstructorBinding({ empId: instructor2EmpId, instructorName: instructor2Display }, rosterUsers)
  ].some((result) => !result.valid)
    ? '<p class="ds-error-text">בפעילות זו קיים שיוך למדריך שאינו קיים בטבלת המדריכים. יש לבחור מדריך מחדש.</p>'
    : '';
  const instructorEditHtml = schedulingManaged
    ? `<div class="activity-drawer__view">${escapeHtml(instructor1Display || 'טרם שובץ')}</div>`
    : twoInstructors
    ? `<div class="activity-drawer__field-controls activity-drawer__field-controls--stacked">
        <input type="hidden" name="instructor_name" value="${escapeHtml(instructor1Display)}">
        <input type="hidden" name="instructor_name_2" value="${escapeHtml(instructor2Display)}">
        ${instructorSelectHtml({ name: 'emp_id', value: instructor1EmpId, rosterUsers })}
        ${instructorSelectHtml({ name: 'emp_id_2', value: instructor2EmpId, rosterUsers })}
        ${instructorBindingWarning}
      </div>`
    : `<input type="hidden" name="instructor_name" value="${escapeHtml(instructor1Display)}">${instructorSelectHtml({ name: 'emp_id', value: instructor1EmpId, rosterUsers })}${instructorBindingWarning}`;

  return `
    <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden>
      <h3 class="activity-drawer__section-title">צוות וזמנים</h3>
      <div class="activity-drawer__details-edit-grid">
        ${fieldEditOnly(
          'מנהל פעילות',
          selectHtml({ name: 'activity_manager', value: cleanActivityManagerName(row.activity_manager), options: managers, placeholder: NO_ACTIVITY_MANAGER_LABEL })
        )}
        ${fieldEditOnly(twoInstructors ? 'מדריך/ה 1 + 2' : 'מדריך/ה', instructorEditHtml)}
        ${fieldEditOnly(
          'שעת התחלה / סיום',
          `<div class="activity-drawer__field-controls activity-drawer__field-controls--inline">
            ${timeSelectHtml({ name: 'start_time', value: formatTimeShort(row.start_time) })}
            ${timeSelectHtml({ name: 'end_time', value: formatTimeShort(row.end_time), minimum: normalizeActivityTime(row.start_time) })}
          </div>`,
          'activity-drawer__field--hours'
        )}
      </div>
    </section>
  `;
}

function blockExtraEditInfo(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};

  return `
    <section class="activity-drawer__section activity-drawer__section--edit-group activity-drawer__section--funding-gefen">
      <h3 class="activity-drawer__section-title">מידע משלים</h3>
      <div class="activity-drawer__details-edit-grid">
        <div data-mode="edit" hidden>
          ${fieldEditOnly(
            'גורם מימון',
            `<select class="ds-input" name="funding_sources" multiple size="3" data-scheduling-multi>
            ${(options.funding_source_records || []).map((source) => {
              const linked = (row.funding_sources || []).find((item) => String(item.id) === String(source.id));
              return `<option value="${escapeHtml(source.id)}"${linked ? ' selected' : ''} data-funding-amount="${escapeHtml(String(linked?.amount ?? ''))}" data-initial-funding-amount="${escapeHtml(String(linked?.amount ?? ''))}">${escapeHtml(source.name)}</option>`;
            }).join('')}
            </select>`
          )}
        </div>
        <label class="activity-drawer__gefen-exists">
          <input type="checkbox" name="exists_in_gefen" data-gefen-exists-checkbox value="true"${row.exists_in_gefen === true ? ' checked' : ''} disabled>
          <span>מופיע בגפ״ן</span>
        </label>
        <div data-mode="edit" hidden>${fieldEditOnly('מחיר', inputHtml({ name: 'price', value: row.price }))}</div>
      </div>
    </section>
  `;
}

function blockContact2027(row) {
  const resolvedContact = row.resolved_school_2027_contact || resolveSchool2027Contact(row, []);
  const contactName  = String(resolvedContact.name || row.contact_name || '').trim();
  const contactPhone = String(resolvedContact.phone || row.contact_phone || '').trim();
  const contactEmail = String(resolvedContact.email || row.contact_email || '').trim();
  const schoolContactId = String(row.school_contact_id || '').trim();
  const schoolId   = String(row.school_id  || '').trim();
  const school     = String(row.school     || '').trim();
  const authority  = String(row.authority  || '').trim();

  const viewParts = [
    contactName  ? `<span class="activity-view-field__value">${escapeHtml(contactName)}</span>`  : '',
    contactPhone ? `<a class="activity-view-field__value" href="tel:${escapeHtml(contactPhone)}">${escapeHtml(contactPhone)}</a>` : '',
    contactEmail ? `<a class="activity-view-field__value" href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>` : ''
  ].filter(Boolean);
  const viewHtml = viewParts.join('<br>') || '<span class="activity-view-field__value" style="color:var(--color-text-muted)">—</span>';

  return `
    <section class="activity-drawer__section" data-contact-2027-section
      data-school-id="${escapeHtml(schoolId)}"
      data-school="${escapeHtml(school)}"
      data-authority="${escapeHtml(authority)}"
      data-current-contact-id="${escapeHtml(schoolContactId)}">

      <h3 class="activity-drawer__section-title">איש קשר</h3>

      <!-- Always-present hidden inputs — submitted with every form save -->
      <input type="hidden" name="school_contact_id" data-contact-2027-id-input value="${escapeHtml(schoolContactId)}">
      <input type="hidden" name="contact_name"      data-contact-2027-hidden-name  value="${escapeHtml(contactName)}">
      <input type="hidden" name="contact_phone"     data-contact-2027-hidden-phone value="${escapeHtml(contactPhone)}">
      <input type="hidden" name="contact_email"     data-contact-2027-hidden-email value="${escapeHtml(contactEmail)}">

      <!-- View mode -->
      <div class="activity-view-card__grid" data-mode="view">
        <div class="activity-view-field">
          <span class="activity-view-field__label">פרטי קשר</span>
          <span data-contact-2027-view-wrap>${viewHtml}</span>
        </div>
      </div>

      <!-- Edit mode UI (no named inputs here — updates hidden inputs above) -->
      <div class="activity-drawer__details-edit-grid" data-mode="edit" hidden>
        <div style="padding:2px 0 8px">
          <label style="display:block;font-size:0.82em;font-weight:600;margin-bottom:4px;color:var(--color-text-muted,#64748b)">איש קשר</label>

          <!-- Dropdown (no name — JS updates the hidden input) -->
          <select class="ds-input" data-contact-2027-select style="width:100%">
            <option value="">טוען אנשי קשר...</option>
          </select>

          <!-- Preview of selected contact -->
          <div data-contact-2027-preview style="display:none;margin-top:6px;font-size:0.85em;padding:6px 10px;background:var(--color-bg-secondary,#f1f5f9);border-radius:6px;line-height:1.5">
            <div data-contact-2027-pname style="font-weight:600"></div>
            <div data-contact-2027-prole style="color:var(--color-text-muted,#64748b)"></div>
            <div data-contact-2027-pphone style="color:var(--color-text-muted,#64748b)"></div>
            <div data-contact-2027-pemail style="color:var(--color-text-muted,#64748b)"></div>
          </div>

          <!-- Inline add-new form (hidden by default) -->
          <div data-contact-2027-add-form style="display:none;margin-top:8px;padding:10px;border:1px solid var(--color-border,#e2e8f0);border-radius:8px">
            <div style="font-size:0.85em;font-weight:600;margin-bottom:8px;color:var(--color-text,#1e293b)">הוספת איש קשר חדש</div>
            <input type="text"  class="ds-input" placeholder="שם איש קשר *"  data-new-contact-name  style="margin-bottom:4px;width:100%">
            <input type="text"  class="ds-input" placeholder="תפקיד"          data-new-contact-role  style="margin-bottom:4px;width:100%">
            <input type="tel"   class="ds-input" placeholder="נייד"           data-new-contact-phone style="margin-bottom:4px;width:100%" dir="ltr">
            <input type="email" class="ds-input" placeholder="מייל"           data-new-contact-email style="margin-bottom:6px;width:100%" dir="ltr">
            <div data-new-contact-error style="color:var(--color-danger,#e53e3e);font-size:0.8em;min-height:1em;margin-bottom:4px"></div>
            <div style="display:flex;gap:8px">
              <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-contact-2027-save-new>שמור איש קשר</button>
              <button type="button" class="ds-btn ds-btn--sm"                 data-contact-2027-cancel-new>ביטול</button>
            </div>
          </div>

          <!-- Add-new trigger -->
          <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-contact-2027-add-btn
            style="margin-top:8px;font-size:0.82em;padding:4px 8px">+ הוסף איש קשר חדש</button>
        </div>
      </div>
    </section>
  `;
}

function blockViewOnce(row, { settings = {}, hideFunding = false } = {}) {
  const instructorLookup = buildInstructorLookup(settings);
  const contactsUsers = getValidInstructorUsers(settings || {});
  const instr1 = instructorViewDisplay(
    resolveActivityInstructorName(row) || resolveInstructorDisplayName(row.instructor_name, row.emp_id, instructorLookup),
    row.emp_id, contactsUsers
  );
  const instr2 = instructorViewDisplay(
    resolveActivityInstructorName(row, { secondary: true }) || resolveInstructorDisplayName(row.instructor_name_2, row.emp_id_2, instructorLookup),
    row.emp_id_2, contactsUsers
  );
  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ');
  const hoursLabel = (String(row.start_time || '').trim() && String(row.end_time || '').trim())
    ? formatTimeRangeShort(row.start_time, row.end_time)
    : '';
  const fundingDisplay = String(row.funding || '').trim();
  const twoInstructors = activityAllowsSecondInstructor(row, getActivityCatalog(settings));

  return `
    <section class="activity-view-card activity-view-card--once" data-mode="view" data-central-info-section>
      <div class="activity-view-card__grid">
        ${viewField('מנהל פעילות', viewMgr(row.activity_manager))}
        ${viewField(twoInstructors ? 'מדריך/ה 1' : 'מדריך/ה', viewVal(instr1))}
        ${twoInstructors ? viewField('מדריך/ה 2', viewVal(instr2)) : ''}
        ${viewField('כיתה / קבוצה', classLabel)}
        ${viewField('שעות', hoursLabel)}
        ${hideFunding ? '' : viewField('מימון', fundingDisplay)}
      </div>
    </section>
  `;
}

function blockViewCourse(row, { settings = {} } = {}) {
  const instructorLookup = buildInstructorLookup(settings);
  const contactsUsers = getValidInstructorUsers(settings || {});
  const instr1 = instructorViewDisplay(
    resolveActivityInstructorName(row) || resolveInstructorDisplayName(row.instructor_name, row.emp_id, instructorLookup),
    row.emp_id, contactsUsers
  );
  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ');
  const hoursLabel = (String(row.start_time || '').trim() && String(row.end_time || '').trim())
    ? formatTimeRangeShort(row.start_time, row.end_time)
    : '';

  return `
    <section class="activity-view-card activity-view-card--course" data-mode="view" data-central-info-section>
      <div class="activity-view-card__grid">
        ${viewField('מנהל פעילות', viewMgr(row.activity_manager))}
        ${viewField('מדריך/ה', viewVal(instr1))}
        ${viewField('כיתה / קבוצה', classLabel)}
        ${viewField('שעות', hoursLabel)}
      </div>
    </section>
  `;
}

function blockCentralInfo(row, { settings = {}, hideFunding = false } = {}) {
  const instructorLookup = buildInstructorLookup(settings);
  const contactsUsers = getValidInstructorUsers(settings || {});
  const instructor1Display = instructorViewDisplay(resolveActivityInstructorName(row) || resolveInstructorDisplayName(row.instructor_name, row.emp_id, instructorLookup), row.emp_id, contactsUsers);
  const instructor2Display = instructorViewDisplay(resolveActivityInstructorName(row, { secondary: true }) || resolveInstructorDisplayName(row.instructor_name_2, row.emp_id_2, instructorLookup), row.emp_id_2, contactsUsers);
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const twoInstructors = activityAllowsSecondInstructor(row, getActivityCatalog(settings));
  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ') || '—';
  const hoursLabel =
    String(row.start_time || '').trim() && String(row.end_time || '').trim()
      ? formatTimeRangeShort(row.start_time, row.end_time)
      : '—';
  const fundingDisplay = String(row.funding || '').trim() || '—';

  return `
    <section class="activity-drawer__section activity-drawer__section--central" data-mode="view" data-central-info-section>
      <h3 class="activity-drawer__section-title">מידע מרכזי</h3>
      <div class="activity-drawer__grid activity-drawer__grid--three activity-drawer__view-grid">
        ${fieldViewOnly('מנהל פעילות', escapeHtml(managerFallback(row.activity_manager)))}
        ${fieldViewOnly(twoInstructors ? 'מדריך/ה 1' : 'מדריך/ה', escapeHtml(fallback(instructor1Display)))}
        ${twoInstructors ? fieldViewOnly('מדריך/ה 2', escapeHtml(fallback(instructor2Display))) : ''}
        ${fieldViewOnly('כיתה / קבוצה', escapeHtml(classLabel))}
        ${fieldViewOnly('שעות', escapeHtml(hoursLabel))}
        ${hideFunding ? '' : fieldViewOnly('מימון', escapeHtml(fundingDisplay))}
      </div>
    </section>
  `;
}

function presentValueText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Period, funding, price and participant count come from the full activity record.
 * Each field renders only when the record actually holds a value, so an empty field
 * is never displayed as an invented value.
 */
function blockViewRecordDetails(row, { instructorLimited = false, showFunding = false, showParticipants = true } = {}) {
  if (instructorLimited) return '';
  const candidates = [
    ['תקופת הפעילות', activityPeriodDisplayLabel(row)],
    ...(showFunding ? [['מימון', presentValueText(row.funding)]] : []),
    ['מחיר', presentValueText(row.price)],
    ...(showParticipants ? [['מספר משתתפים', presentValueText(row.participants_count)]] : [])
  ].filter(([, value]) => value);
  if (!candidates.length) return '';
  return `
    <section class="activity-view-card activity-view-card--record" data-mode="view" data-record-details-section>
      <div class="activity-view-card__grid">
        ${candidates.map(([label, value]) => viewField(label, value)).join('')}
      </div>
    </section>
  `;
}

function blockAdditionalSupplemental(row, { hideSeason = false } = {}) {
  if (hideSeason) return '';
  const seasonDisplay = activitySeasonLabel(row.activity_season);
  const seasonValue = String(seasonDisplay || '').trim();
  if (!seasonValue || seasonValue === '—') return '';
  return `
    <section class="activity-drawer__section activity-drawer__section--supplemental" data-mode="view">
      <h3 class="activity-drawer__section-title">מידע משלים נוסף</h3>
      <div class="activity-drawer__grid activity-drawer__grid--three activity-drawer__view-grid">
        ${fieldViewOnly('עונת פעילות', escapeHtml(seasonDisplay))}
      </div>
    </section>
  `;
}

function buildDateChipsHtml(schedule, isOnce) {
  const source = isOnce ? schedule.slice(0, 1) : schedule;
  const grouped = source.reduce((acc, item) => {
    const date = String(item?.date || '').trim();
    if (!date) return acc;
    const key = date;
    if (!acc.has(key)) {
      acc.set(key, { item, count: 0, doneCount: 0, notes: [] });
    }
    const entry = acc.get(key);
    entry.count += 1;
    const performed = String(item?.performed || '').toLowerCase() === 'yes';
    const autoDoneByDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < todayStr();
    if (performed || autoDoneByDate) entry.doneCount += 1;
    const note = String(item?.note || '').trim();
    if (note && !entry.notes.includes(note)) entry.notes.push(note);
    return acc;
  }, new Map());

  return Array.from(grouped.values())
    .map(({ item, count, doneCount, notes }) => {
      const date = String(item?.date || '').trim();
      const isDone = doneCount > 0;
      const countLabel = count > 1 ? ` · ${count} מפגשים` : '';
      const noteText = notes.join('\n');
      const noteIcon = noteText
        ? `<span class="activity-drawer__date-note-icon" role="img" tabindex="0" title="${escapeHtml(noteText)}" aria-label="הערה למפגש: ${escapeHtml(noteText)}">💬</span>`
        : '';
      return `
        <div class="activity-drawer__date-chip ${isDone ? 'is-done' : ''}" data-date-card>
          <span class="activity-drawer__date-line">${escapeHtml(formatDateHe(date))}<span aria-hidden="true"> · </span><span class="activity-drawer__weekday">${escapeHtml(fmtWeekdayShort(item?.date || ''))}</span>${escapeHtml(countLabel)}</span>
          ${noteIcon}
        </div>
      `;
    })
    .join('') || '';
}

function missingDatesWarningHtml(total, schedule = []) {
  const dated = (Array.isArray(schedule) ? schedule : []).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '').trim())).length;
  const missing = Math.max(0, Number(total || 0) - dated);
  return `<div class="activity-drawer__missing-dates-warning" data-dates-missing-warning${missing ? '' : ' hidden'}>${missing ? `חסרים תאריכים ל־${missing} מפגשים` : ''}</div>`;
}

function buildOneDayViewHtml(schedule, row, datesLoading) {
  if (datesLoading) {
    return `<div class="activity-drawer__oneday-info" data-mode="view" data-dates-view-chips>
      <div class="activity-drawer__date-chip ds-muted" aria-busy="true">טוען...</div>
    </div>`;
  }
  const firstMeeting = schedule[0] || {};
  const dateVal = String(firstMeeting?.date || '').trim();
  const dateDisplay = dateVal ? formatDateHe(dateVal) : '';
  const weekdayDisplay = dateVal ? fmtWeekdayShort(dateVal) : '';
  const noteText = String(firstMeeting?.note || '').trim();
  const noteIcon = noteText
    ? `<span class="activity-drawer__date-note-icon" role="img" tabindex="0" title="${escapeHtml(noteText)}" aria-label="הערה למפגש: ${escapeHtml(noteText)}">💬</span>`
    : '';
  return `<div class="activity-drawer__oneday-info" data-mode="view" data-dates-view-chips>
    ${dateDisplay || weekdayDisplay ? `<div class="activity-drawer__date-chip">
      <span data-oneday-date-display>${escapeHtml(dateDisplay)}</span>
      ${weekdayDisplay ? `<span class="activity-drawer__weekday" data-oneday-weekday-display>${escapeHtml(weekdayDisplay)}</span>` : `<span data-oneday-weekday-display></span>`}${noteIcon}
    </div>` : `<div class="activity-drawer__date-chip activity-drawer__date-chip--empty">
      <span data-oneday-date-display></span><span data-oneday-weekday-display></span>
    </div>`}
  </div>`;
}

function blockDates(row, { canEdit = false, canDirectEdit = false, datesLoading = false, is2027 = false } = {}) {
  const loadedSchedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const isOnce = ONCE_TYPES.includes(activityType);
  const isCourse = activityType === 'course';
  const isAfterSchool = activityType === 'after_school';
  if (!isOnce && !isCourse && !isAfterSchool) return '';
  const total = resolveActivitySessionTotal(row, loadedSchedule);
  const schedule = Array.from({ length: isOnce ? 1 : total }, (_, index) => loadedSchedule[index] || {
    date: String(row?.[`date_${index + 1}`] || '').trim(),
    performed: 'no',
    note: ''
  });
  const loadingAttr = datesLoading ? ' data-dates-loading="true"' : '';

  if (isOnce) {
    const firstMeeting = schedule[0] || {};
    const dateVal = String(firstMeeting?.date || '').trim();
    const oneDayEditCard = `
      <div class="activity-drawer__date-card" data-meeting-index="0">
        <div class="activity-drawer__date-card-top">
          <span class="activity-drawer__meeting-index">תאריך הפעילות</span>
          <span class="activity-drawer__date-card-top-aside">
            <span class="activity-drawer__weekday">${escapeHtml(fmtWeekdayShort(dateVal))}</span>
          </span>
        </div>
        ${inputHtml({
          name: 'meeting_date_0',
          value: dateVal,
          type: 'date',
          attrs: 'data-role="meeting-date" data-meeting-index="0" data-meeting-idx="0" data-oneday-date',
        })}
        <input type="hidden" name="meeting_performed_0" value="${escapeHtml(String(firstMeeting?.performed || 'no'))}">
        ${is2027 ? `<textarea class="ds-input" name="meeting_note_0" rows="1" placeholder="הערה לתאריך זה" data-meeting-note-idx="0" style="margin-top:4px;font-size:0.85em;resize:vertical">${escapeHtml(String(firstMeeting?.note || ''))}</textarea>` : ''}
      </div>
    `;
    return `
      <section class="activity-drawer__section activity-drawer__section--once-dates" data-dates-section${loadingAttr}>
        <div class="activity-drawer__section-head" data-mode="edit" hidden>
          <h3 class="activity-drawer__section-title">מועד הפעילות</h3>
        </div>
        ${buildOneDayViewHtml(schedule, row, datesLoading)}
        <div class="activity-drawer__dates activity-drawer__dates--edit" data-mode="edit" data-meeting-dates-edit hidden>
          ${oneDayEditCard}
        </div>
      </section>
    `;
  }

  const computedEnd = resolvedEndDate(row);
  const doneFromSchedule = countDoneMeetings(schedule);
  const doneFallback = numericOrNull(row?.meetings_done);
  const done = doneFromSchedule > 0 ? doneFromSchedule : (doneFallback ?? 0);
  // `sessions` is the persisted activity-level contract.  The dates endpoint can
  // legitimately return an empty/partial schedule, so it must not collapse an
  // existing 11-session course back to "0 מתוך 1" while dates are loading.
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const viewChips = buildDateChipsHtml(schedule, false);
  const datePickers = schedule
    .map((item, i) => `
      <div class="activity-drawer__date-card" data-meeting-index="${i}">
        <div class="activity-drawer__date-card-top">
          <span class="activity-drawer__meeting-index">מפגש ${i + 1}</span>
          <span class="activity-drawer__date-card-top-aside">
            <button type="button" class="activity-drawer__date-remove" data-action="remove-meeting" aria-label="הסר מפגש">🗑</button>
            <span class="activity-drawer__weekday">${escapeHtml(fmtWeekdayShort(item?.date || ''))}</span>
          </span>
        </div>
        ${inputHtml({
          name: `meeting_date_${i}`,
          value: String(item?.date || ''),
          type: 'date',
          attrs: `data-role="meeting-date" data-meeting-index="${i}" data-meeting-idx="${i}"`,
        })}
        <input type="hidden" name="meeting_performed_${i}" value="${escapeHtml(String(item?.performed || 'no'))}">
        ${is2027 ? `<textarea class="ds-input" name="meeting_note_${i}" rows="1" placeholder="הערה למפגש זה" data-meeting-note-idx="${i}" style="margin-top:4px;font-size:0.85em;resize:vertical">${escapeHtml(String(item?.note || ''))}</textarea>` : ''}
      </div>
    `)
    .join('');

  const dateSummaryHtml = `<div class="activity-drawer__date-summary" data-mode="view">
    ${isCourse ? `<div class="activity-drawer__date-boundary"><span class="activity-drawer__end-date__label">תאריך התחלה:</span>
      <strong data-computed-start-display>${escapeHtml(formatDateHe(row.start_date || schedule[0]?.date) || '')}</strong></div>` : ''}
    <div class="activity-drawer__date-boundary"><span class="activity-drawer__end-date__label">תאריך סיום:</span>
      <strong data-computed-end-display>${datesLoading ? '' : escapeHtml(formatDateHe(computedEnd) || '')}</strong></div>
  </div>`;
  const progressHtml = datesLoading
    ? `${dateSummaryHtml}<div class="activity-drawer__progress-row" data-mode="view"><div class="activity-drawer__progress" data-dates-progress>
        <div class="activity-drawer__progress-meta" data-dates-progress-meta>
          <span class="ds-muted">טוען תאריכי מפגשים...</span>
          <span></span>
        </div>
        <div class="activity-drawer__progress-track">
          <div class="activity-drawer__progress-fill" style="width:0%"></div>
        </div>
      </div>
      </div>
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view" data-dates-view-chips>
        <div class="activity-drawer__date-chip ds-muted" aria-busy="true">טוען...</div>
      </div>
      <div class="activity-drawer__missing-dates-warning" data-dates-missing-warning hidden></div>`
    : `${dateSummaryHtml}<div class="activity-drawer__progress-row" data-mode="view"><div class="activity-drawer__progress" data-dates-progress>
        <div class="activity-drawer__progress-meta" data-dates-progress-meta>
          <span>${done} מתוך ${total} מפגשים</span>
          <span>${progressPct}%</span>
        </div>
        <div class="activity-drawer__progress-track">
          <div class="activity-drawer__progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
      </div>
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view" data-dates-view-chips>
        ${viewChips}
      </div>
      ${missingDatesWarningHtml(total, schedule)}`;

  const progressTitle = isCourse ? 'התקדמות הקורס' : 'מפגשים ותאריכים';
  return `
    <section class="activity-drawer__section activity-drawer__section--course-dates" data-dates-section data-session-total="${total}"${loadingAttr}>
      <div class="activity-drawer__section-head">
        <h3 class="activity-drawer__section-title">${escapeHtml(progressTitle)}</h3>
      </div>
      ${progressHtml}
      <div class="activity-drawer__dates activity-drawer__dates--edit" data-mode="edit" data-meeting-dates-edit hidden>
        ${datePickers}
      </div>
      <div class="activity-drawer__date-mode" data-mode="edit" data-chain-toggle hidden>
        <button type="button" class="activity-drawer__toggle is-active" data-date-mode="single">תיקון נקודתי — רק המפגש הזה</button>
        <button type="button" class="activity-drawer__toggle" data-date-mode="chain">תיקון שרשרת — המפגש הזה וכל הבאים אחריו</button>
      </div>
      <button type="button" class="activity-drawer__action activity-drawer__action--ghost" data-action="add-meeting" data-mode="edit" hidden>➕ הוסף מפגש</button>
    </section>
  `;
}


function blockViewFooter({ canEdit = false, canDirectEdit = false } = {}) {
  if (!canEdit) return '';
  const label = canDirectEdit ? 'עריכה' : 'בקשת שינוי';
  return `
    <div class="activity-drawer__view-footer" data-mode="view">
      <button type="button" class="activity-drawer__action activity-drawer__action--primary activity-drawer__view-footer__btn" data-action="start-edit">✏ ${escapeHtml(label)}</button>
    </div>
  `;
}

function blockEditActions({ canEdit = false, canDirectEdit = false, canDeleteActivity = false } = {}) {
  if (!canEdit && !canDeleteActivity) return '';
  const requestOnlyEdit = canEdit && !canDirectEdit;
  return `
    <section class="activity-drawer__section activity-drawer__section--actions" data-mode="edit" hidden>
      <div class="activity-drawer__edit-actions">
        ${canEdit ? `<button type="button" class="activity-drawer__action activity-drawer__action--primary" data-action="save-edit">${requestOnlyEdit ? 'שליחת בקשת עריכה לאישור' : 'שמור'}</button>
        <button type="button" class="activity-drawer__action" data-action="cancel-edit">ביטול</button>` : ''}
        ${canDeleteActivity ? '<button type="button" class="activity-drawer__action activity-drawer__action--danger" data-action="delete-activity">מחיקת פעילות</button>' : ''}
        <p class="ds-activity-edit-status ds-muted" role="status"></p>
      </div>
    </section>
  `;
}

/**
 * Surgically patches the view-mode date elements inside an already-open drawer's
 * dates section. Called after activityDates resolves so we avoid re-rendering the
 * full drawer (which would lose edit-form bindings and cause a visible flash).
 *
 * @param {Element} sectionEl  — element with [data-dates-section]
 * @param {object}  datesData  — response from api.activityDates
 */
export function patchDrawerDatesSection(sectionEl, datesData) {
  if (!sectionEl) return;
  const schedule = Array.isArray(datesData?.meeting_schedule) ? datesData.meeting_schedule : [];
  const activityType = normalizeActivityTypeKey(datesData?.activity_type || datesData?.item_type || '');
  const isOnce = ONCE_TYPES.includes(activityType);

  if (isOnce) {
    const firstMeeting = schedule[0] || {};
    const dateVal = String(firstMeeting?.date || '').trim();
    const dateEl = sectionEl.querySelector('[data-oneday-date-display]');
    if (dateEl) dateEl.textContent = dateVal ? formatDateHe(dateVal) : '';
    const weekdayEl = sectionEl.querySelector('[data-oneday-weekday-display]');
    if (weekdayEl) weekdayEl.textContent = dateVal ? fmtWeekdayShort(dateVal) : '';
    const oneDayInput = sectionEl.querySelector('[data-meeting-dates-edit] input[data-meeting-idx="0"]');
    if (oneDayInput) oneDayInput.value = dateVal;
    const oneDayNoteEl = sectionEl.querySelector('[data-meeting-dates-edit] textarea[data-meeting-note-idx="0"]');
    if (oneDayNoteEl) oneDayNoteEl.value = String(firstMeeting?.note || '').trim();
    const form = sectionEl.closest('[data-drawer-form]');
    if (form && typeof form._refreshInitialValues === 'function') {
      form._refreshInitialValues();
    }
    sectionEl.removeAttribute('data-dates-loading');
    return;
  }

  const doneFromSchedule = countDoneMeetings(schedule);
  const doneFallback = numericOrNull(datesData?.meetings_done);
  const done = doneFromSchedule > 0 ? doneFromSchedule : (doneFallback ?? 0);
  const total = resolveActivitySessionTotal({
    ...datesData,
    sessions: sectionEl.dataset.sessionTotal || datesData?.sessions
  }, schedule);
  sectionEl.dataset.sessionTotal = String(total);
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const computedEnd = resolvedEndDate({ ...datesData, meeting_schedule: schedule });

  const progressMeta = sectionEl.querySelector('[data-dates-progress-meta]');
  if (progressMeta) {
    progressMeta.innerHTML = `<span>${done} מתוך ${total} מפגשים</span><span>${progressPct}%</span>`;
  }

  const progressFill = sectionEl.querySelector('.activity-drawer__progress-fill');
  if (progressFill) progressFill.style.width = `${progressPct}%`;

  const endDisplay = sectionEl.querySelector('[data-computed-end-display]');
  if (endDisplay) endDisplay.textContent = formatDateHe(computedEnd) || '';
  const startDisplay = sectionEl.querySelector('[data-computed-start-display]');
  if (startDisplay) startDisplay.textContent = formatDateHe(datesData?.start_date || schedule[0]?.date) || '';

  const chipsDiv = sectionEl.querySelector('[data-dates-view-chips]');
  if (chipsDiv) chipsDiv.innerHTML = buildDateChipsHtml(schedule, false);

  const datedCount = schedule.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '').trim())).length;
  const missingDates = Math.max(0, total - datedCount);
  const missingWarning = sectionEl.querySelector('[data-dates-missing-warning]');
  if (missingWarning) {
    missingWarning.textContent = missingDates ? `חסרים תאריכים ל־${missingDates} מפגשים` : '';
    missingWarning.hidden = missingDates === 0;
  }

  const editGrid = sectionEl.querySelector('[data-meeting-dates-edit]');
  if (editGrid) {
    while (editGrid.children.length < total) {
      const index = editGrid.children.length;
      const card = editGrid.ownerDocument.createElement('div');
      card.className = 'activity-drawer__date-card';
      card.dataset.meetingIndex = String(index);
      card.innerHTML = `<div class="activity-drawer__date-card-top"><span class="activity-drawer__meeting-index">מפגש ${index + 1}</span><span class="activity-drawer__date-card-top-aside"><button type="button" class="activity-drawer__date-remove" data-action="remove-meeting" aria-label="הסר מפגש">🗑</button><span class="activity-drawer__weekday"></span></span></div>${inputHtml({ name: `meeting_date_${index}`, value: '', type: 'date', attrs: `data-role="meeting-date" data-meeting-index="${index}" data-meeting-idx="${index}"` })}<input type="hidden" name="meeting_performed_${index}" value="no">`;
      editGrid.append(card);
    }
    schedule.forEach((item, index) => {
      const input = editGrid.querySelector(`input[data-meeting-idx="${index}"]`);
      if (input) input.value = String(item?.date || '').trim();
      const noteEl = editGrid.querySelector(`textarea[data-meeting-note-idx="${index}"]`);
      if (noteEl) noteEl.value = String(item?.note || '').trim();
    });
    const form = sectionEl.closest('[data-drawer-form]');
    if (form && typeof form._refreshInitialValues === 'function') {
      form._refreshInitialValues();
    }
  }

  sectionEl.removeAttribute('data-dates-loading');
}

function blockPrivateNote(row, { privateNote = null, showPrivateNote = false } = {}) {
  if (!showPrivateNote) return '';
  const privateValue = String(
    (privateNote !== null && privateNote !== undefined)
      ? privateNote
      : (row.operations_private_notes ?? row.private_note ?? '')
  ).trim();
  const hasNote = Boolean(privateValue);

  const viewPart = hasNote
    ? `<section class="activity-drawer__section activity-view-notes activity-view-notes--private" data-private-note-section>
        <span class="activity-view-notes__label">הערה תפעולית</span>
        <div class="activity-view-notes__text" data-mode="view">${escapeHtml(privateValue)}</div>
      </section>`
    : `<div data-private-note-section></div>`;

  const editPart = `<div class="activity-drawer__edit" data-mode="edit" hidden>
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">הערה תפעולית</div>
      ${textareaHtml({ name: 'operations_private_notes', value: privateValue, rows: 2, attrs: 'placeholder="הוספת הערה תפעולית"' })}
    </div>
  </div>`;

  return `${viewPart}${editPart}`;
}

function blockNotes(row, { hidden = false } = {}) {
  if (hidden) return '';
  const notesVal = String(row?.notes || '').trim();
  const hasNote = Boolean(notesVal);
  return `
    <section class="activity-drawer__section activity-view-notes${hasNote ? '' : ' activity-view-notes--empty'}" data-notes-section>
      ${hasNote ? `<span class="activity-view-notes__label">הערה</span>
      <div class="activity-view-notes__text" data-mode="view">${escapeHtml(notesVal)}</div>` : ''}
      <div class="activity-drawer__edit" data-mode="edit" hidden>
        <div class="activity-view-notes__label">הערה</div>
        ${textareaHtml({ name: 'notes', value: notesVal, rows: 2 })}
      </div>
    </section>
  `;
}

function jsonAttr(value) {
  try {
    return escapeHtml(JSON.stringify(value || {}));
  } catch {
    return '{}';
  }
}

function singleForm(row, { settings = {}, privateNote = null, canEdit = false, canDirectEdit = false, canRequestEdit = false, canDeleteActivity = false, canSchedule = false, showPrivateNote = false, idx = 0, datesLoading = false, instructorLimited = false } = {}) {
  const computedEnd = autoEndDate(row);
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const is2027 = normalizeActivitySeason(row.activity_season) === ACTIVITY_SEASON_SCHOOL_2027;
  const schedulingEligible = isActivitySchedulingEligible(row);
  const isOnce = ONCE_TYPES.includes(activityType);
  const isCourse = activityType === 'course';
  const isAfterSchool = activityType === 'after_school';
  const isWorkshop = activityType === 'workshop';
  const isEscapeRoom = activityType === 'escape_room';
  const isTour = activityType === 'tour';
  const showDates = isCourse || isAfterSchool || isWorkshop || isEscapeRoom || isTour;
  const hideFundingInView = isCourse || isAfterSchool || isTour;
  const editReqStatus = String(row.edit_request_status || '').trim();
  const editReqLabel =
    editReqStatus === 'pending' ? 'ממתין לאישור' :
      editReqStatus === 'approved' ? 'אושר' :
        editReqStatus === 'rejected' ? 'נדחה' :
          editReqStatus === 'conflict' ? 'בקונפליקט' : '';
  const editReqBadge = editReqLabel
    ? `<div class="ds-chip ds-chip--status ds-chip--warn" data-edit-request-status="${escapeHtml(editReqStatus)}">בקשת עריכה: ${escapeHtml(editReqLabel)}</div>`
    : '';
  return `
    <form class="activity-drawer__form" data-drawer-form data-editing="no"
      data-export-row="${jsonAttr(row)}"
      data-authority-records="${escapeHtml(encodeURIComponent(JSON.stringify(settings?.dropdown_options?.authority_records || [])))}"
      data-school-records="${escapeHtml(encodeURIComponent(JSON.stringify(settings?.dropdown_options?.school_records || [])))}"
      data-source-sheet="${escapeHtml(String(row.source_sheet || ''))}"
      data-row-id="${escapeHtml(String(row.RowID || row.row_id || row.source_row_id || ''))}"
      data-activity-season="${escapeHtml(String(row.activity_season || ''))}"
      data-activity-read-only="${isReadOnlyActivityRow(row) ? 'yes' : 'no'}"
      data-can-direct-edit="${canDirectEdit ? 'yes' : 'no'}"
      data-can-request-edit="${canRequestEdit ? 'yes' : 'no'}"
      data-original-status="${escapeHtml(String(row.status || ''))}"
      data-auto-end-date="${escapeHtml(computedEnd)}"
      data-is-once="${ONCE_TYPES.includes(activityType) ? 'yes' : 'no'}">
      ${editReqBadge}
      <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
      <input type="hidden" name="gefen_number" value="${escapeHtml(String(row.gefen_number || ''))}" data-gefen-number>
      <input type="hidden" name="_activity_idx" value="${idx}">
      ${isOnce
        ? blockViewOnce(row, { settings, hideFunding: hideFundingInView || instructorLimited })
        : blockViewCourse(row, { settings })}
      ${blockViewRecordDetails(row, { instructorLimited, showFunding: false, showParticipants: !isCourse })}
      ${isOnce && showDates
        ? `<div class="activity-drawer__once-dates-row" data-once-dates-row>${blockDates(row, { canEdit, canDirectEdit, datesLoading, is2027 })}</div>`
        : (showDates ? blockDates(row, { canEdit, canDirectEdit, datesLoading, is2027 }) : '')}
      ${is2027 ? `<div class="activity-drawer__actions-row" data-activity-actions data-view-only>
        <button type="button" class="ds-btn ds-btn--sm" data-coordination-approval>אישור תיאום</button>
      </div>` : ''}
      ${schedulingEligible ? `<div class="activity-scheduling-fields" data-mode="edit" hidden data-scheduling-fields>
        <div class="activity-scheduling-summary__fields"><label>מגדר<select class="ds-input" name="required_instructor_gender"><option value="any">ללא דרישה</option><option value="female"${(row.required_instructor_gender || 'any') === 'female' ? ' selected' : ''}>מדריכה</option><option value="male"${(row.required_instructor_gender || 'any') === 'male' ? ' selected' : ''}>מדריך</option></select></label><label>שפת הדרכה<select class="ds-input" name="instruction_language"><option value="he"${(row.instruction_language || 'he') === 'he' ? ' selected' : ''}>עברית</option><option value="ar"${row.instruction_language === 'ar' ? ' selected' : ''}>ערבית</option></select></label></div>
      </div>` : ''}
      ${blockNotes(row, { hidden: instructorLimited })}
      ${blockPrivateNote(row, { privateNote, showPrivateNote })}
      ${blockActivityDetails(row, { settings })}
      ${blockAssignment(row, { settings })}
      ${blockTeamTimes(row, { settings, schedulingManaged: is2027 })}
      ${instructorLimited ? '' : blockExtraEditInfo(row, { settings })}
      ${is2027 ? blockContact2027(row) : ''}
      ${blockEditActions({ canEdit, canDirectEdit, canDeleteActivity })}
      ${blockViewFooter({ canEdit, canDirectEdit })}
    </form>
  `;
}

export function activityRowDetailHtml(row, { privateNote = null, hideActivityNo = false, hideFunding = false, hideNotes = false } = {}) {
  return `
    <div>שם פעילות: ${escapeHtml(fallback(row.activity_name))}</div>
    <div>סוג פעילות: ${escapeHtml(activityTypeLabel(row.activity_type))}</div>
    <div>בית ספר: ${escapeHtml(fallback(row.school))}</div>
    <div>רשות: ${escapeHtml(fallback(row.authority))}</div>
    <div>שכבה: ${escapeHtml(fallback(row.grade))}</div>
    <div>קבוצה/כיתה: ${escapeHtml(fallback(row.class_group))}</div>
    <div>שעות: ${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time))}</div>
    ${hideFunding ? '' : `<div>מימון: ${escapeHtml(fallback(row.funding))}</div>`}
    <div>תאריכי מפגשים: ${escapeHtml(formatActivityDateColumnsHe(row))}</div>
    ${hideNotes ? '' : `<div>הערות: ${escapeHtml(fallback(row.notes))}</div>`}
    ${privateNote === null ? '' : `<div>הערה תפעולית: ${escapeHtml(fallback(privateNote))}</div>`}
  `;
}

export function activityWorkDrawerHtml(row, opts = {}) {
  const { mode = 'single', summaryDate = '', privateNote = null, settings = {}, datesLoading = false, exportAction = true, instructorLimited = false } = opts;
  /**
   * 2026 is read-only at the markup level: mutating controls are never rendered for
   * a historical activity, whatever the calling screen passes in.
   */
  const capabilitiesFor = (activityRow) => applyReadOnlyActivityCapabilities(
    {
      canEdit: opts.canEdit === true,
      canDirectEdit: opts.canDirectEdit === true,
      canRequestEdit: opts.canRequestEdit === true,
      canDeleteActivity: opts.canDeleteActivity === true,
      canSchedule: opts.canSchedule === true
    },
    { activity: activityRow }
  );
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const body = rows
      .map((item, idx) => `
        <div class="activity-drawer__summary-item">
          <div class="activity-drawer__summary-head">
            <span class="activity-drawer__summary-index">${idx + 1}</span>
            <div class="activity-drawer__summary-head-text">
              <strong>${escapeHtml(fallback(item.activity_name))}</strong>
              <span>${escapeHtml(`${activityTypeLabel(item.activity_type)} · ${fallback(item.school)}`)}</span>
            </div>
          </div>
          ${singleForm(item, {
            settings,
            privateNote,
            ...capabilitiesFor(item),
            showPrivateNote: privateNote !== null,
            idx,
            instructorLimited
          })}
        </div>
      `)
      .join('');
    return `
      ${headerHtml(rows, { mode: 'summary', summaryDate, exportAction })}
      <div class="activity-drawer__body">
        ${body || '<div class="activity-drawer__empty">אין נתונים</div>'}
      </div>
    `;
  }
  const one = row || {};
  return `
    ${headerHtml(one, { exportAction })}
    <div class="activity-drawer__body">
      ${singleForm(one, {
        settings,
        privateNote,
        ...capabilitiesFor(one),
        showPrivateNote: privateNote !== null,
        datesLoading,
        idx: 0,
        instructorLimited
      })}
    </div>
  `;
}
