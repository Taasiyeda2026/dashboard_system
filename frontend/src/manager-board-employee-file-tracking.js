import { escapeHtml } from './screens/shared/html.js';

export const AVIGDOR_SHARON_EMP_ID = 1519;
export const VETERAN_INTRO_DUE_DATE_2027 = '2026-10-20';
export const NOT_FOR_UPDATE_LABEL = 'לא לעדכון';
export const MISSING_SENIORITY_LABEL = 'לבדיקה';

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
  { field: 'midyear_feedback_completed', label: 'משוב אמצע שנה' },
  { field: 'year_end_feedback_completed', label: 'משוב סוף שנה' },
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
    deadline: {
      anchor: 'observation_1_completed_at',
      due: 'observation_2_due_date',
      completedAt: 'observation_2_completed_at',
      anchorLabel: 'ביצוע תצפית 1'
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

export function isVeteranEmployee(seniorityYears) {
  const years = normalizeSeniorityYears(seniorityYears);
  return years != null && years > 1;
}

export function isNewEmployee(seniorityYears) {
  const years = normalizeSeniorityYears(seniorityYears);
  return years != null && years <= 1;
}

export function dateOnly(value) {
  return text(value).slice(0, 10);
}

export function formatDate(value) {
  const iso = dateOnly(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(2)}` : '';
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

export function introCallAriaLabel(row) {
  if (isVeteranEmployee(row?.seniority_years)) return 'שיחת פתיחת שנה';
  if (isNewEmployee(row?.seniority_years)) return 'שיחת היכרות';
  return 'משוב היכרות';
}

function notForUpdateCell(label) {
  return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--not-for-update" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${escapeHtml(NOT_FOR_UPDATE_LABEL)}"><span class="manager-workspace-followup-cell__content manager-workspace-followup-cell__content--muted">${escapeHtml(NOT_FOR_UPDATE_LABEL)}</span></td>`;
}

function introDueDateForDisplay(row) {
  // After the roster RPC exposes seniority_years, never invent a due date without it.
  // Before that migration, fall back to the RPC-provided due date.
  if (hasSeniorityYearsField(row)) {
    return resolveIntroFeedbackDueDate(row);
  }
  return dateOnly(row?.intro_feedback_due_date) || null;
}

function deadlineDisplayHtml(row, column) {
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

  const due = formatDate(row?.[deadline.due]);
  return due
    ? `<span class="manager-workspace-deadline-date">עד ${escapeHtml(due)}</span>`
    : '<span class="manager-workspace-deadline-empty" aria-label="אין תאריך יעד">—</span>';
}

export function completionCell(row, column) {
  const { field, label, deadline } = column;

  if (isAvigdorSharon(row) && AVIGDOR_EXEMPT_FIELDS.has(field)) {
    return notForUpdateCell(label);
  }

  if (field === 'police_clearance_completed' && isFemale(row)) {
    return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--blocked" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: לא רלוונטי"></td>`;
  }

  const completed = row?.[field] === true;
  const dueIso = field === 'intro_feedback_completed'
    ? introDueDateForDisplay(row)
    : (deadline ? dateOnly(row?.[deadline.due]) : '');
  const due = formatDate(dueIso);
  const display = completed ? '<span aria-hidden="true">✓</span>' : deadlineDisplayHtml(row, column);
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
  } else if (due) {
    stateLabel = `לביצוע עד ${due}`;
  } else if (deadline) {
    stateLabel = 'אין תאריך יעד';
  }

  return `<td class="manager-workspace-followup-cell${completed ? ' is-done' : ''}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(callLabel)}: ${escapeHtml(stateLabel)}"><span class="manager-workspace-followup-cell__content">${display}</span></td>`;
}

export function tableHtml(rows) {
  if (!rows.length) {
    return '<div class="manager-workspace-empty">אין מדריכים פעילים המשויכים למנהל.</div>';
  }

  const body = rows.map((row) => {
    const empId = text(row.emp_id);
    const folder = text(row.folder_web_url);
    const cells = COMPONENT_COLUMNS.map((column) => completionCell(row, column)).join('');

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
