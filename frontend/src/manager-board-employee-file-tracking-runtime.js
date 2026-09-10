import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const COMPONENT_COLUMNS = [
  { field: 'signed_agreement_completed', label: 'הסכם חתום' },
  { field: 'supporting_documents_completed', label: 'מסמכים נלווים' },
  { field: 'police_clearance_completed', label: 'אישור משטרה' },
  { field: 'intro_feedback_completed', label: 'משוב היכרות', deadline: { anchor: 'employee_created_at', due: 'intro_feedback_due_date', completedAt: 'intro_feedback_completed_at', anchorLabel: 'הקמת העובד' } },
  { field: 'midyear_feedback_completed', label: 'משוב אמצע שנה' },
  { field: 'year_end_feedback_completed', label: 'משוב סוף שנה' },
  { field: 'observation_1_completed', label: 'תצפית 1', deadline: { anchor: 'first_activity_date', due: 'observation_1_due_date', completedAt: 'observation_1_completed_at', anchorLabel: 'פעילות ראשונה' } },
  { field: 'observation_2_completed', label: 'תצפית 2', deadline: { anchor: 'observation_1_completed_at', due: 'observation_2_due_date', completedAt: 'observation_2_completed_at', anchorLabel: 'ביצוע תצפית 1' } }
];

let renderSequence = 0;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function isFemale(row) {
  return text(row?.gender).toLowerCase() === 'female';
}

function managerFromPanel(panel) {
  const boardRoot = panel?.closest('[data-manager-board-root]');
  const select = boardRoot?.querySelector('[data-manager-board-manager]');
  if (select?.value) return text(select.value);
  const fixed = boardRoot?.querySelector('.manager-board-manager-fixed strong');
  return text(fixed?.textContent);
}

function schoolYearFromPanel(panel) {
  const canonical = text(panel?.closest('[data-manager-board-root]')?.dataset?.managerBoardSchoolYear);
  if (/^20\d{2}$/.test(canonical)) return canonical;
  const heading = text(panel?.querySelector('.manager-workspace-panel__head p')?.textContent);
  return heading.match(/שנת\s+(20\d{2})/)?.[1] || '2027';
}

function dateOnly(value) {
  return text(value).slice(0, 10);
}

function formatDate(value) {
  const iso = dateOnly(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(2)}` : '';
}

function deadlineDisplayHtml(row, deadline) {
  if (!deadline) return '';
  const due = formatDate(row?.[deadline.due]);
  return due
    ? `<span class="manager-workspace-deadline-date">עד ${escapeHtml(due)}</span>`
    : '<span class="manager-workspace-deadline-empty" aria-label="אין תאריך יעד">—</span>';
}

function completionCell(row, column) {
  const { field, label, deadline } = column;
  if (field === 'police_clearance_completed' && isFemale(row)) {
    return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--blocked" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: לא רלוונטי"></td>`;
  }
  const completed = row?.[field] === true;
  const due = deadline ? formatDate(row?.[deadline.due]) : '';
  const display = completed ? '<span aria-hidden="true">✓</span>' : deadlineDisplayHtml(row, deadline);
  const stateLabel = completed ? 'בוצע' : due ? `לביצוע עד ${due}` : deadline ? 'אין תאריך יעד' : 'חסר';
  return `<td class="manager-workspace-followup-cell${completed ? ' is-done' : ''}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${escapeHtml(stateLabel)}"><span class="manager-workspace-followup-cell__content">${display}</span></td>`;
}

function tableHtml(rows, schoolYear) {
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
  </table></div><p class="manager-workspace-source-note">תצוגה לקריאה בלבד של תיק העובד לשנת ${escapeHtml(schoolYear)}. החיווי במשוב היכרות ובתצפיות מחושב אוטומטית לפי מועדי היעד. דוחות שכר אינם מוצגים כאן.</p>`;
}

function installStyles() {
  if (document.getElementById('manager-tracking-employee-file-source-styles')) return;
  const style = document.createElement('style');
  style.id = 'manager-tracking-employee-file-source-styles';
  style.textContent = `
    .manager-workspace-tracking-table--employee-file{min-width:1180px}
    .manager-workspace-tracking-table--employee-file th:not(:first-child),
    .manager-workspace-tracking-table--employee-file td:not(:first-child){text-align:center}
    .manager-workspace-followup-cell__content{display:inline-flex;align-items:center;justify-content:center;min-height:28px}
    .manager-workspace-deadline-date{color:#475569;font-size:12px;font-weight:700;white-space:nowrap}
    .manager-workspace-deadline-empty{color:#94a3b8;font-size:13px}
  `;
  document.head.appendChild(style);
}

async function replaceTrackingProjection(panel) {
  if (!panel || !panel.isConnected || !panel.classList.contains('manager-workspace-tracking')) return;
  const manager = managerFromPanel(panel);
  const schoolYear = schoolYearFromPanel(panel);
  if (!manager || !supabase) return;

  const contextKey = `${manager}|${schoolYear}`;
  const sameContext = panel.dataset.employeeFileTrackingContext === contextKey;
  const state = panel.dataset.employeeFileTrackingReady;
  if (sameContext && (state === 'loading' || state === 'true')) return;

  panel.dataset.employeeFileTrackingContext = contextKey;
  panel.dataset.employeeFileTrackingReady = 'loading';
  const sequence = ++renderSequence;

  try {
    await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
    const { data, error } = await supabase.rpc('get_manager_team_roster', {
      p_manager_name: manager,
      p_school_year: schoolYear
    });
    if (error) throw new Error(error.message || 'טעינת מעקב הצוות נכשלה.');
    if (!panel.isConnected || sequence !== renderSequence) return;

    const currentContext = `${managerFromPanel(panel)}|${schoolYearFromPanel(panel)}`;
    if (currentContext !== contextKey) return;

    const header = panel.querySelector('.manager-workspace-panel__head');
    panel.innerHTML = `${header?.outerHTML || ''}${tableHtml(Array.isArray(data) ? data : [], schoolYear)}`;
    panel.dataset.employeeFileTrackingContext = contextKey;
    panel.dataset.employeeFileTrackingReady = 'true';
  } catch (error) {
    if (!panel.isConnected || sequence !== renderSequence) return;
    panel.dataset.employeeFileTrackingReady = 'error';
    const existing = panel.querySelector('.manager-workspace-source-note');
    if (existing) existing.textContent = `לא ניתן היה לרענן את תיקי העובד: ${String(error?.message || '')}`;
    console.error('[manager-tracking] employee-file projection failed', error);
  }
}

function refreshVisibleTracking() {
  const panel = document.querySelector('.manager-workspace-panel.manager-workspace-tracking');
  if (panel) void replaceTrackingProjection(panel);
}

installStyles();

const observer = new MutationObserver(() => refreshVisibleTracking());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('change', (event) => {
  if (event.target instanceof Element && event.target.matches('[data-manager-board-manager]')) queueMicrotask(refreshVisibleTracking);
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-manager-workspace-tab="tracking"]')) {
    const panel = document.querySelector('.manager-workspace-panel.manager-workspace-tracking');
    if (panel) panel.dataset.employeeFileTrackingReady = '';
    queueMicrotask(refreshVisibleTracking);
  }
});

document.addEventListener('manager-board:tracking-invalidate', () => {
  const panel = document.querySelector('.manager-workspace-panel.manager-workspace-tracking');
  if (panel) panel.dataset.employeeFileTrackingReady = '';
  queueMicrotask(refreshVisibleTracking);
});

refreshVisibleTracking();
