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
  const heading = text(panel?.querySelector('.manager-workspace-panel__head p')?.textContent);
  return heading.match(/שנת\s+(20\d{2})/)?.[1] || '2027';
}

function dateOnly(value) {
  return text(value).slice(0, 10);
}

function formatDate(value) {
  const iso = dateOnly(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function deadlineState(row, deadline, completed) {
  if (!deadline) return null;
  const due = dateOnly(row?.[deadline.due]);
  const anchor = dateOnly(row?.[deadline.anchor]);
  const completedAt = dateOnly(row?.[deadline.completedAt]);
  if (completed) return { tone: 'done', label: 'בוצע', due, anchor, completedAt };
  if (!due) return { tone: 'waiting', label: 'טרם התחיל', due: '', anchor, completedAt: '' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`);
  const days = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { tone: 'overdue', label: 'עבר המועד', due, anchor, completedAt: '' };
  if (days <= 7) return { tone: 'soon', label: `נותרו ${days} ימים`, due, anchor, completedAt: '' };
  return { tone: 'open', label: 'לביצוע', due, anchor, completedAt: '' };
}

function deadlineInfoHtml(row, deadline, completed, label) {
  if (!deadline) return '';
  const state = deadlineState(row, deadline, completed);
  const lines = [];
  if (state.anchor) lines.push(`<span><b>${escapeHtml(deadline.anchorLabel)}:</b> ${escapeHtml(formatDate(state.anchor))}</span>`);
  if (state.due) lines.push(`<span><b>מועד לביצוע:</b> ${escapeHtml(formatDate(state.due))}</span>`);
  if (state.completedAt) lines.push(`<span><b>בוצע:</b> ${escapeHtml(formatDate(state.completedAt))}</span>`);
  if (!state.due && !completed) {
    const waitingCopy = deadline.due === 'observation_1_due_date'
      ? 'המועד ייקבע לאחר הפעילות הראשונה.'
      : deadline.due === 'observation_2_due_date'
        ? 'המועד ייקבע לאחר ביצוע תצפית 1.'
        : 'טרם קיים מועד יעד.';
    lines.push(`<span>${escapeHtml(waitingCopy)}</span>`);
  }
  lines.push(`<span class="manager-workspace-deadline-popover__status"><b>סטטוס:</b> ${escapeHtml(state.label)}</span>`);

  const title = `${label}: ${state.label}${state.due ? ` · עד ${formatDate(state.due)}` : ''}`;
  return `<span class="manager-workspace-deadline manager-workspace-deadline--${escapeHtml(state.tone)}">
    <button type="button" class="manager-workspace-deadline-info" aria-label="מידע על מועד ${escapeHtml(label)}" aria-expanded="false" title="${escapeHtml(title)}">i</button>
    <span class="manager-workspace-deadline-popover" role="status" hidden>${lines.join('')}</span>
  </span>`;
}

function completionCell(row, column) {
  const { field, label, deadline } = column;
  if (field === 'police_clearance_completed' && isFemale(row)) {
    return `<td class="manager-workspace-followup-cell manager-workspace-followup-cell--blocked" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: לא רלוונטי"></td>`;
  }
  const completed = row?.[field] === true;
  const deadlineHtml = deadlineInfoHtml(row, deadline, completed, label);
  return `<td class="manager-workspace-followup-cell${completed ? ' is-done' : ''}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${completed ? 'קיים' : 'חסר'}"><span class="manager-workspace-followup-cell__content">${completed ? '<span aria-hidden="true">✓</span>' : ''}${deadlineHtml}</span></td>`;
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
    .manager-workspace-followup-cell__content{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px}
    .manager-workspace-deadline{position:relative;display:inline-flex;align-items:center;justify-content:center}
    .manager-workspace-deadline-info{width:18px;height:18px;padding:0;border:1px solid #94a3b8;border-radius:50%;background:#fff;color:#64748b;font:700 11px/16px inherit;cursor:pointer}
    .manager-workspace-deadline--soon .manager-workspace-deadline-info{border-color:#d97706;color:#b45309;background:#fffbeb}
    .manager-workspace-deadline--overdue .manager-workspace-deadline-info{border-color:#dc2626;color:#b91c1c;background:#fef2f2}
    .manager-workspace-deadline--done .manager-workspace-deadline-info{border-color:#16a34a;color:#15803d;background:#f0fdf4}
    .manager-workspace-deadline--waiting .manager-workspace-deadline-info{opacity:.55}
    .manager-workspace-deadline-popover{position:absolute;z-index:80;inset-block-start:calc(100% + 7px);inset-inline-start:50%;transform:translateX(50%);width:max-content;max-width:250px;padding:9px 11px;border:1px solid #d8e0ea;border-radius:9px;background:#fff;color:#334155;box-shadow:0 8px 24px rgba(15,23,42,.16);text-align:right;font-size:12.5px;line-height:1.55;white-space:normal}
    .manager-workspace-deadline-popover[hidden]{display:none!important}
    .manager-workspace-deadline-popover span{display:block}
    .manager-workspace-deadline-popover__status{margin-top:3px;padding-top:4px;border-top:1px solid #eef2f6}
  `;
  document.head.appendChild(style);
}

function closeDeadlinePopovers(except = null) {
  document.querySelectorAll('.manager-workspace-deadline-popover:not([hidden])').forEach((popover) => {
    if (popover === except) return;
    popover.hidden = true;
    popover.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
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
  if (target?.closest('[data-manager-workspace-tab="tracking"]')) queueMicrotask(refreshVisibleTracking);

  const info = target?.closest('.manager-workspace-deadline-info');
  if (info) {
    event.stopPropagation();
    const popover = info.nextElementSibling;
    const willOpen = !!popover?.hidden;
    closeDeadlinePopovers(popover);
    if (popover) popover.hidden = !willOpen;
    info.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    return;
  }
  closeDeadlinePopovers();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDeadlinePopovers();
});

refreshVisibleTracking();
