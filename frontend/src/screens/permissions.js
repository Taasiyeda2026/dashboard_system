import { api } from '../api.js';

export function permissionsScreen(data, canEdit) {
  const safeRows = Array.isArray(data?.rows) ? data.rows : [];
  const body = safeRows.map((row) => {
    const roleDisplay = canEdit
      ? `<select data-role-select data-user-id="${row.user_id}">
          <option value="admin" ${row.role === 'admin' ? 'selected' : ''}>admin</option>
          <option value="operations_reviewer" ${row.role === 'operations_reviewer' ? 'selected' : ''}>operations_reviewer</option>
          <option value="authorized_user" ${row.role === 'authorized_user' ? 'selected' : ''}>authorized_user</option>
          <option value="instructor" ${row.role === 'instructor' ? 'selected' : ''}>instructor</option>
        </select>`
      : row.role;

    const activeDisplay = canEdit
      ? `<label><input type="checkbox" data-active-toggle data-user-id="${row.user_id}" ${row.active === 'yes' ? 'checked' : ''} /> active</label>`
      : row.active;

    const saveButton = canEdit
      ? `<button class="btn" data-save-permission data-user-id="${row.user_id}" data-name="${row.name}" data-entry-code="${row.entry_code || ''}" data-instructor-id="${row.instructor_id || ''}">Save</button>`
      : '';

    return `<tr><td>${row.user_id}</td><td>${row.name}</td><td>${roleDisplay}</td><td>${activeDisplay}</td><td>${saveButton}</td></tr>`;
  }).join('') || '<tr><td colspan="5">No permission rows found.</td></tr>';

  return `
    <section class="stack">
      <h2>Permissions</h2>
      <article class="card overflow-x">
        <table>
          <thead><tr><th>user_id</th><th>name</th><th>role</th><th>active</th><th>actions</th></tr></thead>
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
    const role = document.querySelector(`[data-role-select][data-user-id="${userId}"]`)?.value;
    const active = document.querySelector(`[data-active-toggle][data-user-id="${userId}"]`)?.checked ? 'yes' : 'no';
    const status = document.getElementById('permissions-status');

    try {
      await api.savePermission({
        permission: {
          user_id: userId,
          name: button.dataset.name,
          entry_code: button.dataset.entryCode,
          instructor_id: button.dataset.instructorId,
          role,
          active
        }
      });
      if (status) status.textContent = `Saved ${userId}`;
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  }));
}
