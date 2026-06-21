import { escapeHtml } from './html.js';
import { formatDateHe, formatDateHeWithWeekday, formatTimeShort, formatTimeRangeShort, formatActivityDateColumnsHe } from './format-date.js';
import { activityManagerDisplayName, activityTypeDisplayLabel, activityTypeMatches, cleanActivityManagerName, getManagerUsers, getValidInstructorUsers, humanDisplayText, INVALID_ACTIVITY_INSTRUCTOR_STATUS, validateInstructorBinding, NO_ACTIVITY_MANAGER_LABEL, normalizeActivityTypeKey, normalizeOneDayActivityType, resolveActivityInstructorName, resolveGradeOptions } from './activity-options.js';
import { ACTIVITY_SEASON_OPTIONS, activitySeasonLabel, normalizeActivitySeason } from './summer-activity.js';

const ONCE_TYPES = ['workshop', 'tour', 'escape_room'];
const ACTIVITY_EDIT_TYPE_ORDER = ['workshop', 'escape_room', 'tour', 'after_school'];

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
      const label = humanDisplayText(o.label || o.activity_name || o.value);
      if (!label) return;
      out.push({
        label,
        activity_no: String(o.activity_no || '').trim(),
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
    ? (normalizeActivityTypeKey(value) || String(value || '').trim())
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
  const all = unique.includes(safeValue) || !safeValue ? unique : [safeValue, ...unique];
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
    'program_names', 'workshop_names', 'tour_names', 'escape_room_names'
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

function buildActivityNameOpts(options, safeValue, activityType) {
  const normalizedType = normalizeActivityTypeKey(activityType);
  if (!normalizedType) return '<option value="">בחרו קודם סוג פעילות</option>';
  const sourceOptions = Array.isArray(options) ? options : [];
  let filtered = sourceOptions.filter((o) => activityTypeMatches(o?.parent_value || o?.activity_type, normalizedType));
  const hasTagged = sourceOptions.some((o) => String(o?.parent_value || o?.activity_type || '').trim());
  if (!filtered.length && !hasTagged) filtered = sourceOptions;
  const all = filtered.slice();
  return [`<option value="">—</option>`]
    .concat(
      all.map((o) => {
        const label = String(o?.label || '').trim();
        const selected = label === safeValue ? ' selected' : '';
        const actNo = String(o?.activity_no || '').trim();
        const actType = String(o?.parent_value || o?.activity_type || activityType || '').trim();
        return `<option value="${escapeHtml(label)}" data-activity-no="${escapeHtml(actNo)}" data-activity-type="${escapeHtml(actType)}"${selected}>${escapeHtml(label)}</option>`;
      })
    )
    .join('');
}

function activityNameSelectHtml(name, value, options, activityType) {
  const safeValue = String(value || '').trim();
  const normalizedType = normalizeActivityTypeKey(activityType);
  const allJson = escapeHtml(encodeURIComponent(JSON.stringify(Array.isArray(options) ? options : [])));
  const opts = buildActivityNameOpts(options, safeValue, normalizedType);
  const disabled = normalizedType ? '' : ' disabled';
  return `<select class="ds-input" name="${escapeHtml(name)}" data-role="activity-name-select" data-all-activity-names="${allJson}"${disabled}>${opts}</select>`;
}

function autoEndDate(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) return '';
  return String(schedule[schedule.length - 1]?.date || '').trim();
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
  return `
    <div class="activity-drawer__header activity-drawer__header--sticky">
      <div class="activity-drawer__header-top">
        <div class="activity-drawer__heading">
          <h2 class="activity-drawer__title">${escapeHtml(fallback(row?.activity_name))}</h2>
          <div class="activity-drawer__meta activity-drawer__meta--compact">
            <span>${escapeHtml(activityTypeLabel(row?.activity_type))}</span>
            <span class="activity-drawer__meta-sep" aria-hidden="true">·</span>
            <span class="activity-drawer__status">${escapeHtml(statusText(row?.status))}</span>
            <span class="activity-drawer__meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(fallback(row?.school))}</span>
            <span class="activity-drawer__meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(fallback(row?.authority))}</span>
          </div>
        </div>
        ${headerActionsHtml(exportAction)}
      </div>
    </div>
  `;
}

function blockActivityDetails(row, { settings = {} } = {}) {
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const allActivityNames = resolveActivityNameOptions(settings, '');
  if (!allActivityNames.length) {
    // eslint-disable-next-line no-console
    console.warn('[activity-edit] activity name options missing from client settings');
  }
  const isOneDay = Boolean(normalizeOneDayActivityType(activityType));
  const statusOptions = ['פתוח', 'סגור'];
  const normalizedStatus = normStatus(row.status) === 'closed' ? 'סגור' : 'פתוח';

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
          activityNameSelectHtml('activity_name', row.activity_name, allActivityNames, activityType),
          'activity-drawer__field--full'
        )}
        ${fieldEditOnly(
          'סטטוס',
          selectHtml({ name: 'status', value: normalizedStatus, options: statusOptions, placeholder: 'פתוח' })
        )}
        ${fieldEditOnly(
          'עונת פעילות',
          activitySeasonSelectHtml(settings, row.activity_season)
        )}
      </div>
    </section>
  `;
}

function blockAssignment(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const schools = mergeListStrings(options, ['school', 'schools']);
  const authorities = mergeListStrings(options, ['authority', 'authorities']);
  const grades = resolveGradeOptions(settings);

  return `
    <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden>
      <h3 class="activity-drawer__section-title">שיוך ומיקום</h3>
      <div class="activity-drawer__details-edit-grid">
        ${fieldEditOnly(
          'רשות',
          authorities.length
            ? selectHtml({ name: 'authority', value: row.authority, options: authorities })
            : inputHtml({ name: 'authority', value: row.authority })
        )}
        ${fieldEditOnly(
          'בית ספר',
          schools.length
            ? selectHtml({ name: 'school', value: row.school, options: schools })
            : inputHtml({ name: 'school', value: row.school })
        )}
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

function blockTeamTimes(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = getManagerUsers(settings || {});
  const rosterUsers = getValidInstructorUsers(settings || {});
  const instructorLookup = buildInstructorLookup(settings);
  const contactsUsers = getValidInstructorUsers(settings || {});
  const instructor1Display = resolveActivityInstructorName(row) || resolveInstructorDisplayName(row.instructor_name, row.emp_id, instructorLookup);
  const instructor2Display = resolveActivityInstructorName(row, { secondary: true }) || resolveInstructorDisplayName(row.instructor_name_2, row.emp_id_2, instructorLookup);
  const instructor1EmpId = String(row.emp_id || '').trim();
  const instructor2EmpId = String(row.emp_id_2 || '').trim();
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const twoInstructors = activityType === 'workshop' || activityType === 'escape_room';
  const instructorBindingWarning = [
    validateInstructorBinding({ empId: instructor1EmpId, instructorName: instructor1Display }, rosterUsers),
    validateInstructorBinding({ empId: instructor2EmpId, instructorName: instructor2Display }, rosterUsers)
  ].some((result) => !result.valid)
    ? '<p class="ds-error-text">בפעילות זו קיים שיוך למדריך שאינו קיים בטבלת המדריכים. יש לבחור מדריך מחדש.</p>'
    : '';
  const instructorEditHtml = twoInstructors
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
            ${inputHtml({ name: 'start_time', value: formatTimeShort(row.start_time), type: 'time' })}
            ${inputHtml({ name: 'end_time', value: formatTimeShort(row.end_time), type: 'time' })}
          </div>`,
          'activity-drawer__field--hours'
        )}
      </div>
    </section>
  `;
}

function blockExtraEditInfo(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const fundings = mergeListStrings(options, ['funding', 'fundings']);

  return `
    <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden>
      <h3 class="activity-drawer__section-title">מידע משלים</h3>
      <div class="activity-drawer__details-edit-grid">
        ${fieldEditOnly(
          'מימון',
          fundings.length
            ? selectHtml({ name: 'funding', value: row.funding, options: fundings })
            : inputHtml({ name: 'funding', value: row.funding })
        )}
        ${fieldEditOnly('מחיר', inputHtml({ name: 'price', value: row.price }))}
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
  const twoInstructors = activityType === 'workshop' || activityType === 'escape_room';
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
    const key = date || '__empty__';
    if (!acc.has(key)) {
      acc.set(key, { item, count: 0, doneCount: 0 });
    }
    const entry = acc.get(key);
    entry.count += 1;
    const performed = String(item?.performed || '').toLowerCase() === 'yes';
    const autoDoneByDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < todayStr();
    if (performed || autoDoneByDate) entry.doneCount += 1;
    return acc;
  }, new Map());

  return Array.from(grouped.values())
    .map(({ item, count, doneCount }) => {
      const isDone = doneCount > 0;
      const countLabel = count > 1 ? ` · ${count} מפגשים` : '';
      return `
        <div class="activity-drawer__date-chip ${isDone ? 'is-done' : ''}" data-date-card>
          <span>${escapeHtml(`${formatDateHeWithWeekday(item?.date || '')}${countLabel}`)}</span>
        </div>
      `;
    })
    .join('') || '<div class="activity-drawer__date-chip">—</div>';
}

function buildOneDayViewHtml(schedule, row, datesLoading) {
  if (datesLoading) {
    return `<div class="activity-drawer__oneday-info" data-mode="view" data-dates-view-chips>
      <div class="activity-drawer__date-chip ds-muted" aria-busy="true">טוען...</div>
    </div>`;
  }
  const firstMeeting = schedule[0] || {};
  const dateVal = String(firstMeeting?.date || '').trim();
  const dateDisplay = dateVal ? formatDateHe(dateVal) : '—';
  const weekdayDisplay = dateVal ? fmtWeekdayShort(dateVal) : '—';
  const timeRange = (String(row.start_time || '').trim() && String(row.end_time || '').trim())
    ? formatTimeRangeShort(row.start_time, row.end_time)
    : '—';
  return `<div class="activity-drawer__oneday-info" data-mode="view" data-dates-view-chips>
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">תאריך הפעילות</div>
      <div class="activity-drawer__value" data-oneday-date-display>${escapeHtml(dateDisplay)}</div>
    </div>
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">יום בשבוע</div>
      <div class="activity-drawer__value" data-oneday-weekday-display>${escapeHtml(weekdayDisplay)}</div>
    </div>
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">שעות הפעילות</div>
      <div class="activity-drawer__value">${escapeHtml(timeRange)}</div>
    </div>
  </div>`;
}

function blockDates(row, { canEdit = false, canDirectEdit = false, datesLoading = false } = {}) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const isOnce = ONCE_TYPES.includes(activityType);
  const isCourse = activityType === 'course';
  const isAfterSchool = activityType === 'after_school';
  if (!isOnce && !isCourse && !isAfterSchool) return '';
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
      </div>
    `;
    return `
      <section class="activity-drawer__section" data-dates-section${loadingAttr}>
        <div class="activity-drawer__section-head">
          <h3 class="activity-drawer__section-title">תאריך ושעות פעילות</h3>
          ${canEdit ? `<button type="button" class="activity-drawer__action activity-drawer__action--subtle" data-action="start-edit" data-mode="view">${canDirectEdit ? 'עריכה' : 'בקשת שינוי'}</button>` : ''}
        </div>
        ${buildOneDayViewHtml(schedule, row, datesLoading)}
        <div class="activity-drawer__dates activity-drawer__dates--edit" data-mode="edit" data-meeting-dates-edit hidden>
          ${oneDayEditCard}
        </div>
      </section>
    `;
  }

  const computedEnd = autoEndDate(row);
  const doneFromSchedule = countDoneMeetings(schedule);
  const doneFallback = numericOrNull(row?.meetings_done);
  const done = doneFromSchedule > 0 ? doneFromSchedule : (doneFallback ?? 0);
  const total = numericOrNull(row?.meetings_total) ?? schedule.length ?? 0;
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
      </div>
    `)
    .join('');

  const progressHtml = datesLoading
    ? `<div class="activity-drawer__progress-row" data-mode="view"><div class="activity-drawer__progress" data-dates-progress>
        <div class="activity-drawer__progress-meta" data-dates-progress-meta>
          <span class="ds-muted">טוען תאריכי מפגשים...</span>
        </div>
        <div class="activity-drawer__progress-track">
          <div class="activity-drawer__progress-fill" style="width:0%"></div>
        </div>
      </div>
      <div class="activity-drawer__end-date">
        <span>🏁 תאריך סיום</span>
        <strong data-computed-end-display>—</strong>
      </div>
      </div>
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view" data-dates-view-chips>
        <div class="activity-drawer__date-chip ds-muted" aria-busy="true">טוען...</div>
      </div>`
    : `<div class="activity-drawer__progress-row" data-mode="view"><div class="activity-drawer__progress" data-dates-progress>
        <div class="activity-drawer__progress-meta" data-dates-progress-meta>
          <span>${done} מתוך ${total} מפגשים</span>
          <span>${progressPct}%</span>
        </div>
        <div class="activity-drawer__progress-track">
          <div class="activity-drawer__progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
      <div class="activity-drawer__end-date">
        <span>🏁 תאריך סיום</span>
        <strong data-computed-end-display>${escapeHtml(formatDateHeWithWeekday(computedEnd) || '—')}</strong>
      </div>
      </div>
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view" data-dates-view-chips>
        ${viewChips}
      </div>`;

  const progressTitle = isCourse ? 'התקדמות הקורס' : 'מפגשים ותאריכים';
  return `
    <section class="activity-drawer__section" data-dates-section${loadingAttr}>
      <div class="activity-drawer__section-head">
        <h3 class="activity-drawer__section-title">${escapeHtml(progressTitle)}</h3>
        ${canEdit ? `<button type="button" class="activity-drawer__action activity-drawer__action--subtle" data-action="start-edit" data-mode="view">${canDirectEdit ? 'עריכה' : 'בקשת שינוי'}</button>` : ''}
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
  const activityType = String(datesData?.activity_type || '').trim();
  const isOnce = ONCE_TYPES.includes(activityType);

  if (isOnce) {
    const firstMeeting = schedule[0] || {};
    const dateVal = String(firstMeeting?.date || '').trim();
    const dateEl = sectionEl.querySelector('[data-oneday-date-display]');
    if (dateEl) dateEl.textContent = dateVal ? formatDateHe(dateVal) : '—';
    const weekdayEl = sectionEl.querySelector('[data-oneday-weekday-display]');
    if (weekdayEl) weekdayEl.textContent = dateVal ? fmtWeekdayShort(dateVal) : '—';
    sectionEl.removeAttribute('data-dates-loading');
    return;
  }

  const doneFromSchedule = countDoneMeetings(schedule);
  const doneFallback = numericOrNull(datesData?.meetings_done);
  const done = doneFromSchedule > 0 ? doneFromSchedule : (doneFallback ?? 0);
  const total = numericOrNull(datesData?.meetings_total) ?? schedule.length ?? 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const computedEnd = autoEndDate({ meeting_schedule: schedule }) || String(datesData?.end_date || '');

  const progressMeta = sectionEl.querySelector('[data-dates-progress-meta]');
  if (progressMeta) {
    progressMeta.innerHTML = `<span>${done} מתוך ${total} מפגשים</span><span>${progressPct}%</span>`;
  }

  const progressFill = sectionEl.querySelector('.activity-drawer__progress-fill');
  if (progressFill) progressFill.style.width = `${progressPct}%`;

  const endDisplay = sectionEl.querySelector('[data-computed-end-display]');
  if (endDisplay) endDisplay.textContent = formatDateHeWithWeekday(computedEnd) || '—';

  const chipsDiv = sectionEl.querySelector('[data-dates-view-chips]');
  if (chipsDiv) chipsDiv.innerHTML = buildDateChipsHtml(schedule, false);

  sectionEl.removeAttribute('data-dates-loading');
}

function blockPrivateNote(row, { privateNote = null, showPrivateNote = false } = {}) {
  if (!showPrivateNote) return '';
  const privateValue = String(
    (privateNote !== null && privateNote !== undefined)
      ? privateNote
      : (row.operations_private_notes ?? row.private_note ?? '')
  ).trim();

  const viewPart = privateValue
    ? `<section class="activity-drawer__section activity-drawer__section--private-note" data-private-note-section>
        <h3 class="activity-drawer__section-title">הערה תפעולית</h3>
        <div class="activity-drawer__value activity-drawer__value--note" data-mode="view">${escapeHtml(privateValue)}</div>
      </section>`
    : `<div class="activity-drawer__compact-line" data-private-note-section data-mode="view">
        <span class="activity-drawer__compact-label">הערה תפעולית:</span>
        <span class="activity-drawer__compact-value">—</span>
      </div>`;

  const editPart = `<div class="activity-drawer__edit" data-mode="edit" hidden>
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">הערה תפעולית</div>
      ${textareaHtml({ name: 'operations_private_notes', value: privateValue, rows: 2, attrs: 'placeholder="הוספת הערה תפעולית"' })}
    </div>
  </div>`;

  return `${viewPart}${editPart}`;
}

function blockNotes(row, { hidden = false } = {}) {
  if (hidden || !String(row?.notes || '').trim()) return '';
  return `
    <section class="activity-drawer__section activity-drawer__section--notes" data-notes-section>
      <h3 class="activity-drawer__section-title">הערות</h3>
      <div class="activity-drawer__value activity-drawer__value--note" data-mode="view">${escapeHtml(fallback(row.notes))}</div>
      <div class="activity-drawer__edit" data-mode="edit" hidden>
        ${textareaHtml({ name: 'notes', value: String(row.notes || ''), rows: 2 })}
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

function singleForm(row, { settings = {}, privateNote = null, canEdit = false, canDirectEdit = false, canRequestEdit = false, canDeleteActivity = false, showPrivateNote = false, idx = 0, datesLoading = false, instructorLimited = false } = {}) {
  const computedEnd = autoEndDate(row);
  const activityType = normalizeActivityTypeKey(row.activity_type || row.item_type);
  const isCourse = activityType === 'course';
  const isAfterSchool = activityType === 'after_school';
  const isWorkshop = activityType === 'workshop';
  const isEscapeRoom = activityType === 'escape_room';
  const isTour = activityType === 'tour';
  const showDates = isCourse || isAfterSchool || isWorkshop || isEscapeRoom || isTour;
  const hideFundingInView = isCourse || isAfterSchool || isTour;
  const hideSeasonInView = isWorkshop || isEscapeRoom || isTour;
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
      data-source-sheet="${escapeHtml(String(row.source_sheet || ''))}"
      data-row-id="${escapeHtml(String(row.RowID || row.row_id || row.source_row_id || ''))}"
      data-can-direct-edit="${canDirectEdit ? 'yes' : 'no'}"
      data-can-request-edit="${canRequestEdit ? 'yes' : 'no'}"
      data-original-status="${escapeHtml(String(row.status || ''))}"
      data-auto-end-date="${escapeHtml(computedEnd)}"
      data-is-once="${ONCE_TYPES.includes(activityType) ? 'yes' : 'no'}">
      ${editReqBadge}
      <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
      <input type="hidden" name="_activity_idx" value="${idx}">
      ${blockCentralInfo(row, { settings, hideFunding: hideFundingInView || instructorLimited })}
      ${showDates ? blockDates(row, { canEdit, canDirectEdit, datesLoading }) : ''}
      ${blockNotes(row, { hidden: instructorLimited })}
      ${blockPrivateNote(row, { privateNote, showPrivateNote })}
      ${blockAdditionalSupplemental(row, { hideSeason: hideSeasonInView })}
      ${blockActivityDetails(row, { settings })}
      ${blockAssignment(row, { settings })}
      ${blockTeamTimes(row, { settings })}
      ${instructorLimited ? '' : blockExtraEditInfo(row, { settings })}
      ${blockEditActions({ canEdit, canDirectEdit, canDeleteActivity })}
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
  const { mode = 'single', summaryDate = '', privateNote = null, canEdit = false, canDirectEdit = false, canRequestEdit = false, canDeleteActivity = false, settings = {}, datesLoading = false, exportAction = true, instructorLimited = false } = opts;
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
            canEdit,
            canDirectEdit,
            canRequestEdit,
            canDeleteActivity,
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
        canEdit,
        canDirectEdit,
        canRequestEdit,
        canDeleteActivity,
        showPrivateNote: privateNote !== null,
        datesLoading,
        idx: 0,
        instructorLimited
      })}
    </div>
  `;
}
