import { escapeHtml } from './shared/html.js';

export const permissionsScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state }) {
    const canEdit = ['admin', 'operations_reviewer'].includes(state.user.role);
    return `<section class="panel"><h2>Permissions</h2>${canEdit ? '<button class="small" id="addPermissionBtn">+ Add / Update User</button>' : ''}<div class="stack">${(data.rows || []).map((row) => `<article class="mini-card"><h4>${escapeHtml(row.name)} (${escapeHtml(row.role)})</h4><p>${escapeHtml(row.user_id)} | ${escapeHtml(row.entry_code)}</p><p>Active: ${escapeHtml(row.active)} | Instructor: ${escapeHtml(row.instructor_id)}</p></article>`).join('')}</div></section>`;
  },
  bind({ root, api, rerender }) {
    root.querySelector('#addPermissionBtn')?.addEventListener('click', async () => {
      const row = {
        user_id: prompt('user_id', ''),
        name: prompt('name', ''),
        role: prompt('role (admin|operations_reviewer|authorized_user|instructor)', 'authorized_user'),
        entry_code: prompt('entry_code', ''),
        instructor_id: prompt('instructor_id (for instructor role)', ''),
        active: prompt('active (yes|no)', 'yes')
      };
      try {
        await api.savePermission(row);
        await rerender();
      } catch (error) {
        alert(error.message);
      }
    });
  }
};
