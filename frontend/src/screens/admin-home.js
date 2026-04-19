import { escapeHtml } from './shared/html.js';
import { hebrewRole } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsKpiGrid,
  dsStatusChip,
  dsEmptyState
} from './shared/layout.js';

function buildControlCard({ title, value, subtitle, kind = 'neutral', action }) {
  const chipHtml = kind !== 'neutral' ? dsStatusChip(String(value), kind) : '';
  const bigVal = chipHtml ? '' : `<p class="ds-admin-ctrl-value">${escapeHtml(String(value))}</p>`;
  const subHtml = subtitle ? `<p class="ds-admin-ctrl-sub">${escapeHtml(subtitle)}</p>` : '';
  const actionAttr = action ? ` data-admin-nav="${escapeHtml(action)}"` : '';
  return `<div class="ds-admin-ctrl-card${action ? ' ds-admin-ctrl-card--link' : ''}"${actionAttr}>
    <p class="ds-admin-ctrl-title">${escapeHtml(title)}</p>
    ${bigVal}
    ${chipHtml}
    ${subHtml}
  </div>`;
}

export const adminHomeScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state } = {}) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const activeCount = safeRows.filter((r) => String(r.active || '').toLowerCase() === 'yes').length;
    const inactiveCount = safeRows.length - activeCount;
    const adminCount = safeRows.filter((r) => r.display_role === 'admin').length;
    const reviewerCount = safeRows.filter((r) => r.display_role === 'operations_reviewer').length;
    const instructorCount = safeRows.filter((r) => r.display_role === 'instructor').length;
    const authorizedCount = safeRows.filter((r) => r.display_role === 'authorized_user').length;

    const kpis = [
      { label: 'סה"כ משתמשים', value: String(safeRows.length) },
      { label: 'פעילים', value: String(activeCount) },
      { label: 'לא פעילים', value: String(inactiveCount) },
      { label: 'מנהלים', value: String(adminCount) }
    ];

    const roleBreakdownRows = [
      { role: 'admin', label: 'מנהל/ת', count: adminCount },
      { role: 'operations_reviewer', label: 'בקר/ת תפעול', count: reviewerCount },
      { role: 'authorized_user', label: 'משתמש/ת מורשה', count: authorizedCount },
      { role: 'instructor', label: 'מדריך/ה', count: instructorCount }
    ].filter((r) => r.count > 0);

    const roleTable = roleBreakdownRows.length === 0 ? dsEmptyState('אין נתוני משתמשים') :
      `<table class="ds-table" style="max-width:420px;">
        <thead><tr><th>תפקיד</th><th style="text-align:center;">כמות</th></tr></thead>
        <tbody>
          ${roleBreakdownRows.map((r) => `<tr>
            <td>${escapeHtml(r.label)}</td>
            <td style="text-align:center;">${r.count}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    const ctrlGrid = `<div class="ds-admin-ctrl-grid">
      ${buildControlCard({ title: 'משתמשים והרשאות', value: safeRows.length, subtitle: `${activeCount} פעילים`, action: 'permissions' })}
      ${buildControlCard({ title: 'הגדרות מערכת', value: '→', subtitle: 'ניהול הגדרות', action: 'admin-settings' })}
      ${buildControlCard({ title: 'רשימות', value: '→', subtitle: 'ניהול רשימות', action: 'admin-lists' })}
      ${buildControlCard({ title: 'כספים', value: '→', subtitle: 'מסך כספים', action: 'finance' })}
    </div>`;

    const recentInactive = safeRows
      .filter((r) => String(r.active || '').toLowerCase() !== 'yes')
      .slice(0, 5);

    const inactiveSection = recentInactive.length === 0 ? '' : dsCard({
      title: 'משתמשים לא פעילים',
      badge: `${inactiveCount}`,
      body: `<div class="ds-perm-stack" dir="rtl" style="padding:var(--ds-space-3);">${recentInactive.map((r) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--ds-border);">
          <span style="font-weight:600;font-size:0.9rem;">${escapeHtml(r.full_name || r.user_id)}</span>
          ${dsStatusChip(hebrewRole(r.display_role), 'neutral')}
        </div>`).join('')}
      </div>`,
      padded: false
    });

    return dsScreenStack(`
      ${dsPageHeader('בית — ניהול', 'לוח בקרה למנהלי מערכת')}
      ${dsKpiGrid(kpis)}
      ${dsCard({ title: 'ניווט מהיר', body: ctrlGrid, padded: true })}
      ${dsCard({ title: 'התפלגות תפקידים', body: roleTable, padded: true })}
      ${inactiveSection}
    `);
  },
  bind({ root, state }) {
    root.querySelectorAll('[data-admin-nav]').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.dataset.adminNav;
        if (target && state.routes?.includes(target)) {
          state.route = target;
          window.dispatchEvent(new CustomEvent('ds:navigate', { detail: { route: target } }));
          document.querySelector(`[data-route="${target}"]`)?.click();
        }
      });
    });
  }
};
