import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { showToast } from './shared/toast.js';

const SHEET_ROLES = [
  { key: 'sheet_activities', label: 'פעילויות', hint: 'טבלת מקור יחידה: activities' }
];

export const adminSettingsScreen = {
  load: ({ api }) => Promise.all([
    api.adminSettings(),
    api.listSheets()
  ]).then(([settings, sheets]) => ({ settings, sheets })),

  render(data) {
    const settings = data?.settings || {};
    const sheetsData = data?.sheets || {};
    const rows = Array.isArray(settings?.rows) ? settings.rows : [];
    const availableSheets = Array.isArray(sheetsData?.sheets) ? sheetsData.sheets : [];
    const sheetRoles = sheetsData?.sheet_roles || {};

    const rowsHtml = rows.length === 0
      ? dsEmptyState('אין הגדרות מערכת')
      : `
        <div class="ds-table-wrap">
          <table class="ds-table">
            <thead>
              <tr>
                <th>מפתח</th>
                <th>ערך</th>
                <th>תיאור</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td><code>${escapeHtml(r.key)}</code></td>
                  <td>${escapeHtml(r.value || '—')}</td>
                  <td class="ds-muted">${escapeHtml(r.description || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

    const sheetMappingBody = availableSheets.length === 0
      ? dsEmptyState('לא נמצאו לשוניות')
      : `
        <div style="display: flex; flex-direction: column; gap: var(--space-4, 16px);">
          ${SHEET_ROLES.map((role) => {
            const currentValue = sheetRoles[role.key] || '';
            return `
              <div style="display: flex; flex-direction: column; gap: var(--space-1, 4px);">
                <label style="font-weight: 500;" for="sheet-role-${escapeHtml(role.key)}">${escapeHtml(role.label)}</label>
                <p class="ds-muted" style="margin: 0; font-size: var(--font-size-sm, 0.875rem);">${escapeHtml(role.hint)}</p>
                <div style="display: flex; align-items: center; gap: var(--space-2, 8px); flex-wrap: wrap; margin-top: var(--space-1, 4px);">
                  <select id="sheet-role-${escapeHtml(role.key)}" data-role="${escapeHtml(role.key)}" class="ds-input ds-sheet-role-select" style="min-width: 180px;">
                    ${availableSheets.map((s) =>
                      `<option value="${escapeHtml(s.name)}"${s.name === currentValue ? ' selected' : ''}>${escapeHtml(s.name)}</option>`
                    ).join('')}
                  </select>
                  <button type="button" class="ds-btn ds-btn--primary ds-sheet-role-save" data-role="${escapeHtml(role.key)}">שמור</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

    return dsScreenStack(`
      ${dsPageHeader('הגדרות מערכת', `${rows.length} הגדרות`)}
      ${dsCard({ title: 'מיפוי לשוניות גיליון', padded: true, body: sheetMappingBody })}
      ${dsCard({ title: 'הגדרות', padded: false, body: rowsHtml })}
    `);
  },

  bind({ root, api, rerender, clearScreenDataCache }) {
    root.querySelectorAll('.ds-sheet-role-save').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const role = btn.dataset.role;
        const select = root.querySelector(`.ds-sheet-role-select[data-role="${CSS.escape(role)}"]`);
        const sheetName = select?.value;
        if (!role || !sheetName) return;

        btn.disabled = true;
        try {
          await api.saveSheetMapping({ role, sheet_name: sheetName });
          clearScreenDataCache?.();
          showToast('הלשונית עודכנה בהצלחה');
          rerender?.();
        } catch (err) {
          showToast(err.message || 'שגיאה בשמירה', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
};
