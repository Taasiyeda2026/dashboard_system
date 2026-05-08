import { escapeHtml } from './html.js';
import { formatDateHe, formatTimeShort, formatTimeRangeShort, formatActivityDateColumnsHe } from './format-date.js';

const ONCE_TYPES = ['workshop', 'tour', 'escape_room'];

const ACTIVITY_TYPE_PILL_LABEL = {
  course: 'קורס',
  after_school: 'חוג אפטרסקול',
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
  return ACTIVITY_TYPE_PILL_LABEL[String(type || '').trim()] || 'פעילות';
}

function activityNameLabel(type) {
  return ACTIVITY_NAME_LABEL[String(type || '').trim()] || 'שם פעילות';
}

function fallback(v) {
  return String(v || '').trim() || '—';
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
    ? schedule.filter((m) => m?.date && m.date <= today).length
    : 0;
}

function normStatus(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (raw === 'closed' || raw === 'סגור') return 'closed';
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
  const direct = String(name || '').trim();
  if (direct) return direct;
  const emp = String(empId || '').trim();
  if (emp && lookup?.[emp]) return lookup[emp];
  return '';
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
      const label = String(o.label || o.activity_name || o.value || '').trim();
      if (!label) return;
      out.push({
        label,
        activity_no: String(o.activity_no || '').trim(),
        parent_value: String(o.parent_value || o.activity_type || '').trim(),
        activity_type: String(o.activity_type || o.parent_value || '').trim()
      });
    }
  });
  return out;
}

function selectHtml({ name, value, options, klass = 'ds-input', placeholder = '—', attrs = '' }) {
  const safeValue = String(value || '').trim();
  const normalized = toOptions(options);
  const all = normalized.includes(safeValue) || !safeValue ? normalized : [safeValue, ...normalized];
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(
      all.map((o) => {
        const selected = o === safeValue ? ' selected' : '';
        return `<option value="${escapeHtml(o)}"${selected}>${escapeHtml(o)}</option>`;
      })
    )
    .join('');
  return `<select class="${escapeHtml(klass)}" name="${escapeHtml(name)}" ${attrs}>${opts}</select>`;
}

function inputHtml({ name, value, type = 'text', klass = 'ds-input', attrs = '' }) {
  return `<input class="${escapeHtml(klass)}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(String(value || ''))}" ${attrs}>`;
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
  for (let i = 0; i < keys.length; i++) {
    const arr = opts[keys[i]];
    if (Array.isArray(arr) && arr.length > 0) return normalizeActivityNameOptions(arr);
  }
  return [];
}

function buildActivityNameOpts(options, safeValue, activityType) {
  const normalizedType = String(activityType || '').trim().toLowerCase();
  let filtered = (Array.isArray(options) ? options : []).filter((o) => {
    const parent = String(o?.parent_value || o?.activity_type || '').trim();
    if (!parent) return true;
    return parent.toLowerCase() === normalizedType;
  });
  if (!filtered.length) filtered = Array.isArray(options) ? options : [];
  const all = filtered.slice();
  if (safeValue && !all.some((o) => String(o?.label || '').trim() === safeValue)) {
    all.unshift({ label: safeValue, activity_no: '', parent_value: activityType });
  }
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
  const allJson = escapeHtml(encodeURIComponent(JSON.stringify(Array.isArray(options) ? options : [])));
  const opts = buildActivityNameOpts(options, safeValue, activityType);
  return `<select class="ds-input" name="${escapeHtml(name)}" data-role="activity-name-select" data-all-activity-names="${allJson}">${opts}</select>`;
}

function autoEndDate(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) return '';
  return String(schedule[schedule.length - 1]?.date || '').trim();
}

function fmtWeekdayShort(iso) {
  if (!iso) return '—';
  const date = new Date(`${iso}T12:00:00`);
  const map = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  if (Number.isNaN(date.getTime())) return '—';
  return map[date.getDay()] || '—';
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

function resolveAllActivityTypes(settings) {
  const seen = new Set();
  const out = [];
  [...(settings?.one_day_activity_types || []), ...(settings?.program_activity_types || [])].forEach((v) => {
    const s = String(v || '').trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  });
  return out;
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
    <div class="activity-drawer__header">
      <div class="activity-drawer__header-top">
        <div class="activity-drawer__heading">
          <span class="activity-drawer__pill">${escapeHtml(activityTypeLabel(row?.activity_type))}</span>
          <h2 class="activity-drawer__title">${escapeHtml(fallback(row?.activity_name))}</h2>
          <div class="activity-drawer__meta">
            <span class="activity-drawer__status">${escapeHtml(statusText(row?.status))}</span>
            <span>${escapeHtml(fallback(row?.school))} · ${escapeHtml(fallback(row?.authority))}</span>
          </div>
        </div>
        ${headerActionsHtml(exportAction)}
      </div>
    </div>
  `;
}

function blockPeople(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = mergeListStrings(options, ['activity_manager', 'activity_managers']);
  const instructors = mergeListStrings(options, ['instructor_name', 'instructor_names']);
  const authorities = mergeListStrings(options, ['authority', 'authorities']);
  const grades = mergeListStrings(options, ['grade', 'grades']);
  const instructorLookup = buildInstructorLookup(settings);
  const instructor1Display = resolveInstructorDisplayName(row.instructor_name, row.emp_id, instructorLookup);
  const instructor2Display = resolveInstructorDisplayName(row.instructor_name_2, row.emp_id_2, instructorLookup);
  const activityType = String(row.activity_type || '').trim();
  const twoInstructors = activityType === 'workshop';
  const instructorLabel = twoInstructors ? 'מדריך/ה 1' : 'מדריך/ה';
  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ') || '—';
  const hoursLabel =
    String(row.start_time || '').trim() && String(row.end_time || '').trim()
      ? formatTimeRangeShort(row.start_time, row.end_time)
      : '—';
  const statusOptions = ['פעיל', 'סגור'];
  const normalizedStatus = normStatus(row.status) === 'closed' ? 'סגור' : 'פעיל';
  const instructorEditHtml = twoInstructors
    ? `<div class="activity-drawer__field-controls activity-drawer__field-controls--stacked">
        ${selectHtml({ name: 'instructor_name', value: instructor1Display, options: instructors })}
        ${selectHtml({ name: 'instructor_name_2', value: instructor2Display, options: instructors })}
      </div>`
    : selectHtml({ name: 'instructor_name', value: instructor1Display, options: instructors });

  return `
    <section class="activity-drawer__section">
      <div class="activity-drawer__grid activity-drawer__grid--three" data-mode="view">
        ${fieldViewOnly('מנהל פעילות', escapeHtml(fallback(row.activity_manager)))}
        ${fieldViewOnly(instructorLabel, escapeHtml(fallback(instructor1Display)))}
        ${fieldViewOnly('סוג פעילות', escapeHtml(activityTypeLabel(activityType)))}
        ${fieldViewOnly('סטטוס', escapeHtml(statusText(row.status)))}
        ${fieldViewOnly('רשות', escapeHtml(fallback(row.authority)))}
        ${fieldViewOnly('כיתה', escapeHtml(classLabel))}
        ${fieldViewOnly('שעות', escapeHtml(hoursLabel))}
      </div>
      <div class="activity-drawer__details-edit-grid" data-mode="edit" hidden>
        ${fieldEditOnly(
          'מנהל פעילות',
          selectHtml({ name: 'activity_manager', value: row.activity_manager, options: managers })
        )}
        ${fieldEditOnly('מדריך/ה', instructorEditHtml)}
        ${fieldEditOnly(
          'סוג פעילות',
          selectHtml({ name: 'activity_type', value: activityType, options: resolveAllActivityTypes(settings), placeholder: 'בחרו סוג פעילות' })
        )}
        ${fieldEditOnly(
          'סטטוס',
          selectHtml({ name: 'status', value: normalizedStatus, options: statusOptions, placeholder: 'פעיל' })
        )}
        ${fieldEditOnly(
          'רשות',
          authorities.length
            ? selectHtml({ name: 'authority', value: row.authority, options: authorities })
            : inputHtml({ name: 'authority', value: row.authority })
        )}
        ${fieldEditOnly(
          'כיתה',
          `<div class="activity-drawer__field-controls activity-drawer__field-controls--inline">
            ${selectHtml({ name: 'grade', value: row.grade, options: grades })}
            ${inputHtml({ name: 'class_group', value: row.class_group, attrs: 'placeholder="כיתה"' })}
          </div>`
        )}
        ${fieldEditOnly(
          'שעות',
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

function blockContent(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const fundings = mergeListStrings(options, ['funding', 'fundings']);
  const schools = mergeListStrings(options, ['school', 'schools']);
  const activityType = String(row.activity_type || '').trim();
  const allActivityNames = resolveActivityNameOptions(settings, activityType);
  if (!allActivityNames.length) {
    // eslint-disable-next-line no-console
    console.warn('[activity-edit] activity name options missing from client settings');
  }
  const nameLabel = activityNameLabel(activityType);
  return `
    <section class="activity-drawer__section">
      <div class="activity-drawer__edit-grid activity-drawer__grid activity-drawer__grid--two" data-mode="edit" hidden>
        <div class="activity-drawer__field activity-drawer__field--full">
          <div class="activity-drawer__label">${escapeHtml(nameLabel)}</div>
          ${activityNameSelectHtml('activity_name', row.activity_name, allActivityNames, activityType)}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">מימון</div>
          ${
            fundings.length
              ? selectHtml({ name: 'funding', value: row.funding, options: fundings })
              : inputHtml({ name: 'funding', value: row.funding })
          }
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">מחיר</div>
          ${inputHtml({ name: 'price', value: row.price })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">בית ספר</div>
          ${
            schools.length
              ? selectHtml({ name: 'school', value: row.school, options: schools })
              : inputHtml({ name: 'school', value: row.school })
          }
        </div>
      </div>
    </section>
  `;
}

function buildDateChipsHtml(schedule, isOnce) {
  return (isOnce ? schedule.slice(0, 1) : schedule)
    .map((item) => {
      const isDone = String(item?.performed || '').toLowerCase() === 'yes';
      return `
        <div class="activity-drawer__date-chip ${isDone ? 'is-done' : ''}" data-date-card>
          <span>${escapeHtml(formatDateHe(item?.date || ''))}</span>
          <span class="activity-drawer__weekday">${escapeHtml(fmtWeekdayShort(item?.date || ''))}</span>
        </div>
      `;
    })
    .join('') || '<div class="activity-drawer__date-chip">—</div>';
}

function blockDates(row, { canEdit = false, canDirectEdit = false, datesLoading = false } = {}) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const activityType = String(row.activity_type || '').trim();
  const isOnce = ONCE_TYPES.includes(activityType);
  const computedEnd = autoEndDate(row);
  const done = countDoneMeetings(schedule) || Number(row?.meetings_done || 0);
  const total = Number(row?.meetings_total || schedule.length || 0);
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const viewChips = buildDateChipsHtml(schedule, isOnce);
  const editDates = isOnce ? schedule.slice(0, 1) : schedule;
  const removeMeetingBtn = isOnce
    ? ''
    : `<button type="button" class="activity-drawer__date-remove" data-action="remove-meeting" aria-label="הסר מפגש">🗑</button>`;
  const datePickers = editDates
    .map((item, i) => `
      <div class="activity-drawer__date-card" data-meeting-index="${i}">
        <div class="activity-drawer__date-card-top">
          <span class="activity-drawer__meeting-index">מפגש ${i + 1}</span>
          <span class="activity-drawer__date-card-top-aside">
            ${removeMeetingBtn}
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
  const chainToggle = isOnce
    ? ''
    : `
      <div class="activity-drawer__date-mode" data-mode="edit" data-chain-toggle hidden>
        <button type="button" class="activity-drawer__toggle" data-date-mode="single">בודד</button>
        <button type="button" class="activity-drawer__toggle is-active" data-date-mode="chain">שרשרת</button>
      </div>
    `;
  const addMeetingBtn = isOnce
    ? ''
    : `<button type="button" class="activity-drawer__action activity-drawer__action--ghost" data-action="add-meeting" data-mode="edit" hidden>➕ הוסף מפגש</button>`;

  const loadingAttr = datesLoading ? ' data-dates-loading="true"' : '';
  const progressHtml = datesLoading
    ? `<div class="activity-drawer__progress" data-mode="view" data-dates-progress>
        <div class="activity-drawer__progress-meta" data-dates-progress-meta>
          <span class="ds-muted">טוען תאריכי מפגשים...</span>
        </div>
        <div class="activity-drawer__progress-track">
          <div class="activity-drawer__progress-fill" style="width:0%"></div>
        </div>
      </div>
      <div class="activity-drawer__end-date" data-mode="view">
        <span>🏁 תאריך סיום</span>
        <strong data-computed-end-display>—</strong>
      </div>
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view" data-dates-view-chips>
        <div class="activity-drawer__date-chip ds-muted" aria-busy="true">טוען...</div>
      </div>`
    : `<div class="activity-drawer__progress" data-mode="view" data-dates-progress>
        <div class="activity-drawer__progress-meta" data-dates-progress-meta>
          <span>${done} מתוך ${total} מפגשים</span>
          <span>${progressPct}%</span>
        </div>
        <div class="activity-drawer__progress-track">
          <div class="activity-drawer__progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
      <div class="activity-drawer__end-date" data-mode="view">
        <span>🏁 תאריך סיום</span>
        <strong data-computed-end-display>${escapeHtml(formatDateHe(computedEnd) || '—')}</strong>
      </div>
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view" data-dates-view-chips>
        ${viewChips}
      </div>`;

  return `
    <section class="activity-drawer__section" data-dates-section${loadingAttr}>
      <div class="activity-drawer__section-head">
        <h3 class="activity-drawer__section-title">📅</h3>
        ${canEdit ? '<button type="button" class="activity-drawer__action" data-action="start-edit" data-mode="view">✏️ עריכה</button>' : ''}
      </div>
      ${progressHtml}
      <div class="activity-drawer__dates activity-drawer__dates--edit" data-mode="edit" data-meeting-dates-edit hidden>
        ${datePickers}
      </div>
      ${chainToggle}
      ${addMeetingBtn}
      <div class="activity-drawer__edit-actions" data-mode="edit" hidden>
        <button type="button" class="activity-drawer__action activity-drawer__action--primary" data-action="save-edit">שמור</button>
        <button type="button" class="activity-drawer__action" data-action="cancel-edit">ביטול</button>
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
  const done = countDoneMeetings(schedule) || Number(datesData?.meetings_done || 0);
  const total = Number(datesData?.meetings_total || schedule.length || 0);
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const computedEnd = autoEndDate({ meeting_schedule: schedule }) || String(datesData?.end_date || '');

  const progressMeta = sectionEl.querySelector('[data-dates-progress-meta]');
  if (progressMeta) {
    progressMeta.innerHTML = `<span>${done} מתוך ${total} מפגשים</span><span>${progressPct}%</span>`;
  }

  const progressFill = sectionEl.querySelector('.activity-drawer__progress-fill');
  if (progressFill) progressFill.style.width = `${progressPct}%`;

  const endDisplay = sectionEl.querySelector('[data-computed-end-display]');
  if (endDisplay) endDisplay.textContent = formatDateHe(computedEnd) || '—';

  const chipsDiv = sectionEl.querySelector('[data-dates-view-chips]');
  if (chipsDiv) chipsDiv.innerHTML = buildDateChipsHtml(schedule, isOnce);

  sectionEl.removeAttribute('data-dates-loading');
}

function blockPrivateNote(row, { privateNote = null, showPrivateNote = false } = {}) {
  if (!showPrivateNote) return '';
  const privateValue =
    privateNote !== null && privateNote !== undefined
      ? privateNote
      : row.operations_private_notes;
  return `
    <section class="activity-drawer__section activity-drawer__section--private">
      <div class="activity-drawer__private">
        <div class="activity-drawer__private-badge">🔒</div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">הערה תפעולית</div>
          ${textareaHtml({ name: 'operations_private_notes', value: String(privateValue || ''), rows: 2, attrs: 'data-always-editable' })}
        </div>
      </div>
    </section>
  `;
}

function blockNotes(row) {
  return `
    <section class="activity-drawer__section">
      <h3 class="activity-drawer__section-title">📝</h3>
      ${fieldViewEdit(
        'הערות',
        `${escapeHtml(fallback(row.notes))}`,
        textareaHtml({ name: 'notes', value: String(row.notes || ''), rows: 2 })
      )}
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

function singleForm(row, { settings = {}, privateNote = null, canEdit = false, canDirectEdit = false, showPrivateNote = false, idx = 0, datesLoading = false } = {}) {
  const computedEnd = autoEndDate(row);
  const activityType = String(row.activity_type || '').trim();
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
      data-row-id="${escapeHtml(String(row.RowID || ''))}"
      data-can-direct-edit="${canDirectEdit ? 'yes' : 'no'}"
      data-auto-end-date="${escapeHtml(computedEnd)}"
      data-is-once="${ONCE_TYPES.includes(activityType) ? 'yes' : 'no'}">
      ${editReqBadge}
      <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
      <input type="hidden" name="_activity_idx" value="${idx}">
      ${blockPrivateNote(row, { privateNote, showPrivateNote })}
      ${blockPeople(row, { settings })}
      ${blockContent(row, { settings })}
      ${blockDates(row, { canEdit, canDirectEdit, datesLoading })}
      ${blockNotes(row)}
    </form>
  `;
}

export function activityRowDetailHtml(row, { privateNote = null, hideActivityNo = false } = {}) {
  return `
    <div>שם פעילות: ${escapeHtml(fallback(row.activity_name))}</div>
    <div>סוג פעילות: ${escapeHtml(activityTypeLabel(row.activity_type))}</div>
    <div>בית ספר: ${escapeHtml(fallback(row.school))}</div>
    <div>רשות: ${escapeHtml(fallback(row.authority))}</div>
    <div>שכבה: ${escapeHtml(fallback(row.grade))}</div>
    <div>קבוצה/כיתה: ${escapeHtml(fallback(row.class_group))}</div>
    <div>שעות: ${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time))}</div>
    <div>תאריכי מפגשים: ${escapeHtml(formatActivityDateColumnsHe(row))}</div>
    ${privateNote === null ? '' : `<div>הערה תפעולית: ${escapeHtml(fallback(privateNote))}</div>`}
  `;
}

export function activityWorkDrawerHtml(row, opts = {}) {
  const { mode = 'single', summaryDate = '', privateNote = null, canEdit = false, canDirectEdit = false, settings = {}, datesLoading = false, exportAction = true } = opts;
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
            showPrivateNote: privateNote !== null,
            idx,
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
        showPrivateNote: privateNote !== null,
        datesLoading,
        idx: 0,
      })}
    </div>
  `;
}
