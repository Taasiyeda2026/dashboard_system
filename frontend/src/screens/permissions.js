import { escapeHtml } from './shared/html.js';

export function permissionsScreen(data, canEdit) {
  const safeRows = Array.isArray(data?.rows) ? data.rows : [];
  const body = safeRows.map((row) => {
    const roleDisplay = canEdit
      ? `<select data-role-select data-user-id="${row.user_id}">
          <option value="admin" ${row.display_role === 'admin' ? 'selected' : ''}>admin</option>
          <option value="operations_reviewer" ${row.display_role === 'operations_reviewer' ? 'selected' : ''}>operations_reviewer</option>
          <option value="authorized_user" ${row.display_role === 'authorized_user' ? 'selected' : ''}>authorized_user</option>
          <option value="instructor" ${row.display_role === 'instructor' ? 'selected' : ''}>instructor</option>
        </select>`
      : row.display_role;

    const activeDisplay = canEdit
      ? `<label><input type="checkbox" data-active-toggle data-user-id="${row.user_id}" ${row.active === 'yes' ? 'checked' : ''} /> active</label>`
      : row.active;

    const saveButton = canEdit
      ? `<button class="btn" data-save-permission data-user-id="${row.user_id}" data-full-name="${row.full_name}" data-entry-code="${row.entry_code || ''}" data-default-view="${row.default_view || ''}">Save</button>`
      : '';

    return `<tr><td>${row.user_id}</td><td>${row.full_name}</td><td>${roleDisplay}</td><td>${activeDisplay}</td><td>${saveButton}</td></tr>`;
  }).join('') || '<tr><td colspan="5">No permission rows found.</td></tr>';

  return `
    <section class="stack">
      <h2>Permissions</h2>
      <article class="card overflow-x">
        <table>
          <thead><tr><th>user_id</th><th>full_name</th><th>display_role</th><th>active</th><th>actions</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </article>
      <p id="permissions-status" class="muted"></p>
    </section>
  `;
}

export function bindPermissions() {
  document.querySelectorAll('[data-save-permission]').forEach((button) => button.addEventListener('click', async () => {
    const userId = button.dataset.userId;
    const display_role = document.querySelector(`[data-role-select][data-user-id="${userId}"]`)?.value;
    const active = document.querySelector(`[data-active-toggle][data-user-id="${userId}"]`)?.checked ? 'yes' : 'no';
    const status = document.getElementById('permissions-status');

    try {
      await api.savePermission({
        permission: {
          user_id: userId,
          full_name: button.dataset.fullName,
          entry_code: button.dataset.entryCode,
          default_view: button.dataset.defaultView,
          display_role,
          active
        }
      });
      if (status) status.textContent = `Saved ${userId}`;
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  }));
}
