import { escapeHtml } from '../screens/shared/html.js';
import { hubIcon } from '../screens/shared/process-icons.js';
import { notificationTarget } from './target.js';
const eventLabels = { current_pending: 'משימה ממתינה לטיפולך', submitted: 'דוח הוגש לבדיקה', resubmitted: 'דוח הוגש מחדש', returned: 'הוחזר לתיקון', approved: 'אושר', sent_to_payment: 'הועבר לתשלום', awaiting_signature: 'הצעה ממתינה לחתימתך', employee_submitted: 'חודש נוכחות הוגש', manager_approved: 'ממתין לאישור סופי', admin_approved: 'אושר — נדרשת העברה לשכר', dispatched_to_payroll: 'הועבר לטיפול טוני נעים', reopened: 'חודש נפתח לתיקון' };
const taskLabels = { review: 'ממתין לבדיקה', employee: 'תיקון והגשה מחדש', sign: 'ממתינה לחתימתך', responsible: 'המשך טיפול בהצעה', manager_review: 'ממתין לאישור מנהל', final_review: 'ממתין לאישור סופי', dispatch: 'מוכן להעברה לשכר' };
const domainLabels = { personal_report: 'דוח אישי', attendance: 'נוכחות', proposal: 'הצעת מחיר' };
export function notificationRowsHtml(rows, { tasks = false, historical = false } = {}) {
  return rows.map(row => {
    const title = row.subject_label || domainLabels[row.domain] || 'עדכון';
    const month = row.month_key && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month_key)
      ? new Date(`${row.month_key}-15T12:00:00Z`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }) : '';
    const state = tasks ? (historical ? 'הטיפול הסתיים' : taskLabels[row.stage] || 'משימה ממתינה') : eventLabels[row.event_type] || 'עדכון בתהליך';
    return `<article data-task="${tasks}" data-completed="${historical || (!tasks && ['approved','manager_approved','admin_approved','dispatched_to_payroll','sent_to_payment'].includes(row.event_type))}" class="ds-notification${historical ? ' is-historical' : ''}${!tasks && !row.read_at ? ' is-unread' : ''}">
      <span class="ds-notification-icon">${hubIcon(row.domain === 'attendance' ? 'attendance' : row.domain === 'proposal' ? 'transaction' : 'file')}</span>
      <div class="ds-notification-text"><strong>${escapeHtml(title)}${month ? ` — ${escapeHtml(month)}` : ''}</strong><span>${escapeHtml(state)}</span></div>
      <time datetime="${escapeHtml(row.created_at)}">${escapeHtml(new Date(row.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }))}</time>
      <div class="ds-notification-actions"><button type="button" class="ds-btn ds-btn--sm" data-notification-open="${escapeHtml(row.id)}" data-notification-kind="${tasks ? 'task' : 'message'}">פתיחה</button>
      ${!tasks && !row.read_at ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-notification-read="${escapeHtml(row.id)}">סימון כנקרא</button>` : ''}</div>
    </article>`;
  }).join('');
}
export function bindNotificationInbox({ root, service, state, refreshCounts, openAttendance }) {
  const host = root.querySelector('[data-notification-inbox]'); if (!host) return;
  const uid = state?.user?.auth_user_id;
  let messages = [], tasks = [], history = [], closedTasks = [], moreMessages = false, moreTasks = false;
  let chosenTab = false, sequence = 0, historySequence = 0;
  let issues = [];
  const active = () => host.isConnected && state?.user?.auth_user_id === uid;
  const controller = new AbortController();
  root.__notificationInboxAbort?.abort(); root.__notificationInboxAbort = controller;
  const selectTab = tab => {
    for (const button of host.querySelectorAll('[data-notification-tab]')) {
      const selected = button.dataset.notificationTab === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of host.querySelectorAll('[data-notification-panel]')) panel.hidden = panel.dataset.notificationPanel !== tab;
  };
  const filters = () => Object.fromEntries([...host.querySelectorAll('[data-notification-filter]')].map(input => [input.dataset.notificationFilter, input.value]));
  const paint = () => {
    if (!active()) return;
    const incoming = Number(host.dataset.incomingCount) || 0;
    host.querySelector('[data-notification-issues]').innerHTML = issues.length ? '<div class="ds-notification-routing"><strong>נדרשת הגדרת שיוך</strong>'+issues.map(issue => '<p>'+escapeHtml(issue.subject_label || 'תהליך ללא גורם משויך')+' — לא הוגדר נמען מתאים להמשך הטיפול.</p>').join('')+'</div>' : '';
    host.querySelector('[data-notification-tasks]').innerHTML = notificationRowsHtml(tasks, { tasks: true });
    host.querySelector('[data-notification-updates]').innerHTML = notificationRowsHtml(messages) || '<p class="ds-notification-empty">אין עדכונים להצגה.</p>';
    host.querySelector('[data-notification-empty]').hidden = tasks.length + incoming > 0;
    host.querySelector('[data-notification-task-count]').textContent = String(tasks.length + incoming);
    host.querySelector('[data-notification-unread-count]').textContent = String(state.notificationUnreadCount || 0);
    if (!chosenTab) selectTab(tasks.length + incoming > 0 ? 'pending' : 'updates');
  };
  const withDetails = async rows => {
    if (!rows.length) return rows;
    const details = await service.details(rows);
    return rows.map(row => ({ ...row, ...details[row.id] }));
  };
  const load = async () => {
    const version = ++sequence;
    try {
      const [page, pending] = await Promise.all([service.page(), service.tasks()]);
      const [nextMessages, nextTasks] = await Promise.all([withDetails(page.rows), withDetails(pending)]);
      if (!active() || version !== sequence) return;
      messages = nextMessages; tasks = nextTasks; paint();
      if (state.user?.role === 'admin' && service.issues) {
        const pendingIssues = await service.issues();
        if (active() && version === sequence) { issues = pendingIssues; paint(); }
      }
    } catch {
      if (active() && !messages.length) host.querySelector('[data-notification-updates]').innerHTML = '<p class="ds-notification-empty">העדכונים אינם זמינים כרגע.</p>';
    }
  };
  const loadHistory = async (more = false) => {
    const version = ++historySequence;
    const filter = filters();
    const legacy = host.querySelector('[data-notification-legacy-history]');
    if (legacy) {
      legacy.hidden = !!filter.domain && filter.domain !== 'edit_request';
      for (const group of legacy.querySelectorAll('[data-requested-date]')) {
        const date = group.dataset.requestedDate.slice(0, 10);
        group.hidden = !!((filter.from && date < filter.from) || (filter.to && date > filter.to));
      }
    }
    try {
      const [page, closed] = filter.domain === 'edit_request' ? [{ rows: [], hasMore: false }, { rows: [], hasMore: false }] : await Promise.all([
        service.page({ before: more ? history.at(-1) : null, filters: filter }),
        service.closedTasks({ before: more ? closedTasks.at(-1) : null, filters: filter })
      ]);
      const [rows, completed] = await Promise.all([withDetails(page.rows), withDetails(closed.rows)]);
      if (!active() || version !== historySequence) return;
      history = more ? [...new Map([...history, ...rows].map(row => [row.id, row])).values()] : rows;
      closedTasks = more ? [...new Map([...closedTasks, ...completed].map(row => [row.id, row])).values()] : completed;
      moreMessages = page.hasMore; moreTasks = closed.hasMore;
      host.querySelector('[data-notification-history]').innerHTML =
        notificationRowsHtml(closedTasks, { tasks: true, historical: true }) + notificationRowsHtml(history, { historical: true }) +
        (moreMessages || moreTasks ? '<button class="ds-btn" type="button" data-notification-more>הודעות ומשימות קודמות</button>' : '') +
        (!history.length && !closedTasks.length && filter.domain !== 'edit_request' ? '<p class="ds-notification-empty">אין היסטוריה להצגה בטווח שנבחר.</p>' : '');
    } catch { if (active()) host.querySelector('[data-notification-history]').innerHTML = '<p>לא ניתן לטעון היסטוריה כרגע.</p>'; }
  };
  root.ownerDocument.addEventListener('app:notifications-changed', () => { if (active()) { void load(); } else controller.abort(); }, { signal: controller.signal });
  host.addEventListener('change', event => { if (event.target.matches('[data-notification-filter]')) void loadHistory(); }, { signal: controller.signal });
  host.addEventListener('keydown', event => {
    if (!event.target.matches('[data-notification-tab]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...host.querySelectorAll('[data-notification-tab]')];
    const index = buttons.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowLeft' ? 1 : 2)) % 3;
    buttons[next].click(); buttons[next].focus();
  }, { signal: controller.signal });
  host.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || !active()) return;
    const tab = button.dataset.notificationTab;
    if (tab) { chosenTab = true; selectTab(tab); if (tab === 'history') void loadHistory(); return; }
    if (button.hasAttribute('data-notification-more')) { void loadHistory(true); return; }
    const readId = button.dataset.notificationRead;
    if (readId) {
      button.disabled = true;
      try { if (await service.markRead(readId)) {
        for (const list of [messages, history]) for (const row of list) if (row.id === readId) row.read_at = new Date().toISOString();
        paint(); void refreshCounts(); if (history.length) void loadHistory();
      } } catch { button.disabled = false; } return;
    }
    const row = (button.dataset.notificationKind === 'task' ? [...tasks, ...closedTasks] : [...messages, ...history]).find(item => item.id === button.dataset.notificationOpen);
    const target = notificationTarget(row); if (!target) return;
    if (target.route === 'employee-attendance') {
      const url = new URL('./attendance/', window.location.href);
      url.searchParams.set('notification_month', target.monthKey);
      url.searchParams.set('notification_employee', target.employeeId);
      window.location.assign(url.href);
      return;
    }
    if (target.route === 'attendance-control') {
      try { openAttendance(state, target); } catch (error) { window.alert(error.message); } return;
    }
    root.ownerDocument.dispatchEvent(new CustomEvent('app:navigate', { detail: { ...target, notificationTarget: target, force: true } }));
  }, { signal: controller.signal });
  paint(); void load();
}
