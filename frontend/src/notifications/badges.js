import { escapeHtml } from '../screens/shared/html.js';
export function notificationBadgeHtml({ tasks = 0, unread = 0 } = {}) {
  const n = value => Math.max(0, Math.floor(Number(value) || 0));
  tasks=n(tasks); unread=n(unread);
  return (tasks || unread ? '<span class="ds-notification-dot" aria-label="יש משימות או עדכונים חדשים"></span>' : '')+
    (tasks ? `<span class="ds-notification-task-badge" title="משימות פתוחות" aria-label="${tasks} משימות ממתינות">${escapeHtml(String(tasks))}</span>` : '')+
    (unread ? `<span class="ds-notification-unread-badge" title="עדכונים שלא נקראו" aria-label="${unread} עדכונים שלא נקראו">${escapeHtml(String(unread))}</span>` : '');
}
export function approvalNavigationBadges({ incoming = 0, sent = 0, tasks = 0, unread = 0, legacyTotal = 0 } = {}) {
  const count = value => Math.max(0, Math.floor(Number(value) || 0));
  incoming=count(incoming);sent=count(sent);tasks=count(tasks);unread=count(unread);
  const pending=incoming+tasks || (!sent ? count(legacyTotal) : 0);
  return (pending || unread ? '<span class="ds-notification-dot" aria-label="יש משימות או עדכונים חדשים"></span>' : '')+
    (pending ? `<span class="ds-nav-count-badge ds-nav-count-badge--edit-requests ds-notification-task-badge" title="ממתינות לטיפולי" aria-label="${pending} משימות ממתינות לטיפולי, מתוכן ${incoming} בקשות עריכה">${pending}</span>` : '')+
    (unread ? `<span class="ds-notification-unread-badge" title="עדכונים שלא נקראו" aria-label="${unread} עדכונים שלא נקראו">${unread}</span>` : '')+
    (sent ? `<span class="ds-nav-count-badge ds-nav-count-badge--edit-requests-sent" title="שלחתי – ממתינות לתשובה" aria-label="${sent} בקשות ששלחתי וממתינות לתשובה">${sent}</span>` : '');
}
