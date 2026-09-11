import { escapeHtml } from './screens/shared/html.js';

export const AVIGDOR_SHARON_EMP_ID = 1519;
export const VETERAN_INTRO_DUE_DATE_2027 = '2026-10-20';
export const NOT_FOR_UPDATE_LABEL = 'לא לעדכון';
export const MISSING_SENIORITY_LABEL = 'לבדיקה';
export const LATE_LABEL = 'באיחור';
export const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

/** Fixed 2027 mid-year feedback window (Israel calendar dates). */
export const MIDYEAR_FEEDBACK_WINDOW_2027 = {
  start: '2027-01-15',
  due: '2027-02-04'
};

/** Fixed 2027 year-end feedback window (Israel calendar dates). */
export const YEAR_END_FEEDBACK_WINDOW_2027 = {
  start: '2027-05-01',
  due: '2027-05-30'
};

export const COMPONENT_COLUMNS = [
  { field: 'signed_agreement_completed', label: 'הסכם חתום' },
  { field: 'supporting_documents_completed', label: 'מסמכים נלווים' },
  { field: 'police_clearance_completed', label: 'אישור משטרה' },
  {
    field: 'intro_feedback_completed',
    label: 'משוב היכרות',
    deadline: {
      anchor: 'employee_created_at',
      due: 'intro_feedback_due_date',
      completedAt: 'intro_feedback_completed_at',
      anchorLabel: 'הקמת העובד'
    }
  },
  {
    field: 'midyear_feedback_completed',
    label: 'משוב אמצע שנה',
    feedbackWindow: {
      start: 'midyear_feedback_window_start',
      due: 'midyear_feedback_due_date',
      completedAt: 'midyear_feedback_completed_at',
      defaults2027: MIDYEAR_FEEDBACK_WINDOW_2027
    }
  },
  {
    field: 'year_end_feedback_completed',
    label: 'משוב סוף שנה',
    feedbackWindow: {
      start: 'year_end_feedback_window_start',
      due: 'year_end_feedback_due_date',
      completedAt: 'year_end_feedback_completed_at',
      defaults2027: YEAR_END_FEEDBACK_WINDOW_2027
    }
  },
  {
    field: 'observation_1_completed',
    label: 'תצפית 1',
    deadline: {
      anchor: 'first_activity_date',
      due: 'observation_1_due_date',
      completedAt: 'observation_1_completed_at',
      anchorLabel: 'פעילות ראשונה'
    }
  },
  {
    field: 'observation_2_completed',
    label: 'תצפית 2',
    feedbackWindow: {
      start: 'observation_2_window_start',
      due: 'observation_2_due_date',
      completedAt: 'observation_2_completed_at'
    }
  }
];

const AVIGDOR_EXEMPT_FIELDS = new Set([
  'signed_agreement_completed',
  'supporting_documents_completed',
  'intro_feedback_completed',
  'midyear_feedback_completed',
  'year_end_feedback_completed',
  'observation_1_completed',
  'observation_2_completed'
]);

export function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function isFemale(row) {
  return text(row?.gender).toLowerCase() === 'female';
}

export function isAvigdorSharon(row) {
  const empId = Number(row?.emp_id);
  return Number.isFinite(empId) && empId === AVIGDOR_SHARON_EMP_ID;
}

export function hasSeniorityYearsField(row) {
  return row != null && Object.prototype.hasOwnProperty.call(row, 'seniority_years');
}

export function normalizeSeniorityYears(value) {
  if (value == null || text(value) === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

/** Intro / opening-year classification (legacy): new includes seniority_years <= 1. */
export function isVeteranEmployee(seniorityYears) {
  const years = normalizeSeniorityYears(seniorityYears);
  return years != null && years > 1;
}

export function isNewEmployee(seniorityYears) {
  const years = normalizeSeniorityYears(seniorityYears);
  return years != null && years <= 1;
}

/** Observation rules: new is exactly seniority_years = 1 (not <= 1). */
export function isObservationNewInstructor(seniorityYears) {
  return normalizeSeniorityYears(seniorityYears) === 1;
}

export function isObservationVeteranInstructor(seniorityYears) {
  const years = normalizeSeniorityYears(seniorityYears);
  return years != null && years > 1;
}

export function hasValidObservationSeniority(seniorityYears) {
  return isObservationNewInstructor(seniorityYears) || isObservationVeteranInstructor(seniorityYears);
}

export function dateOnly(value) {
  return text(value).slice(0, 10);
}

export function formatDate(value) {
  const iso = dateOnly(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(2)}` : '';
}

/** Compact Israel-facing date without leading zeros (e.g. 15.1.27). */
export function formatFeedbackWindowDate(value) {
  const iso = dateOnly(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${Number(match[3])}.${Number(match[2])}.${match[1].slice(2)}`;
}

/** Current calendar date (YYYY-MM-DD) in Asia/Jerusalem. */
export function israelTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now instanceof Date ? now : new Date(now));
}

/**
 * Calendar date in Asia/Jerusalem for a timestamptz / ISO value.
 * Plain YYYY-MM-DD values are treated as already date-only (no TZ shift).
 */
export function israelDateOnly(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = dateOnly(raw);
    return /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : null;
  }
  return israelTodayIso(parsed);
}

function addOneCalendarMonth(isoDate) {
  const match = dateOnly(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonthIndex = monthIndex + 1;
  const lastDay = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clippedDay = Math.min(day, lastDay);
  return new Date(Date.UTC(year, targetMonthIndex, clippedDay)).toISOString().slice(0, 10);
}

/** Add whole calendar days to a YYYY-MM-DD date (UTC date arithmetic, no TZ drift). */
export function addCalendarDays(isoDate, days) {
  const match = dateOnly(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isFinite(days)) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(Date.UTC(year, monthIndex, day + Number(days))).toISOString().slice(0, 10);
}

/** Calendar month + N calendar days (never a fixed day-count substitute for the month). */
export function addOneCalendarMonthPlusDays(isoDate, days) {
  const monthLater = addOneCalendarMonth(isoDate);
  if (!monthLater) return null;
  return addCalendarDays(monthLater, days);
}

/**
 * Mirrors get_manager_team_roster intro_feedback_due_date rules for school_year=2027.
 * Source of truth for new/veteran classification is contacts_instructors.seniority_years.
 */
export function resolveIntroFeedbackDueDate(row, schoolYear = '2027') {
  const years = normalizeSeniorityYears(row?.seniority_years);
  if (years == null) return null;

  const year = text(schoolYear) || '2027';
  if (year === '2027') {
    if (years > 1) return VETERAN_INTRO_DUE_DATE_2027;
    return addOneCalendarMonth(row?.employee_created_at);
  }

  return addOneCalendarMonth(row?.employee_created_at);
}

/**
 * Observation 1 due date by seniority.
 * new (=1): first_activity + 1 month + 7 days
 * veteran (>1): first_activity + 1 month + 15 days
 */
export function resolveObservation1DueDate(row) {
  if (!hasValidObservationSeniority(row?.seniority_years)) return null;
  const firstActivity = dateOnly(row?.first_activity_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstActivity)) return null;

  if (isObservationNewInstructor(row?.seniority_years)) {
    return addOneCalendarMonthPlusDays(firstActivity, 7);
  }
  return addOneCalendarMonthPlusDays(firstActivity, 15);
}

/**
 * Observation 2 window for new instructors only.
 * window_start = observation_1_completed_at + 1 month + 7 days
 * window_end   = window_start + 13 days (14 inclusive days)
 */
export function resolveObservation2Window(row) {
  if (!isObservationNewInstructor(row?.seniority_years)) {
    return { start: null, due: null };
  }

  const rpcStart = dateOnly(row?.observation_2_window_start);
  const rpcDue = dateOnly(row?.observation_2_due_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(rpcStart) && /^\d{4}-\d{2}-\d{2}$/.test(rpcDue)) {
    return { start: rpcStart, due: rpcDue };
  }

  const completedOn = israelDateOnly(row?.observation_1_completed_at);
  if (!completedOn) return { start: null, due: null };

  const start = addOneCalendarMonthPlusDays(completedOn, 7);
  if (!start) return { start: null, due: null };
  const due = addCalendarDays(start, 13);
  return { start, due: due || null };
}

export function introCallAriaLabel(row) {
  if (isVeteranEmployee(row?.seniority_years)) return 'שיחת פתיחת שנה';
  if (isNewEmployee(row?.seniority_years)) return 'שיחת היכרות';
  return 'משוב היכרות';
}

export function resolveFeedbackWindow(row, column, schoolYear = '2027') {
  if (column?.field === 'observation_2_completed') {
    return resolveObservation2Window(row);
  }

  const window = column?.feedbackWindow;
  if (!window) return { start: null, due: null };

  const year = text(schoolYear) || '2027';
  const start = dateOnly(row?.[window.start])
    || (year === '2027' ? dateOnly(window.defaults2027?.start) : '');
  const due = dateOnly(row?.[window.due])
    || (year === '2027' ? dateOnly(window.defaults2027?.due) : '');

  return {
    start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null,
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null
  };
}

/**
 * Valid feedback / observation_2 completion requires a reliable completed_at on/after window open.
 * Early documents (before window start) never count as a valid ✓.
 * Missing completed_at never invents a timestamp and never counts as valid.
 * For observation_2, completed_at is latest_file_created_at so a later valid upload can qualify.
 */
export function isValidFeedbackCompletion(row, column, schoolYear = '2027') {
  const window = column?.feedbackWindow;
  if (!window) return row?.[column?.field] === true;

  const { start } = resolveFeedbackWindow(row, column, schoolYear);
  if (!start) return false;

  const present = row?.[column.field] === true;
  if (!present) return false;

  const completedOn = israelDateOnly(row?.[window.completedAt]);
  if (!completedOn) return false;
  return completedOn >= start;
}

/**
 * Periodic feedback cell state for mid-year / year-end / observation_2 windows.
 * Returns { kind: 'done'|'before'|'open'|'late'|'empty'|'review', label, aria }.
 */
export function resolvePeriodicFeedbackState(row, column, options = {}) {
  const schoolYear = text(options.schoolYear) || '2027';
  const todayIso = dateOnly(options.todayIso) || israelTodayIso(options.now || new Date());
  const { start, due } = resolveFeedbackWindow(row, column, schoolYear);

  if (isValidFeedbackCompletion(row, column, schoolYear)) {
    return { kind: 'done', label: '✓', aria: 'בוצע' };
  }

  if (column?.field === 'observation_2_completed') {
    const obs1Completed = row?.observation_1_completed === true;
    const obs1At = israelDateOnly(row?.observation_1_completed_at);
    if (obs1Completed && !obs1At) {
      return { kind: 'review', label: MISSING_SENIORITY_LABEL, aria: 'אין חותמת השלמה אמינה לתצפית 1' };
    }
  }

  if (!start || !due) {
    return { kind: 'empty', label: '—', aria: 'אין חלון ביצוע' };
  }

  if (todayIso < start) {
    const label = `מ־${formatFeedbackWindowDate(start)}`;
    return { kind: 'before', label, aria: `טרם נפתח ${label}` };
  }

  if (todayIso <= due) {
    const label = `עד ${formatFeedbackWindowDate(due)}`;
    return { kind: 'open', label, aria: `לביצוע ${label}` };
  }

  return { kind: 'late', label: LATE_LABEL, aria: LATE_LABEL };
}

function notForUpdateCell(label) {
  return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--not-for-update" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${escapeHtml(NOT_FOR_UPDATE_LABEL)}"><span class="manager-workspace-followup-cell__content manager-workspace-followup-cell__content--muted">${escapeHtml(NOT_FOR_UPDATE_LABEL)}</span></td>`;
}

function reviewCell(label, aria = 'אין נתון ותק') {
  return `<td class="manager-workspace-followup-cell" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${escapeHtml(aria)}"><span class="manager-workspace-followup-cell__content"><span class="manager-workspace-deadline-review">${escapeHtml(MISSING_SENIORITY_LABEL)}</span></span></td>`;
}

function introDueDateForDisplay(row) {
  // After the roster RPC exposes seniority_years, never invent a due date without it.
  // Before that migration, fall back to the RPC-provided due date.
  if (hasSeniorityYearsField(row)) {
    return resolveIntroFeedbackDueDate(row);
  }
  return dateOnly(row?.intro_feedback_due_date) || null;
}

function observation1DueDateForDisplay(row) {
  if (hasSeniorityYearsField(row)) {
    return resolveObservation1DueDate(row) || dateOnly(row?.observation_1_due_date) || null;
  }
  return dateOnly(row?.observation_1_due_date) || null;
}

function deadlineDisplayHtml(row, column, options = {}) {
  const deadline = column?.deadline;
  if (!deadline) return '';

  if (column.field === 'intro_feedback_completed') {
    if (hasSeniorityYearsField(row) && normalizeSeniorityYears(row.seniority_years) == null) {
      return `<span class="manager-workspace-deadline-review" aria-label="אין נתון ותק">${escapeHtml(MISSING_SENIORITY_LABEL)}</span>`;
    }
    const due = formatDate(introDueDateForDisplay(row));
    return due
      ? `<span class="manager-workspace-deadline-date">עד ${escapeHtml(due)}</span>`
      : '<span class="manager-workspace-deadline-empty" aria-label="אין תאריך יעד">—</span>';
  }

  if (column.field === 'observation_1_completed') {
    const dueIso = observation1DueDateForDisplay(row);
    if (!dueIso) {
      return '<span class="manager-workspace-deadline-empty" aria-label="אין תאריך יעד">—</span>';
    }
    const todayIso = dateOnly(options.todayIso) || israelTodayIso(options.now || new Date());
    if (todayIso > dueIso) {
      return `<span class="manager-workspace-deadline-date manager-workspace-deadline-date--late">${escapeHtml(LATE_LABEL)}</span>`;
    }
    const due = formatDate(dueIso);
    return due
      ? `<span class="manager-workspace-deadline-date">${escapeHtml(due)}</span>`
      : '<span class="manager-workspace-deadline-empty" aria-label="אין תאריך יעד">—</span>';
  }

  const due = formatDate(row?.[deadline.due]);
  return due
    ? `<span class="manager-workspace-deadline-date">עד ${escapeHtml(due)}</span>`
    : '<span class="manager-workspace-deadline-empty" aria-label="אין תאריך יעד">—</span>';
}

function feedbackWindowDisplayHtml(state) {
  if (state.kind === 'done') {
    return '<span aria-hidden="true">✓</span>';
  }
  if (state.kind === 'empty') {
    return '<span class="manager-workspace-deadline-empty" aria-label="אין חלון ביצוע">—</span>';
  }
  if (state.kind === 'review') {
    return `<span class="manager-workspace-deadline-review">${escapeHtml(state.label)}</span>`;
  }
  if (state.kind === 'late') {
    return `<span class="manager-workspace-deadline-date manager-workspace-deadline-date--late">${escapeHtml(state.label)}</span>`;
  }
  return `<span class="manager-workspace-deadline-date">${escapeHtml(state.label)}</span>`;
}

export function completionCell(row, column, options = {}) {
  const { field, label, deadline, feedbackWindow } = column;

  if (isAvigdorSharon(row) && AVIGDOR_EXEMPT_FIELDS.has(field)) {
    return notForUpdateCell(label);
  }

  if (field === 'police_clearance_completed' && isFemale(row)) {
    return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--blocked" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: לא רלוונטי"></td>`;
  }

  if (
    (field === 'observation_1_completed' || field === 'observation_2_completed')
    && hasSeniorityYearsField(row)
    && !hasValidObservationSeniority(row.seniority_years)
  ) {
    return reviewCell(label);
  }

  if (field === 'observation_2_completed' && isObservationVeteranInstructor(row?.seniority_years)) {
    return notForUpdateCell(label);
  }

  if (feedbackWindow) {
    const state = resolvePeriodicFeedbackState(row, column, options);
    const done = state.kind === 'done';
    return `<td class="manager-workspace-followup-cell${done ? ' is-done' : ''}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${escapeHtml(state.aria)}"><span class="manager-workspace-followup-cell__content">${feedbackWindowDisplayHtml(state)}</span></td>`;
  }

  const completed = row?.[field] === true;
  const dueIso = field === 'intro_feedback_completed'
    ? introDueDateForDisplay(row)
    : field === 'observation_1_completed'
      ? observation1DueDateForDisplay(row)
      : (deadline ? dateOnly(row?.[deadline.due]) : '');
  const due = formatDate(dueIso);
  const display = completed ? '<span aria-hidden="true">✓</span>' : deadlineDisplayHtml(row, column, options);
  const callLabel = field === 'intro_feedback_completed' ? introCallAriaLabel(row) : label;
  let stateLabel = 'חסר';
  if (completed) {
    stateLabel = 'בוצע';
  } else if (
    field === 'intro_feedback_completed'
    && hasSeniorityYearsField(row)
    && normalizeSeniorityYears(row.seniority_years) == null
  ) {
    stateLabel = 'אין נתון ותק';
  } else if (
    field === 'observation_1_completed'
    && dueIso
    && (dateOnly(options.todayIso) || israelTodayIso(options.now || new Date())) > dueIso
  ) {
    stateLabel = LATE_LABEL;
  } else if (due) {
    stateLabel = field === 'observation_1_completed' ? `יעד ${due}` : `לביצוע עד ${due}`;
  } else if (deadline) {
    stateLabel = 'אין תאריך יעד';
  }

  return `<td class="manager-workspace-followup-cell${completed ? ' is-done' : ''}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(callLabel)}: ${escapeHtml(stateLabel)}"><span class="manager-workspace-followup-cell__content">${display}</span></td>`;
}

export function tableHtml(rows, options = {}) {
  if (!rows.length) {
    return '<div class="manager-workspace-empty">אין מדריכים פעילים המשויכים למנהל.</div>';
  }

  const body = rows.map((row) => {
    const empId = text(row.emp_id);
    const folder = text(row.folder_web_url);
    const cells = COMPONENT_COLUMNS.map((column) => completionCell(row, column, options)).join('');

    return `<tr data-manager-tracking-emp-id="${escapeHtml(empId)}">
      <td class="manager-workspace-person"><strong>${escapeHtml(text(row.full_name) || empId)}</strong><small>${escapeHtml(text(row.employment_type))}</small></td>
      ${cells}
      <td data-label="תיק עובד">${folder ? `<a class="manager-workspace-folder-link" href="${escapeHtml(folder)}" target="_blank" rel="noopener">פתח תיק</a>` : '<span class="manager-workspace-status is-muted">טרם קושר</span>'}</td>
    </tr>`;
  }).join('');

  return `<div class="manager-workspace-table-wrap"><table class="manager-workspace-table manager-workspace-tracking-table manager-workspace-tracking-table--employee-file">
    <thead><tr><th>מדריך</th>${COMPONENT_COLUMNS.map(({ label }) => `<th>${escapeHtml(label)}</th>`).join('')}<th>תיק עובד</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}
