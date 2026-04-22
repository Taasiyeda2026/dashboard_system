import { escapeHtml } from './html.js';
import { visibleActivityCategoryLabel } from './ui-hebrew.js';
import { formatDateHe } from './format-date.js';

const FUNDING_OPTIONS = [
  'רמי שני', 'גפן', 'אדמה', 'היי-דרוז', 'מתנ"ס', 'ויצו', 'מ.ר.ק', 'רשות', 'מארוול',
  'תעשיינים צפון', 'בנק הפועלים', 'אסם', 'על-בד'
];

const GRADE_OPTIONS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳', 'י׳', 'י״א', 'י״ב'];

const ACTIVITY_CATALOG = [
  { label: 'ביומימיקרי', parent_value: 'course', activity_no: '6089' },
  { label: 'ביומימיקרי לחטיבה', parent_value: 'course', activity_no: '53828' },
  { label: 'בינה מלאכותית', parent_value: 'course', activity_no: '9545' },
  { label: 'השמיים אינם הגבול', parent_value: 'course', activity_no: '57646' },
  { label: 'טכנולוגיות החלל', parent_value: 'course', activity_no: '57651' },
  { label: 'יישומי AI', parent_value: 'course', activity_no: '53819' },
  { label: 'מנהיגות ירוקה', parent_value: 'course', activity_no: '90001' },
  { label: 'פורצות דרך', parent_value: 'course', activity_no: '3604' },
  { label: 'פרימיום', parent_value: 'course', activity_no: '90004' },
  { label: 'רוקחים עולם', parent_value: 'course', activity_no: '46091' },
  { label: 'תלמידים להייטק', parent_value: 'after_school', activity_no: '90002' },
  { label: 'מייקרים', parent_value: 'after_school', activity_no: '90003' },
  { label: 'תמיר - המחזור מתחיל בבית', parent_value: 'workshop', activity_no: '60025' },
  { label: 'תמיר - חדר בריחה קווסט', parent_value: 'workshop', activity_no: '60026' },
  { label: 'תמיר - איפה דדי', parent_value: 'workshop', activity_no: '60027' },
  { label: 'התנסות בתעשייה', parent_value: 'tour', activity_no: '13990' },
  { label: 'חדר בריחה ביומימיקרי', parent_value: 'escape_room', activity_no: '1001' }
];

function fallback(v) {
  return String(v || '').trim() || '—';
}

function isProgram(row) {
  return String(row?.source_sheet || '').toLowerCase().includes('long');
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
  if (safeValue && !all.some((o) => o.label === safeValue)) {
    all.unshift({ label: safeValue, activity_no: '' });
  }
  const opts = ['<option value="">—</option>']
    .concat(all.map((o) => {
      const label = String(o?.label || '');
      const selected = label === safeValue ? ' selected' : '';
      const activityNo = String(o?.activity_no || '');
      return `<option value="${escapeHtml(label)}" data-activity-no="${escapeHtml(activityNo)}"${selected}>${escapeHtml(label)}</option>`;
    }))
    .join('');
  return `<select class="ds-input" name="${escapeHtml(name)}" data-activity-name>${opts}</select>`;
}

function headerHtml(row, { mode = 'single', summaryDate = '' } = {}) {
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const main = rows[0] || {};
    const instructorName = fallback(main.instructor_name || main.instructor_name_2 || 'ללא מדריך');
    const dateLabel = formatDateHe(summaryDate) || fallback(summaryDate);
    return `<div class="ds-drawer__header ds-drawer__header--activity">
      <button class="ds-icon-btn" data-ui-close-drawer aria-label="סגירה">✕</button>
      <h2 class="ds-drawer__title">${escapeHtml(instructorName)}</h2>
      <div class="ds-drawer__header-meta">${escapeHtml(`${dateLabel} · ${rows.length} פעילויות`)}</div>
    </div>`;
  }
  return `<div class="ds-drawer__header ds-drawer__header--activity">
    <span class="ds-activity-type-badge">${escapeHtml(visibleActivityCategoryLabel(row?.activity_type))}</span>
    <button class="ds-icon-btn" data-ui-close-drawer aria-label="סגירה">✕</button>
    <h2 class="ds-drawer__title">${escapeHtml(fallback(row?.activity_name))}</h2>
    <div class="ds-drawer__header-meta">
      <span class="ds-status-pill ds-status-pill--subtle">${escapeHtml(statusText(row?.status))}</span>
      <span class="ds-drawer__school">${escapeHtml(`${fallback(row?.school)} · ${fallback(row?.authority)}`)}</span>
    </div>
  </div>`;
}

function meetingChips(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  const shown = schedule.slice(0, 6);
  const rest = Math.max(0, schedule.length - shown.length);
  const chips = shown.map((item) => {
    const done = String(item?.performed || '').toLowerCase() === 'yes';
    return `<span class="ds-date-chip ${done ? 'is-done' : ''}">${escapeHtml(formatDateHe(item?.date || ''))}</span>`;
  }).join('');
  const more = rest > 0 ? `<button type="button" class="ds-link-btn" data-toggle-more>${rest} עוד ▾</button>` : '';
  const extra = rest > 0 ? `<div class="ds-date-chip-row" data-more-dates hidden>${schedule.slice(6).map((item) => {
    const done = String(item?.performed || '').toLowerCase() === 'yes';
    return `<span class="ds-date-chip ${done ? 'is-done' : ''}">${escapeHtml(formatDateHe(item?.date || ''))}</span>`;
  }).join('')}</div>` : '';
  return `<div class="ds-date-chip-row">${chips || '<span class="ds-muted">—</span>'}${more}</div>${extra}`;
}

function meetingProgress(row) {
  const done = Number(row?.meetings_done || 0);
  const total = Number(row?.meetings_total || 0);
  return `${done} מתוך ${total} מפגשים בוצעו`;
}

function autoEndDate(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) return '';
  return String(schedule[schedule.length - 1]?.date || '').trim();
}

function fieldViewEdit(label, viewHtml, editHtml) {
  return `<div class="ds-field-row"><span class="ds-field__label">${escapeHtml(label)}</span>
    <div data-view-only>${viewHtml}</div><div data-edit-only hidden>${editHtml}</div></div>`;
}

function blockActivity(row, { settings = {}, privateNote = null, canEdit = false, showPrivateNote = false, idx = 0 } = {}) {
  const options = settings?.dropdown_options || {};
  const managers = toOptions(options.activity_manager);
  const authorities = toOptions(options.authority);
  const instructors = toOptions(options.instructor_name);
  const isLong = isProgram(row);
  const activityType = String(row.activity_type || '').trim();
  const courses = ACTIVITY_CATALOG.filter((x) => x.parent_value === (isLong ? 'course' : activityType));
  const courseOptions = courses.map((c) => ({ label: c.label, activity_no: c.activity_no }));
  const computedEnd = autoEndDate(row);
  const manualEnd = String(row.end_date || '').trim() && String(row.end_date || '').trim() !== computedEnd;

  const notesField = fieldViewEdit(
    'הערות',
    `<span>${escapeHtml(fallback(row.notes))}</span>`,
    `<textarea class="ds-input" rows="2" name="notes">${escapeHtml(String(row.notes || ''))}</textarea>`
  );

  const privateField = showPrivateNote
    ? `<div class="ds-private-note-section"><span class="ds-private-note-badge">🔒 תפעול בלבד</span>${fieldViewEdit(
      'הערה תפעולית',
      `<span>${escapeHtml(fallback(privateNote || row.private_note || row.note_text))}</span>`,
      `<textarea class="ds-input" rows="2" name="private_note">${escapeHtml(String(row.private_note || row.note_text || ''))}</textarea>`
    )}</div>`
    : '';

  return `<form class="ds-activity-drawer-form" data-edit-activity data-source-sheet="${escapeHtml(String(row.source_sheet || ''))}" data-row-id="${escapeHtml(String(row.RowID || ''))}" data-activity-form data-auto-end-date="${escapeHtml(computedEnd)}">
    <input type="hidden" name="activity_no" value="${escapeHtml(String(row.activity_no || ''))}" data-activity-no>
    <section class="ds-drawer-block">
      <h3 class="ds-drawer-block__title">👤 אנשים</h3>
      ${fieldViewEdit('מנהל פעילות', `<span>${escapeHtml(fallback(row.activity_manager))}</span>`, selectHtml({ name: 'activity_manager', value: row.activity_manager, options: managers }))}
      ${isLong
        ? fieldViewEdit('מדריך/ה', `<span>${escapeHtml(fallback(row.instructor_name))}</span>`, selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors }))
        : `<div class="ds-field-grid ds-field-grid--2">${fieldViewEdit('מדריך/ה 1', `<span>${escapeHtml(fallback(row.instructor_name))}</span>`, selectHtml({ name: 'instructor_name', value: row.instructor_name, options: instructors }))}${fieldViewEdit('מדריך/ה 2', `<span>${escapeHtml(fallback(row.instructor_name_2))}</span>`, selectHtml({ name: 'instructor_name_2', value: row.instructor_name_2, options: instructors }))}</div>`}
    </section>

    <section class="ds-drawer-block">
      <h3 class="ds-drawer-block__title">📚 פעילות</h3>
      ${fieldViewEdit(isLong ? 'שם קורס' : 'שם פעילות', `<span>${escapeHtml(fallback(row.activity_name))}</span>`, activityNameSelectHtml('activity_name', row.activity_name, courseOptions))}
      ${fieldViewEdit('מימון', `<span>${escapeHtml(fallback(row.funding))}</span>`, selectHtml({ name: 'funding', value: row.funding, options: FUNDING_OPTIONS }))}
      ${fieldViewEdit('בית ספר', `<span>${escapeHtml(fallback(row.school))}</span>`, `<input class="ds-input" type="text" name="school" value="${escapeHtml(String(row.school || ''))}">`)}
      ${fieldViewEdit('רשות', `<span>${escapeHtml(fallback(row.authority))}</span>`, selectHtml({ name: 'authority', value: row.authority, options: authorities }))}
      ${fieldViewEdit('שכבה', `<span>${escapeHtml(fallback(row.grade))}</span>`, selectHtml({ name: 'grade', value: row.grade, options: GRADE_OPTIONS }))}
      ${fieldViewEdit('קבוצה / כיתה', `<span>${escapeHtml(fallback(row.class_group))}</span>`, `<input class="ds-input" type="text" name="class_group" value="${escapeHtml(String(row.class_group || ''))}">`)}
    </section>

    <section class="ds-drawer-block">
      <div class="ds-block-head"><h3 class="ds-drawer-block__title">📅 תאריכים ומפגשים</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm" data-action-edit>✏️ עריכה</button>' : ''}</div>
      <div class="ds-progress-line">${escapeHtml(meetingProgress(row))}</div>
      <div class="ds-end-date-row ${manualEnd ? 'ds-end-date-row--override' : ''}">
        <span class="ds-end-date-row__label">תאריך סיום:</span>
        <span data-view-only>${escapeHtml(formatDateHe(row.end_date || computedEnd) || '—')} ${manualEnd ? '<span class="ds-end-date-row__badge--manual">ידני</span>' : ''}</span>
        <div data-edit-only hidden class="ds-end-date-edit">
          <input class="ds-input" type="date" name="end_date" value="${escapeHtml(String(row.end_date || computedEnd || ''))}">
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-reset-end-date ${computedEnd ? '' : 'disabled'}>↺ אוטומטי</button>
        </div>
      </div>
      ${meetingChips(row)}
      <div class="ds-field-row">
        <span class="ds-field__label">סטטוס</span>
        <div data-view-only><span class="ds-status-pill ds-status-pill--subtle">${escapeHtml(statusText(row.status))}</span></div>
        <div data-edit-only hidden>${selectHtml({ name: 'status', value: normStatus(row.status), options: ['open', 'closed'] })}</div>
      </div>
      <div data-edit-actions hidden class="ds-edit-actions">
        <button type="submit" class="ds-btn ds-btn--primary">💾 שמור</button>
        <button type="button" class="ds-btn ds-btn--ghost" data-action-cancel>ביטול</button>
        <p class="ds-muted ds-activity-edit-status" role="status"></p>
      </div>
    </section>

    <section class="ds-drawer-block">
      <h3 class="ds-drawer-block__title">📝 הערות</h3>
      ${notesField}
      ${privateField}
    </section>

    <input type="hidden" name="_activity_idx" value="${idx}">
  </form>`;
}

export function activityRowDetailHtml(row, { privateNote = null, hideActivityNo = false } = {}) {
  return `<div class="ds-details-grid" dir="rtl">
    <p><strong>שם פעילות:</strong> ${escapeHtml(fallback(row.activity_name))}</p>
    <p><strong>סוג פעילות:</strong> ${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</p>
    ${hideActivityNo ? '' : `<p><strong>מספר פעילות:</strong> ${escapeHtml(fallback(row.activity_no))}</p>`}
    <p><strong>בית ספר:</strong> ${escapeHtml(fallback(row.school))}</p>
    <p><strong>רשות:</strong> ${escapeHtml(fallback(row.authority))}</p>
    <p><strong>שכבה:</strong> ${escapeHtml(fallback(row.grade))}</p>
    <p><strong>קבוצה/כיתה:</strong> ${escapeHtml(fallback(row.class_group))}</p>
    ${privateNote === null ? '' : `<p><strong>הערה תפעולית:</strong> ${escapeHtml(fallback(privateNote))}</p>`}
  </div>`;
}

export function activityWorkDrawerHtml(row, opts = {}) {
  const { mode = 'single', summaryDate = '', privateNote = null, canEdit = false, settings = {}, showFinance = false } = opts;
  if (showFinance) {
    // Drawer redesign scope excludes finance fields.
  }
  if (mode === 'summary') {
    const rows = Array.isArray(row) ? row : [];
    const body = rows.map((item, idx) => `<details class="ds-activity-accordion" ${idx === 0 ? 'open' : ''}>
      <summary class="ds-activity-accordion__summary">
        <span class="ds-activity-accordion__name">${escapeHtml(fallback(item.activity_name))}</span>
        <span class="ds-activity-accordion__meta">${escapeHtml(`${visibleActivityCategoryLabel(item.activity_type)} · ${fallback(item.school)}`)}</span>
        <span class="ds-activity-accordion__chevron">›</span>
      </summary>
      <div class="ds-activity-accordion__body">${blockActivity(item, {
        settings,
        privateNote,
        canEdit,
        showPrivateNote: privateNote !== null,
        idx
      })}</div>
    </details>`).join('');
    return `${headerHtml(rows, { mode: 'summary', summaryDate })}<div class="ds-stack">${body || '<p class="ds-muted">אין נתונים</p>'}</div>`;
  }

  const one = row || {};
  return `${headerHtml(one, { mode: 'single' })}${blockActivity(one, {
    settings,
    privateNote,
    canEdit,
    showPrivateNote: privateNote !== null,
    idx: 0
  })}`;
}
