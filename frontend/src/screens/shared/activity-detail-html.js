import { escapeHtml } from './html.js';
import { formatDateHe } from './format-date.js';

const ONCE_TYPES = ['workshop', 'tour', 'escape_room'];

const ACTIVITY_TYPE_PILL_LABEL = {
  course:       'קורס',
  after_school: 'חוג אפטרסקול',
  workshop:     'סדנה',
  tour:         'סיור',
  escape_room:  'חדר בריחה'
};

const ACTIVITY_NAME_LABEL = {
  course:       'שם קורס',
  after_school: 'שם חוג אפטרסקול',
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
  const dates = schedule
    .map((item) => String(item?.date || '').trim())
    .filter(Boolean)
    .sort();
  return dates[dates.length - 1] || '';
}

function meetingStats(schedule) {
  const list = Array.isArray(schedule) ? schedule : [];
  const done = list.filter((item) => String(item?.performed || '').toLowerCase() === 'yes').length;
  return { done, total: list.length };
}

function weekdayShortHe(iso) {
  const value = String(iso || '').trim();
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const map = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  return map[date.getDay()] || '';
}

function fieldViewEdit(label, viewHtml, editHtml, editing = false) {
  const labelHtml = String(label || '').trim()
    ? `<span class="ds-field__label">${escapeHtml(label)}</span>`
    : '';
  if (editing) {
    return `<div class="ds-field-row">${labelHtml}<div data-edit-only>${editHtml}</div></div>`;
  }
  return `<div class="ds-field-row">${labelHtml}<div data-view-only>${viewHtml}</div></div>`;
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

function blockPeople(row, { settings = {}, editing = false } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = toOptions(options.activity_manager);
  const instructors = toOptions(options.instructor_name);
  const activityType = String(row.activity_type || '').trim();
  const twoInstructors = activityType === 'workshop';

  const managerField = fieldViewEdit('מנהל פעילות',
    `<span>${escapeHtml(fallback(row.activity_manager))}</span>`,
    selectHtml({ name: 'activity_manager', value: row.activity_manager, options: managers }),
    editing);

  const instructorFields = twoInstructors
    ? `${fieldViewEdit('מדריך/ה 1', `<span>${escapeHtml(fallback(row.instructor_name))}</span>`, selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors }), editing)}
       ${fieldViewEdit('מדריך/ה 2', `<span>${escapeHtml(fallback(row.instructor_name_2))}</span>`, selectHtml({ name: 'instructor_name_2', value: row.instructor_name_2, options: instructors }), editing)}`
    : fieldViewEdit('מדריך/ה',
        `<span>${escapeHtml(fallback(row.instructor_name))}</span>`,
        selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors }),
        editing);

  return `<section class="ds-drawer-block ds-drawer-block--people">
    <h3 class="ds-drawer-block__title">👤</h3>
    <div class="ds-field-grid ds-field-grid--2">
      ${managerField}
      ${instructorFields}
    </div>
  </section>`;
}

function blockContent(row, { settings = {}, editing = false } = {}) {
  const options = settings?.dropdown_options || {};
  const fundings = toOptions(options.funding);
  const grades = toOptions(options.grade);
  const activityType = String(row.activity_type || '').trim();
  const nameLabel = activityNameLabel(activityType);

  const allActivityNames = Array.isArray(options.activity_names) ? options.activity_names : [];
  const filteredNamesByType = allActivityNames.filter((o) => {
    const sourceType = String(o?.parent_value || o?.activity_type || '').trim();
    return sourceType === activityType;
  });
  const filteredNames = filteredNamesByType.length ? filteredNamesByType : allActivityNames;

  const gradeVal = String(row.grade || '').trim();
  const classGroupVal = String(row.class_group || '').trim();
  const classLabel = [gradeVal, classGroupVal].filter(Boolean).join(' / ') || '—';

  const startTime = String(row.start_time || '').trim();
  const endTime = String(row.end_time || '').trim();
  const firstMeetingDate = (Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [])
    .map((item) => String(item?.date || '').trim())
    .filter(Boolean)
    .sort()[0] || '';
  const dayLabel = weekdayShortHe(firstMeetingDate) || '';
  const hoursLabel = startTime && endTime ? `${startTime}–${endTime}` : '';

  const viewSummaryItems = [
    row.funding && String(row.funding).trim() ? { label: 'מימון', value: row.funding } : null,
    classLabel && classLabel !== '—' ? { label: 'כיתה', value: classLabel } : null,
    hoursLabel ? { label: 'שעות', value: hoursLabel } : null,
    dayLabel ? { label: 'יום', value: dayLabel } : null,
  ].filter(Boolean);

  const viewSummaryHtml = viewSummaryItems.length
    ? viewSummaryItems.map((f) => `<div class="ds-field-row"><span class="ds-field__label">${escapeHtml(f.label)}</span><span class="ds-field__value">${escapeHtml(String(f.value))}</span></div>`).join('')
    : '<p class="ds-muted" style="margin:0;font-size:0.82rem">—</p>';

  return `<section class="ds-drawer-block">
    <h3 class="ds-drawer-block__title">📚</h3>
    <div data-view-only class="ds-field-grid ds-field-grid--2 ds-field-grid--compact">
      ${viewSummaryHtml}
    </div>
    <div data-edit-only hidden class="ds-drawer-content-edit-grid">
      <div class="ds-field-row ds-field-row--span2"><span class="ds-field__label">${escapeHtml(nameLabel)}</span>${activityNameSelectHtml('activity_name', row.activity_name, filteredNames)}</div>
      <div class="ds-field-row"><span class="ds-field__label">מימון</span>${selectHtml({ name: 'funding', value: row.funding, options: fundings })}</div>
      <div class="ds-field-row"><span class="ds-field__label">מחיר</span><input class="ds-input" type="number" name="price" value="${escapeHtml(String(row.price || ''))}"></div>
      <div class="ds-field-row"><span class="ds-field__label">בית ספר</span><input class="ds-input" type="text" name="school" value="${escapeHtml(String(row.school || ''))}"></div>
      <div class="ds-field-row"><span class="ds-field__label">רשות</span><input class="ds-input" type="text" name="authority" value="${escapeHtml(String(row.authority || ''))}"></div>
      <div class="ds-field-row"><span class="ds-field__label">שכבה</span>${selectHtml({ name: 'grade', value: row.grade, options: grades })}</div>
      <div class="ds-field-row"><span class="ds-field__label">קבוצה / כיתה</span><input class="ds-input" type="text" name="class_group" value="${escapeHtml(String(row.class_group || ''))}"></div>
      <div class="ds-field-grid ds-field-grid--2 ds-field-row--span2">
        <div class="ds-field-row"><span class="ds-field__label">שעת התחלה</span><input class="ds-input" type="time" name="start_time" value="${escapeHtml(startTime)}"></div>
        <div class="ds-field-row"><span class="ds-field__label">שעת סיום</span><input class="ds-input" type="time" name="end_time" value="${escapeHtml(endTime)}"></div>
      </div>
    </div>
  </section>`;
}

function blockDates(row, { canEdit = false, editing = false } = {}) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const activityType = String(row.activity_type || '').trim();
  const isOnce = ONCE_TYPES.includes(activityType);
  const normalizedSchedule = isOnce ? schedule.slice(0, 1) : schedule;
  const hasMoreDatesToggle = !isOnce && normalizedSchedule.length > 6;
  const computedEnd = autoEndDate({ meeting_schedule: normalizedSchedule });
  const { done, total } = meetingStats(normalizedSchedule);
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const datePickers = normalizedSchedule.map((item, i) => `<div class="ds-date-pick-cell">
    <span class="ds-date-pick-cell__head"><span>מפגש ${i + 1}</span><span class="ds-date-pick-cell__dot" aria-hidden="true"></span></span>
    <input class="ds-input ds-input--date" type="date" name="meeting_date_${i}" data-meeting-idx="${i}" value="${escapeHtml(String(item?.date || ''))}">
    <span class="ds-date-pick-cell__weekday">${escapeHtml(weekdayShortHe(item?.date) || '')}</span>
  </div>`).join('');

  const chainToggle = isOnce ? '' : `<div class="ds-chain-toggle" data-chain-toggle>
    <button type="button" class="ds-chain-btn is-active" data-chain-mode="chain">🔗 שרשרת</button>
    <button type="button" class="ds-chain-btn" data-chain-mode="single">📍 בודד</button>
  </div>`;

  const addMeetingBtn = isOnce ? '' : `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-add-meeting-btn" data-add-meeting>➕ הוסף מפגש</button>`;

  const viewChips = normalizedSchedule.map((item, i) => {
    const isDone = String(item?.performed || '').toLowerCase() === 'yes';
    return `<span class="ds-date-chip${isDone ? ' is-done' : ''}" data-date-card ${i > 5 ? 'hidden' : ''}>
      <span class="ds-date-chip__value">${escapeHtml(formatDateHe(item?.date || ''))}</span>
      <span class="ds-date-chip__weekday">${escapeHtml(weekdayShortHe(item?.date || ''))}</span>
      <span class="ds-date-chip__dot" aria-hidden="true"></span>
    </span>`;
  }).join('') || '<span class="ds-muted">—</span>';

  return `<section class="ds-drawer-block">
    <div class="ds-block-head">
      <h3 class="ds-drawer-block__title">📅</h3>
      ${canEdit ? '<button type="button" class="ds-btn ds-btn--sm" data-view-only data-action-edit>✏️ עריכה</button>' : ''}
      ${canEdit ? `<div data-edit-only data-edit-actions hidden class="ds-edit-actions">
          ${chainToggle}
          ${addMeetingBtn}
          <button type="submit" class="ds-btn ds-btn--sm ds-btn--primary">💾 שמור</button>
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-action-cancel>ביטול</button>
          <p class="ds-muted ds-activity-edit-status" role="status"></p>
        </div>` : ''}
    </div>
    <div data-view-only class="ds-progress-bar-wrap">
      <span class="ds-progress-text ds-progress-text--pct">${progressPct}%</span>
      <div class="ds-progress-bar"><div class="ds-progress-bar__fill" style="width:${progressPct}%"></div></div>
      <span class="ds-progress-text">${done} מתוך ${total} מפגשים בוצעו</span>
    </div>
    <div class="ds-end-date-row">
      <span class="ds-end-date-row__label">🏁 תאריך סיום</span>
      <strong class="ds-end-date-prominent" data-computed-end-display>${escapeHtml(formatDateHe(computedEnd) || '—')}</strong>
      <span class="ds-end-date-row__hint">מחושב אוטומטית לפי המפגש האחרון</span>
    </div>
    <div data-view-only class="ds-dates-grid ds-dates-grid--3col">${viewChips}</div>
    ${hasMoreDatesToggle ? '<button type="button" data-view-only class="ds-link-btn ds-dates-more-btn" data-action-toggle-dates hidden>+0 עוד ▾</button>' : ''}
    <div data-edit-only hidden class="ds-dates-edit-section">
      <div class="ds-dates-grid ds-dates-grid--2col" data-meeting-dates-edit>${datePickers}</div>
    </div>
  </section>`;
}

function blockNotes(row, { privateNote = null, showPrivateNote = false, editing = false } = {}) {
  const operationalPrivateNote = String(row.operations_private_notes || '').trim();
  const notesValue = String(row.notes || '').trim();

  if (editing) {
    const notesLabelHtml = `<span class="ds-field__label">הערות</span>`;
    const notesEditHtml = `<textarea class="ds-input" rows="2" name="notes">${escapeHtml(String(row.notes || ''))}</textarea>`;
    const notesFieldHtml = `<div class="ds-field-row">${notesLabelHtml}${notesEditHtml}</div>`;

    const privateSection = showPrivateNote
      ? `<div class="ds-private-note-section">
          <span class="ds-private-note-badge" aria-label="הערה פרטית">🔒</span>
          <div class="ds-field-row">
            <textarea class="ds-input" rows="2" name="operations_private_notes">${escapeHtml(String(operationalPrivateNote))}</textarea>
          </div>
        </div>`
      : '';

    return `<section class="ds-drawer-block">
      <h3 class="ds-drawer-block__title">📝</h3>
      ${notesFieldHtml}
      ${privateSection}
    </section>`;
  }

  const notesViewHtml = notesValue ? `<span class="ds-field__value">${escapeHtml(notesValue)}</span>` : '';
  const notesLabelHtml = notesViewHtml ? `<span class="ds-field__label">הערות</span>` : '';
  const notesFieldHtml = `<div class="ds-field-row">
    ${notesLabelHtml}
    ${notesViewHtml}
  </div>`;

  const privateSection = showPrivateNote && operationalPrivateNote
    ? `<div class="ds-private-note-section">
        <span class="ds-private-note-badge" aria-label="הערה פרטית">🔒</span>
        <div class="ds-field-row">
          <span class="ds-field__value">${escapeHtml(operationalPrivateNote)}</span>
        </div>
      </div>`
    : '';

  return `<section class="ds-drawer-block">
    <h3 class="ds-drawer-block__title">📝</h3>
    ${notesFieldHtml}
    ${privateSection}
  </section>`;
}

function singleForm(row, { settings = {}, privateNote = null, canEdit = false, showPrivateNote = false, idx = 0, editing = false }) {
  const computedEnd = autoEndDate(row);
  return `<form class="ds-activity-drawer-form" data-edit-activity
      data-source-sheet="${escapeHtml(String(row.source_sheet || ''))}"
      data-row-id="${escapeHtml(String(row.RowID || ''))}"
      data-activity-form
      data-auto-end-date="${escapeHtml(computedEnd)}"
      data-is-once="${ONCE_TYPES.includes(String(row.activity_type || '').trim()) ? 'yes' : 'no'}"
      data-editing="${editing ? 'yes' : 'no'}">
    <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
    ${blockPeople(row, { settings, editing })}
    ${blockContent(row, { settings, editing })}
    ${blockDates(row, { canEdit, editing })}
    ${blockNotes(row, { privateNote, showPrivateNote, editing })}
    <input type="hidden" name="_activity_idx" value="${idx}">
  </form>`;
}

export function activityRowDetailHtml(row, { privateNote = null, hideActivityNo = true } = {}) {
  return `<div class="ds-details-grid" dir="rtl">
    <p><strong>שם פעילות:</strong> ${escapeHtml(fallback(row.activity_name))}</p>
    <p><strong>סוג פעילות:</strong> ${escapeHtml(activityTypeLabel(row.activity_type))}</p>
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
