import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewRole } from './shared/ui-hebrew.js';

function hebrewYesNo(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'yes') return 'כן';
  if (v === 'no') return 'לא';
  return value || '—';
}

export const permissionsScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state }) {
    const canEdit =
      state?.user?.display_role === 'admin' || state?.user?.display_role === 'operations_reviewer';
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const body = safeRows.map((row) => {
      const roleDisplay = canEdit
        ? `<select data-role-select data-user-id="${escapeHtml(row.user_id)}">
            <option value="admin" ${row.display_role === 'admin' ? 'selected' : ''}>מנהל/ת</option>
            <option value="operations_reviewer" ${row.display_role === 'operations_reviewer' ? 'selected' : ''}>בקר/ת תפעול</option>
            <option value="authorized_user" ${row.display_role === 'authorized_user' ? 'selected' : ''}>משתמש/ת מורשה</option>
            <option value="instructor" ${row.display_role === 'instructor' ? 'selected' : ''}>מדריך/ה</option>
          </select>`
        : escapeHtml(hebrewRole(row.display_role));

      const activeDisplay = canEdit
        ? `<label class="perm-active-label"><input type="checkbox" data-active-toggle data-user-id="${escapeHtml(row.user_id)}" ${row.active === 'yes' ? 'checked' : ''} /> פעיל</label>`
        : escapeHtml(hebrewYesNo(row.active));

      const saveButton = canEdit
        ? `<button type="button" class="btn" data-save-permission data-user-id="${escapeHtml(row.user_id)}" data-full-name="${escapeHtml(row.full_name)}" data-entry-code="${escapeHtml(row.entry_code || '')}" data-default-view="${escapeHtml(row.default_view || '')}">שמירה</button>`
        : '';

      return `<tr><td>${escapeHtml(row.user_id)}</td><td>${escapeHtml(row.full_name)}</td><td>${roleDisplay}</td><td>${activeDisplay}</td><td>${saveButton}</td></tr>`;
    }).join('') || `<tr><td colspan="5">לא נמצאו שורות הרשאה</td></tr>`;

    return `
      <section class="stack">
        <h2>🔐 הרשאות</h2>
        <article class="card overflow-x">
          <table>
            <thead><tr><th>${hebrewColumn('user_id')}</th><th>${hebrewColumn('full_name')}</th><th>${hebrewColumn('display_role')}</th><th>${hebrewColumn('active')}</th><th>${hebrewColumn('actions')}</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </article>
        <p id="permissions-status" class="muted"></p>
      </section>
    `;
  },
  bind({ root, api, rerender }) {
    root.querySelectorAll('[data-save-permission]').forEach((button) =>
      button.addEventListener('click', async () => {
        const userId = button.dataset.userId;
        const display_role = root.querySelector(`[data-role-select][data-user-id="${userId}"]`)?.value;
        const active = root.querySelector(`[data-active-toggle][data-user-id="${userId}"]`)?.checked ? 'yes' : 'no';
        const status = root.querySelector('#permissions-status');

        try {
          await api.savePermission({
            user_id: userId,
            full_name: button.dataset.fullName,
            entry_code: button.dataset.entryCode,
            default_view: button.dataset.defaultView,
            display_role,
            active
          });
          if (status) status.textContent = `נשמר (${userId})`;
          if (typeof rerender === 'function') await rerender();
        } catch (error) {
          if (status) status.textContent = error.message;
        }
      })
    );
  }
};
