import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const COMPONENT_COLUMNS = [
  ['signed_agreement_completed', 'הסכם חתום'],
  ['supporting_documents_completed', 'מסמכים נלווים'],
  ['police_clearance_completed', 'אישור משטרה'],
  ['intro_feedback_completed', 'משוב היכרות'],
  ['midyear_feedback_completed', 'משוב אמצע שנה'],
  ['year_end_feedback_completed', 'משוב סוף שנה'],
  ['observation_1_completed', 'תצפית 1'],
  ['observation_2_completed', 'תצפית 2']
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
  const heading = text(panel?.querySelector('.manager-workspace-panel__head p')?.textContent);
  return heading.match(/שנת\s+(20\d{2})/)?.[1] || '2027';
}

function completionCell(row, field, label) {
  if (field === 'police_clearance_completed' && isFemale(row)) {
    return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--blocked" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: לא רלוונטי"></td>`;
  }
  const completed = row?.[field] === true;
  return `<td class="manager-workspace-followup-cell${completed ? ' is-done' : ''}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${completed ? 'קיים' : 'חסר'}">${completed ? '<span aria-hidden="true">✓</span>' : ''}</td>`;
}

function tableHtml(rows, schoolYear) {
  if (!rows.length) {
    return '<div class="manager-workspace-empty">אין מדריכים פעילים המשויכים למנהל.</div>';
  }

  const body = rows.map((row) => {
    const empId = text(row.emp_id);
    const folder = text(row.folder_web_url);
    const cells = COMPONENT_COLUMNS
      .map(([field, label]) => completionCell(row, field, label))
      .join('');

    return `<tr data-manager-tracking-emp-id="${escapeHtml(empId)}">
      <td class="manager-workspace-person"><strong>${escapeHtml(text(row.full_name) || empId)}</strong><small>${escapeHtml(text(row.employment_type))}</small></td>
      ${cells}
      <td data-label="תיק עובד">${folder ? `<a class="manager-workspace-folder-link" href="${escapeHtml(folder)}" target="_blank" rel="noopener">פתח תיק</a>` : '<span class="manager-workspace-status is-muted">טרם קושר</span>'}</td>
    </tr>`;
  }).join('');

  return `<div class="manager-workspace-table-wrap"><table class="manager-workspace-table manager-workspace-tracking-table manager-workspace-tracking-table--employee-file">
    <thead><tr><th>מדריך</th>${COMPONENT_COLUMNS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}<th>תיק עובד</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div><p class="manager-workspace-source-note">תצוגה לקריאה בלבד של תיק העובד לשנת ${escapeHtml(schoolYear)}. הנתונים מתעדכנים מעמוד מדריכים / תיק עובד בלבד. דוחות שכר אינם מוצגים כאן.</p>`;
}

function installStyles() {
  if (document.getElementById('manager-tracking-employee-file-source-styles')) return;
  const style = document.createElement('style');
  style.id = 'manager-tracking-employee-file-source-styles';
  style.textContent = `
    .manager-workspace-tracking-table--employee-file{min-width:1180px}
    .manager-workspace-tracking-table--employee-file th:not(:first-child),
    .manager-workspace-tracking-table--employee-file td:not(:first-child){text-align:center}
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
    if (existing) {
      existing.textContent = `לא ניתן היה לרענן את תיקי העובד: ${String(error?.message || '')}`;
    }
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
  if (event.target instanceof Element && event.target.matches('[data-manager-board-manager]')) {
    queueMicrotask(refreshVisibleTracking);
  }
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-manager-workspace-tab="tracking"]')) {
    queueMicrotask(refreshVisibleTracking);
  }
});

refreshVisibleTracking();
