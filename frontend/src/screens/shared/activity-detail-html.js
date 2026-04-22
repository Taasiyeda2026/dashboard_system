import { escapeHtml } from './html.js';
import { formatDateHe } from './format-date.js';

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

function normStatus(v) {
  return String(v || '').trim().toLowerCase() === 'closed' ? 'closed' : 'open';
}

function statusText(status) {
  return normStatus(status) === 'closed' ? 'הסתיים' : 'פתוח';
}

function toOptions(values) {
  return (Array.isArray(values) ? values : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function selectHtml({ name, value, options, klass = 'ds-input', placeholder = '—', attrs = '' }) {
  const safeValue = String(value || '');
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

function activityNameSelectHtml(name, value, options, activityType) {
  const safeValue = String(value || '').trim();
  const filtered = (Array.isArray(options) ? options : []).filter((o) => {
    const parent = String(o?.parent_value || o?.activity_type || '').trim();
    return !parent || parent === activityType;
  });
  const all = filtered.slice();
  if (safeValue && !all.some((o) => String(o?.label || '').trim() === safeValue)) {
    all.unshift({ label: safeValue, activity_no: '', parent_value: activityType });
  }
  const opts = [`<option value="">—</option>`]
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
  return `<select class="ds-input" name="${escapeHtml(name)}" data-role="activity-name-select" data-activity-name>${opts}</select>`;
}

function autoEndDate(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) return '';
  return String(schedule[schedule.length - 1]?.date || '').trim();
}

function shortWeekdayFromIso(iso) {
  const value = String(iso || '').trim();
  if (!value) return '—';
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  const map = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  return map[d.getDay()] || '—';
}

function fieldViewEdit(label, viewHtml, editHtml) {
  return `
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">${escapeHtml(label)}</div>
      <div class="activity-drawer__view" data-mode="view">${viewHtml}</div>
      <div class="activity-drawer__edit" data-mode="edit">${editHtml}</div>
    </div>
  `;
}

function fieldViewOnly(label, viewHtml) {
  return `
    <div class="activity-drawer__field">
      <div class="activity-drawer__label">${escapeHtml(label)}</div>
      <div class="activity-drawer__view" data-mode="view">${viewHtml}</div>
    </div>
  `;
}

function headerHtml(row, { mode = 'single', summaryDate = '' } = {}) {
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const main = rows[0] || {};
    const instructorName = fallback(main.instructor_name || main.instructor_name_2 || 'ללא מדריך');
    const dateLabel = formatDateHe(summaryDate) || fallback(summaryDate);
    return `
      <div class="activity-drawer__header">
        <button type="button" class="activity-drawer__close" data-action="close-drawer" data-ui-close-drawer aria-label="סגירה">✕</button>
        <h2 class="activity-drawer__title">${escapeHtml(instructorName)}</h2>
        <div class="activity-drawer__meta">${escapeHtml(`${dateLabel} · ${rows.length} פעילויות`)}</div>
      </div>
    `;
  }
  return `
    <div class="activity-drawer__header">
      <div class="activity-drawer__header-top">
        <span class="activity-drawer__pill">${escapeHtml(activityTypeLabel(row?.activity_type))}</span>
        <button type="button" class="activity-drawer__close" data-action="close-drawer" data-ui-close-drawer aria-label="סגירה">✕</button>
      </div>
      <h2 class="activity-drawer__title">${escapeHtml(fallback(row?.activity_name))}</h2>
      <div class="activity-drawer__meta">
        <span class="activity-drawer__status">${escapeHtml(statusText(row?.status))}</span>
        <span>${escapeHtml(fallback(row?.school))} · ${escapeHtml(fallback(row?.authority))}</span>
      </div>
    </div>
  `;
}

function blockPeople(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = toOptions(options.activity_manager);
  const instructors = toOptions(options.instructor_name);
  const activityType = String(row.activity_type || '').trim();
  const twoInstructors = activityType === 'workshop';
  const instructorFields = twoInstructors
    ? `
      ${fieldViewEdit(
        'מדריך/ה 1',
        `${escapeHtml(fallback(row.instructor_name))}`,
        selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors })
      )}
      ${fieldViewEdit(
        'מדריך/ה 2',
        `${escapeHtml(fallback(row.instructor_name_2))}`,
        selectHtml({ name: 'instructor_name_2', value: row.instructor_name_2, options: instructors })
      )}
    `
    : fieldViewEdit(
        'מדריך/ה',
        `${escapeHtml(fallback(row.instructor_name))}`,
        selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors })
      );
  return `
    <section class="activity-drawer__section">
      <h3 class="activity-drawer__section-title">👤</h3>
      <div class="activity-drawer__grid activity-drawer__grid--two">
        ${fieldViewEdit(
          'מנהל פעילות',
          `${escapeHtml(fallback(row.activity_manager))}`,
          selectHtml({ name: 'activity_manager', value: row.activity_manager, options: managers })
        )}
        ${instructorFields}
      </div>
    </section>
  `;
}

function blockContent(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const fundings = toOptions(options.funding);
  const grades = toOptions(options.grade);
  const allActivityNames = Array.isArray(options.activity_names) ? options.activity_names : [];
  const activityType = String(row.activity_type || '').trim();
  const nameLabel = activityNameLabel(activityType);
  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ') || '—';
  const firstMeetingDate = Array.isArray(row.meeting_schedule) && row.meeting_schedule.length
    ? String(row.meeting_schedule[0]?.date || '').trim()
    : String(row.start_date || '').trim();
  const hoursLabel =
    String(row.start_time || '').trim() && String(row.end_time || '').trim()
      ? `${String(row.start_time).trim()}-${String(row.end_time).trim()}`
      : '—';
  const dayLabel = shortWeekdayFromIso(firstMeetingDate);
  return `
    <section class="activity-drawer__section">
      <h3 class="activity-drawer__section-title">📚</h3>
      <div class="activity-drawer__view-grid activity-drawer__grid activity-drawer__grid--two" data-mode="view">
        ${fieldViewOnly('מימון', escapeHtml(fallback(row.funding)))}
        ${fieldViewOnly('כיתה', escapeHtml(classLabel))}
        ${fieldViewOnly('שעות', escapeHtml(hoursLabel))}
        ${fieldViewOnly('יום', escapeHtml(dayLabel))}
      </div>
      <div class="activity-drawer__edit-grid activity-drawer__grid activity-drawer__grid--two" data-mode="edit">
        <div class="activity-drawer__field activity-drawer__field--full">
          <div class="activity-drawer__label">${escapeHtml(nameLabel)}</div>
          ${activityNameSelectHtml('activity_name', row.activity_name, allActivityNames, activityType)}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">מימון</div>
          ${selectHtml({ name: 'funding', value: row.funding, options: fundings })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">מחיר</div>
          ${inputHtml({ name: 'price', value: row.price })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">בית ספר</div>
          ${inputHtml({ name: 'school', value: row.school })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">רשות</div>
          ${inputHtml({ name: 'authority', value: row.authority })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">שכבה</div>
          ${selectHtml({ name: 'grade', value: row.grade, options: grades })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">קבוצה / כיתה</div>
          ${inputHtml({ name: 'class_group', value: row.class_group })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">שעת התחלה</div>
          ${inputHtml({ name: 'start_time', value: row.start_time, type: 'time' })}
        </div>
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">שעת סיום</div>
          ${inputHtml({ name: 'end_time', value: row.end_time, type: 'time' })}
        </div>
      </div>
    </section>
  `;
}

function blockDates(row, { canEdit = false } = {}) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const activityType = String(row.activity_type || '').trim();
  const isOnce = ONCE_TYPES.includes(activityType);
  const computedEnd = autoEndDate(row);
  const done = Number(row?.meetings_done || 0);
  const total = Number(row?.meetings_total || schedule.length || 0);
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const viewChips = (isOnce ? schedule.slice(0, 1) : schedule)
    .map((item) => {
      const isDone = String(item?.performed || '').toLowerCase() === 'yes';
      return `
        <div class="activity-drawer__date-chip ${isDone ? 'is-done' : ''}" data-date-card>
          <span>${escapeHtml(formatDateHe(item?.date || ''))}</span>
          <span class="activity-drawer__weekday">${escapeHtml(shortWeekdayFromIso(item?.date || ''))}</span>
        </div>
      `;
    })
    .join('') || '<div class="activity-drawer__date-chip">—</div>';
  const editDates = isOnce ? schedule.slice(0, 1) : schedule;
  const datePickers = editDates
    .map((item, i) => `
      <div class="activity-drawer__date-card" data-meeting-index="${i}">
        <div class="activity-drawer__date-card-top">
          <span class="activity-drawer__meeting-index">מפגש ${i + 1}</span>
          <span class="activity-drawer__weekday">${escapeHtml(shortWeekdayFromIso(item?.date || ''))}</span>
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
      <div class="activity-drawer__date-mode" data-mode="edit" data-chain-toggle>
        <button type="button" class="activity-drawer__toggle" data-date-mode="single" data-chain-mode="single">בודד</button>
        <button type="button" class="activity-drawer__toggle is-active" data-date-mode="chain" data-chain-mode="chain">שרשרת</button>
      </div>
    `;
  const addMeetingBtn = isOnce
    ? ''
    : `<button type="button" class="activity-drawer__action activity-drawer__action--ghost" data-action="add-meeting" data-add-meeting data-mode="edit">➕ הוסף מפגש</button>`;
  const moreBtn = !isOnce && schedule.length > 6
    ? `<button type="button" class="activity-drawer__more" data-action="toggle-more" data-action-toggle-dates data-mode="view">+עוד</button>`
    : '';
  return `
    <section class="activity-drawer__section">
      <div class="activity-drawer__section-head">
        <h3 class="activity-drawer__section-title">📅</h3>
        ${canEdit ? '<button type="button" class="activity-drawer__action" data-action="start-edit" data-action-edit data-mode="view">✏️ עריכה</button>' : ''}
      </div>
      <div class="activity-drawer__progress" data-mode="view">
        <div class="activity-drawer__progress-meta">
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
      <div class="activity-drawer__dates activity-drawer__dates--view" data-mode="view">
        ${viewChips}
      </div>
      ${moreBtn}
      <div class="activity-drawer__dates activity-drawer__dates--edit" data-mode="edit" data-meeting-dates-edit>
        ${datePickers}
      </div>
      ${chainToggle}
      ${addMeetingBtn}
      <div class="activity-drawer__edit-actions" data-mode="edit" data-edit-actions>
        <button type="submit" class="activity-drawer__action activity-drawer__action--primary" data-action="save-edit">שמור</button>
        <button type="button" class="activity-drawer__action" data-action="cancel-edit" data-action-cancel>ביטול</button>
        <p class="ds-activity-edit-status ds-muted" role="status"></p>
      </div>
    </section>
  `;
}

function blockNotes(row, { privateNote = null, showPrivateNote = false } = {}) {
  const privateValue =
    privateNote !== null && privateNote !== undefined
      ? privateNote
      : row.operations_private_notes;
  const privateSection = showPrivateNote
    ? `
      <div class="activity-drawer__private">
        <div class="activity-drawer__private-badge">🔒</div>
        ${fieldViewEdit(
          'הערה תפעולית',
          `${escapeHtml(fallback(privateValue))}`,
          textareaHtml({ name: 'operations_private_notes', value: String(privateValue || ''), rows: 2 })
        )}
      </div>
    `
    : '';
  return `
    <section class="activity-drawer__section">
      <h3 class="activity-drawer__section-title">📝</h3>
      ${fieldViewEdit(
        'הערות',
        `${escapeHtml(fallback(row.notes))}`,
        textareaHtml({ name: 'notes', value: String(row.notes || ''), rows: 2 })
      )}
      ${privateSection}
    </section>
  `;
}

function singleForm(row, { settings = {}, privateNote = null, canEdit = false, showPrivateNote = false, idx = 0 } = {}) {
  const computedEnd = autoEndDate(row);
  const activityType = String(row.activity_type || '').trim();
  return `
    <form class="activity-drawer__form" data-drawer-form data-activity-form data-edit-activity
      data-source-sheet="${escapeHtml(String(row.source_sheet || ''))}"
      data-row-id="${escapeHtml(String(row.RowID || ''))}"
      data-auto-end-date="${escapeHtml(computedEnd)}"
      data-is-once="${ONCE_TYPES.includes(activityType) ? 'yes' : 'no'}">
      <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
      <input type="hidden" name="_activity_idx" value="${idx}">
      ${blockPeople(row, { settings })}
      ${blockContent(row, { settings })}
      ${blockDates(row, { canEdit })}
      ${blockNotes(row, { privateNote, showPrivateNote })}
    </form>
  `;
}

export function activityRowDetailHtml(row, { privateNote = null, hideActivityNo = false } = {}) {
  return `
    <div>שם פעילות: ${escapeHtml(fallback(row.activity_name))}</div>
    <div>סוג פעילות: ${escapeHtml(activityTypeLabel(row.activity_type))}</div>
    ${hideActivityNo ? '' : `<div>מספר פעילות: ${escapeHtml(fallback(row.activity_no))}</div>`}
    <div>בית ספר: ${escapeHtml(fallback(row.school))}</div>
    <div>רשות: ${escapeHtml(fallback(row.authority))}</div>
    <div>שכבה: ${escapeHtml(fallback(row.grade))}</div>
    <div>קבוצה/כיתה: ${escapeHtml(fallback(row.class_group))}</div>
    ${privateNote === null ? '' : `<div>הערה תפעולית: ${escapeHtml(fallback(privateNote))}</div>`}
  `;
}

export function activityWorkDrawerHtml(row, opts = {}) {
  const { mode = 'single', summaryDate = '', privateNote = null, canEdit = false, settings = {} } = opts;
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const body = rows
      .map((item, idx) => `
        <div class="activity-drawer__summary-item">
          <div class="activity-drawer__summary-head">
            <strong>${escapeHtml(fallback(item.activity_name))}</strong>
            <span>${escapeHtml(`${activityTypeLabel(item.activity_type)} · ${fallback(item.school)}`)}</span>
          </div>
          ${singleForm(item, {
            settings,
            privateNote,
            canEdit,
            showPrivateNote: privateNote !== null,
            idx,
          })}
        </div>
      `)
      .join('');
    return `
      ${headerHtml(rows, { mode: 'summary', summaryDate })}
      <div class="activity-drawer__body">
        ${body || '<div class="activity-drawer__empty">אין נתונים</div>'}
      </div>
    `;
  }
  const one = row || {};
  return `
    ${headerHtml(one)}
    <div class="activity-drawer__body">
      ${singleForm(one, {
        settings,
        privateNote,
        canEdit,
        showPrivateNote: privateNote !== null,
        idx: 0,
      })}
    </div>
  `;
}
