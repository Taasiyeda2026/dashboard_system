import { escapeHtml } from './html.js';
import { formatDateHe } from './format-date.js';

const ONCE_TYPES = ['workshop', 'tour', 'escape_room'];

const ACTIVITY_TYPE_PILL_LABEL = {
  course:       'קורס',
  after_school: 'חוג',
  workshop:     'סדנה',
  tour:         'סיור',
  escape_room:  'חדר בריחה'
};

const ACTIVITY_NAME_LABEL = {
  course:       'שם קורס',
  after_school: 'שם חוג',
  workshop:     'שם סדנה',
  tour:         'שם סיור',
  escape_room:  'שם פעילות'
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
  return (Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean);
}

function selectHtml({ name, value, options, klass = 'ds-input', placeholder = '—', attrs = '' }) {
  const safeValue = String(value || '');
  const normalized = toOptions(options);
  const all = normalized.includes(safeValue) || !safeValue ? normalized : [safeValue, ...normalized];
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(all.map((o) => `<option value="${escapeHtml(o)}"${o === safeValue ? ' selected' : ''}>${escapeHtml(o)}</option>`))
    .join('');
  return `<select class="${klass}" name="${escapeHtml(name)}" ${attrs}>${opts}</select>`;
}

function activityNameSelectHtml(name, value, options) {
  const safeValue = String(value || '');
  const all = Array.isArray(options) ? options.slice() : [];
  if (safeValue && !all.some((o) => String(o?.label || '') === safeValue)) {
    all.unshift({ label: safeValue, activity_no: '' });
  }
  const opts = ['<option value="">—</option>']
    .concat(all.map((o) => {
      const label = String(o?.label || '');
      const selected = label === safeValue ? ' selected' : '';
      const actNo = String(o?.activity_no || '');
      const actType = String(o?.parent_value || o?.activity_type || '');
      return `<option value="${escapeHtml(label)}" data-activity-no="${escapeHtml(actNo)}" data-activity-type="${escapeHtml(actType)}"${selected}>${escapeHtml(label)}</option>`;
    }))
    .join('');
  return `<select class="ds-input" name="${escapeHtml(name)}" data-activity-name>${opts}</select>`;
}

function autoEndDate(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) return '';
  return String(schedule[schedule.length - 1]?.date || '').trim();
}

function fieldViewEdit(label, viewHtml, editHtml) {
  return `<div class="ds-field-row">
    <span class="ds-field__label">${escapeHtml(label)}</span>
    <div data-view-only>${viewHtml}</div>
    <div data-edit-only hidden>${editHtml}</div>
  </div>`;
}

function headerHtml(row, { mode = 'single', summaryDate = '' } = {}) {
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const main = rows[0] || {};
    const instructorName = fallback(main.instructor_name || main.instructor_name_2 || 'ללא מדריך');
    const dateLabel = formatDateHe(summaryDate) || fallback(summaryDate);
    return `<div class="ds-drawer__header--activity">
      <div class="ds-drawer__header-top">
        <button class="ds-icon-btn" data-ui-close-drawer aria-label="סגירה">✕</button>
      </div>
      <h2 class="ds-drawer__title">${escapeHtml(instructorName)}</h2>
      <div class="ds-drawer__header-meta">${escapeHtml(`${dateLabel} · ${rows.length} פעילויות`)}</div>
    </div>`;
  }
  return `<div class="ds-drawer__header--activity">
    <div class="ds-drawer__header-top">
      <span class="ds-activity-type-pill">${escapeHtml(activityTypeLabel(row?.activity_type))}</span>
      <button class="ds-icon-btn" data-ui-close-drawer aria-label="סגירה">✕</button>
    </div>
    <h2 class="ds-drawer__title">${escapeHtml(fallback(row?.activity_name))}</h2>
    <div class="ds-drawer__header-meta">
      <span class="ds-status-pill ds-status-pill--subtle">${escapeHtml(statusText(row?.status))}</span>
      <span class="ds-drawer__school">${escapeHtml(fallback(row?.school))} · ${escapeHtml(fallback(row?.authority))}</span>
    </div>
  </div>`;
}

function blockPeople(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = toOptions(options.activity_manager);
  const instructors = toOptions(options.instructor_name);
  const activityType = String(row.activity_type || '').trim();
  const twoInstructors = activityType === 'workshop';

  const instructorFields = twoInstructors
    ? `<div class="ds-field-grid ds-field-grid--2">
        ${fieldViewEdit('מדריך/ה 1', `<span>${escapeHtml(fallback(row.instructor_name))}</span>`, selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors }))}
        ${fieldViewEdit('מדריך/ה 2', `<span>${escapeHtml(fallback(row.instructor_name_2))}</span>`, selectHtml({ name: 'instructor_name_2', value: row.instructor_name_2, options: instructors }))}
      </div>`
    : fieldViewEdit('מדריך/ה', `<span>${escapeHtml(fallback(row.instructor_name))}</span>`, selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors }));

  return `<section class="ds-drawer-block">
    <h3 class="ds-drawer-block__title">👤</h3>
    ${fieldViewEdit('מנהל פעילות', `<span>${escapeHtml(fallback(row.activity_manager))}</span>`, selectHtml({ name: 'activity_manager', value: row.activity_manager, options: managers }))}
    ${instructorFields}
  </section>`;
}

function blockContent(row, { settings = {} } = {}) {
  const options = settings?.dropdown_options || {};
  const fundings = toOptions(options.funding);
  const grades = toOptions(options.grade);
  const activityType = String(row.activity_type || '').trim();
  const nameLabel = activityNameLabel(activityType);

  const allActivityNames = Array.isArray(options.activity_names) ? options.activity_names : [];
  const filteredNames = allActivityNames.filter((o) => !o.parent_value || o.parent_value === activityType);

  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ') || '—';

  const hoursRow = String(row.hours || '').trim()
    ? `<div class="ds-field-row"><span class="ds-field__label">שעות</span><span>${escapeHtml(fallback(row.hours))}</span></div>` : '';
  const dayRow = String(row.day || '').trim()
    ? `<div class="ds-field-row"><span class="ds-field__label">יום</span><span>${escapeHtml(fallback(row.day))}</span></div>` : '';

  return `<section class="ds-drawer-block">
    <h3 class="ds-drawer-block__title">📚</h3>
    <div data-view-only>
      <div class="ds-field-row"><span class="ds-field__label">מימון</span><span>${escapeHtml(fallback(row.funding))}</span></div>
      <div class="ds-field-row"><span class="ds-field__label">כיתה</span><span>${escapeHtml(classLabel)}</span></div>
      ${hoursRow}${dayRow}
    </div>
    <div data-edit-only hidden>
      <div class="ds-field-row"><span class="ds-field__label">${escapeHtml(nameLabel)}</span>${activityNameSelectHtml('activity_name', row.activity_name, filteredNames)}</div>
      <div class="ds-field-row"><span class="ds-field__label">מימון</span>${selectHtml({ name: 'funding', value: row.funding, options: fundings })}</div>
      <div class="ds-field-row"><span class="ds-field__label">מחיר</span><input class="ds-input" type="number" name="price" value="${escapeHtml(String(row.price || ''))}"></div>
      <div class="ds-field-row"><span class="ds-field__label">בית ספר</span><input class="ds-input" type="text" name="school" value="${escapeHtml(String(row.school || ''))}"></div>
      <div class="ds-field-row"><span class="ds-field__label">רשות</span><input class="ds-input" type="text" name="authority" value="${escapeHtml(String(row.authority || ''))}"></div>
      <div class="ds-field-row"><span class="ds-field__label">שכבה</span>${selectHtml({ name: 'grade', value: row.grade, options: grades })}</div>
      <div class="ds-field-row"><span class="ds-field__label">קבוצה / כיתה</span><input class="ds-input" type="text" name="class_group" value="${escapeHtml(String(row.class_group || ''))}"></div>
      <div class="ds-field-grid ds-field-grid--2">
        <div class="ds-field-row"><span class="ds-field__label">שעת התחלה</span><input class="ds-input" type="text" name="start_hour" value="${escapeHtml(String(row.start_hour || ''))}"></div>
        <div class="ds-field-row"><span class="ds-field__label">שעת סיום</span><input class="ds-input" type="text" name="end_hour" value="${escapeHtml(String(row.end_hour || ''))}"></div>
      </div>
    </div>
  </section>`;
}

function blockDates(row, { canEdit = false } = {}) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const activityType = String(row.activity_type || '').trim();
  const isOnce = ONCE_TYPES.includes(activityType);
  const computedEnd = autoEndDate(row);
  const done = Number(row?.meetings_done || 0);
  const total = Number(row?.meetings_total || 0);
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const viewChips = schedule.map((item) => {
    const isDone = String(item?.performed || '').toLowerCase() === 'yes';
    return `<span class="ds-date-chip${isDone ? ' is-done' : ''}">${escapeHtml(formatDateHe(item?.date || ''))}</span>`;
  }).join('') || '<span class="ds-muted">—</span>';

  const editDates = isOnce ? schedule.slice(0, 1) : schedule;
  const datePickers = editDates.map((item, i) => `<div class="ds-date-pick-cell">
    <span class="ds-field__label">${i + 1}</span>
    <input class="ds-input ds-input--date" type="date" name="meeting_date_${i}" data-meeting-idx="${i}" value="${escapeHtml(String(item?.date || ''))}">
  </div>`).join('');

  const chainToggle = isOnce ? '' : `<div class="ds-chain-toggle" data-chain-toggle>
    <button type="button" class="ds-chain-btn is-active" data-chain-mode="single">בודד</button>
    <button type="button" class="ds-chain-btn" data-chain-mode="chain">שרשרת</button>
  </div>`;

  const addMeetingBtn = isOnce ? '' : `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-add-meeting-btn" data-add-meeting>➕ הוסף מפגש</button>`;

  return `<section class="ds-drawer-block">
    <div class="ds-block-head">
      <h3 class="ds-drawer-block__title">📅</h3>
      ${canEdit ? '<button type="button" class="ds-btn ds-btn--sm" data-action-edit>✏️ עריכה</button>' : ''}
    </div>
    <div class="ds-progress-bar-wrap">
      <div class="ds-progress-bar"><div class="ds-progress-bar__fill" style="width:${progressPct}%"></div></div>
      <span class="ds-progress-text">${done} מתוך ${total} מפגשים</span>
    </div>
    <div class="ds-end-date-row">
      <span class="ds-end-date-row__label">סיום</span>
      <strong class="ds-end-date-prominent" data-computed-end-display>${escapeHtml(formatDateHe(computedEnd) || '—')}</strong>
    </div>
    <div data-view-only class="ds-dates-grid ds-dates-grid--3col">${viewChips}</div>
    <div data-edit-only hidden class="ds-dates-edit-section">
      ${chainToggle}
      <div class="ds-dates-grid ds-dates-grid--2col" data-meeting-dates-edit>${datePickers}</div>
      ${addMeetingBtn}
    </div>
    <div data-edit-actions hidden class="ds-edit-actions">
      <button type="submit" class="ds-btn ds-btn--primary">💾 שמור</button>
      <button type="button" class="ds-btn ds-btn--ghost" data-action-cancel>ביטול</button>
      <p class="ds-muted ds-activity-edit-status" role="status"></p>
    </div>
  </section>`;
}

function blockNotes(row, { privateNote = null, showPrivateNote = false } = {}) {
  const privateSection = showPrivateNote
    ? `<div class="ds-private-note-section">
        <span class="ds-private-note-badge">🔒</span>
        ${fieldViewEdit('הערה תפעולית',
          `<span>${escapeHtml(fallback(privateNote || row.private_note || row.note_text))}</span>`,
          `<textarea class="ds-input" rows="2" name="private_note">${escapeHtml(String(row.private_note || row.note_text || ''))}</textarea>`
        )}
      </div>`
    : '';

  return `<section class="ds-drawer-block">
    <h3 class="ds-drawer-block__title">📝</h3>
    ${fieldViewEdit('הערות',
      `<span>${escapeHtml(fallback(row.notes))}</span>`,
      `<textarea class="ds-input" rows="2" name="notes">${escapeHtml(String(row.notes || ''))}</textarea>`
    )}
    ${privateSection}
  </section>`;
}

function singleForm(row, { settings = {}, privateNote = null, canEdit = false, showPrivateNote = false, idx = 0 }) {
  const computedEnd = autoEndDate(row);
  return `<form class="ds-activity-drawer-form" data-edit-activity
      data-source-sheet="${escapeHtml(String(row.source_sheet || ''))}"
      data-row-id="${escapeHtml(String(row.RowID || ''))}"
      data-activity-form
      data-auto-end-date="${escapeHtml(computedEnd)}"
      data-is-once="${ONCE_TYPES.includes(String(row.activity_type || '').trim()) ? 'yes' : 'no'}">
    <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
    ${blockPeople(row, { settings })}
    ${blockContent(row, { settings })}
    ${blockDates(row, { canEdit })}
    ${blockNotes(row, { privateNote, showPrivateNote })}
    <input type="hidden" name="_activity_idx" value="${idx}">
  </form>`;
}

export function activityRowDetailHtml(row, { privateNote = null, hideActivityNo = false } = {}) {
  return `<div class="ds-details-grid" dir="rtl">
    <p><strong>שם פעילות:</strong> ${escapeHtml(fallback(row.activity_name))}</p>
    <p><strong>סוג פעילות:</strong> ${escapeHtml(activityTypeLabel(row.activity_type))}</p>
    ${hideActivityNo ? '' : `<p><strong>מספר פעילות:</strong> ${escapeHtml(fallback(row.activity_no))}</p>`}
    <p><strong>בית ספר:</strong> ${escapeHtml(fallback(row.school))}</p>
    <p><strong>רשות:</strong> ${escapeHtml(fallback(row.authority))}</p>
    <p><strong>שכבה:</strong> ${escapeHtml(fallback(row.grade))}</p>
    <p><strong>קבוצה/כיתה:</strong> ${escapeHtml(fallback(row.class_group))}</p>
    ${privateNote === null ? '' : `<p><strong>הערה תפעולית:</strong> ${escapeHtml(fallback(privateNote))}</p>`}
  </div>`;
}

export function activityWorkDrawerHtml(row, opts = {}) {
  const { mode = 'single', summaryDate = '', privateNote = null, canEdit = false, settings = {} } = opts;

  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const body = rows.map((item, idx) => `<details class="ds-activity-accordion" ${idx === 0 ? 'open' : ''}>
      <summary class="ds-activity-accordion__summary">
        <span class="ds-activity-accordion__name">${escapeHtml(fallback(item.activity_name))}</span>
        <span class="ds-activity-accordion__meta">${escapeHtml(`${activityTypeLabel(item.activity_type)} · ${fallback(item.school)}`)}</span>
        <span class="ds-activity-accordion__chevron">›</span>
      </summary>
      <div class="ds-activity-accordion__body">
        ${singleForm(item, { settings, privateNote, canEdit, showPrivateNote: privateNote !== null, idx })}
      </div>
    </details>`).join('');
    return `${headerHtml(rows, { mode: 'summary', summaryDate })}<div class="ds-stack">${body || '<p class="ds-muted">אין נתונים</p>'}</div>`;
  }

  const one = row || {};
  return `${headerHtml(one)}${singleForm(one, { settings, privateNote, canEdit, showPrivateNote: privateNote !== null, idx: 0 })}`;
}
