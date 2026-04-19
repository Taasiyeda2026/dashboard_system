import { escapeHtml } from './shared/html.js';
import { hebrewPermissionField, hebrewRole, translateApiErrorForUser, hebrewColumn } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

function sortedPermissionEditorKeys(row) {
  const keys = Object.keys(row).filter((k) => {
    if (k === 'user_id' || k === 'display_role') return false;
    return (
      k === 'entry_code' ||
      k === 'full_name' ||
      k === 'display_role2' ||
      k === 'default_view' ||
      k.startsWith('view_') ||
      k.startsWith('can_')
    );
  });
  const rank = (k) => {
    if (k === 'entry_code') return 10;
    if (k === 'full_name') return 20;
    if (k === 'display_role2') return 30;
    if (k === 'default_view') return 40;
    if (k.startsWith('view_')) return 100;
    if (k.startsWith('can_')) return 200;
    return 300;
  };
  keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return keys;
}

function fieldEditorMarkup(row, key, canEdit) {
  const val = row[key] ?? '';
  const uid = escapeHtml(row.user_id);
  const fieldAttr = `data-perm-field="${escapeHtml(key)}" data-user-id="${uid}"`;
  if (!canEdit) {
    return `<span>${escapeHtml(String(val))}</span>`;
  }
  if (key.startsWith('view_') || key.startsWith('can_')) {
    const checked = String(val).toLowerCase() === 'yes';
    return `<label class="ds-perm-check"><input type="checkbox" ${fieldAttr} ${checked ? 'checked' : ''} /> ${escapeHtml(
      hebrewPermissionField(key)
    )}</label>`;
  }
  return `<input type="text" class="ds-input ds-input--sm" ${fieldAttr} value="${escapeHtml(String(val))}" />`;
}

function renderUserBlock(row, canEdit) {
  const keys = sortedPermissionEditorKeys(row);
  const uid = escapeHtml(row.user_id);
  const searchHay = [row.full_name, row.user_id, row.display_role, hebrewRole(row.display_role), row.display_role2]
    .filter(Boolean)
    .join(' ');
  const roleKey = String(row.display_role || '').trim();
  const grid = keys
    .map((k) => {
      if (k.startsWith('view_') || k.startsWith('can_')) {
        return `<div class="ds-perm-field">${fieldEditorMarkup(row, k, canEdit)}</div>`;
      }
      return `<div class="ds-perm-field"><span class="ds-muted">${escapeHtml(hebrewPermissionField(k))}</span><br />${fieldEditorMarkup(
        row,
        k,
        canEdit
      )}</div>`;
    })
    .join('');

  const roleDisplay = !canEdit
    ? escapeHtml(hebrewRole(row.display_role))
    : `<select data-role-select data-user-id="${uid}">
            <option value="admin" ${row.display_role === 'admin' ? 'selected' : ''}>מנהל/ת</option>
            <option value="operations_reviewer" ${row.display_role === 'operations_reviewer' ? 'selected' : ''}>בקר/ת תפעול</option>
            <option value="authorized_user" ${row.display_role === 'authorized_user' ? 'selected' : ''}>משתמש/ת מורשה</option>
            <option value="instructor" ${row.display_role === 'instructor' ? 'selected' : ''}>מדריך/ה</option>
          </select>`;

  const activeDisplay = !canEdit
    ? escapeHtml(String(row.active))
    : `<label><input type="checkbox" data-active-toggle data-user-id="${uid}" ${row.active === 'yes' ? 'checked' : ''} /> פעיל</label>`;

  const saveBtn = !canEdit
    ? ''
    : `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-save-permission data-user-id="${uid}">שמירה</button>`;

  return `<details class="ds-perm-card" data-perm-user="${uid}" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(roleKey)}">
    <summary>${escapeHtml(row.full_name || '')} <span class="ds-muted">(${uid})</span> · ${escapeHtml(hebrewRole(row.display_role))}</summary>
    <div class="ds-perm-body">
      <p><strong>${escapeHtml(hebrewColumn('display_role'))}:</strong> ${roleDisplay}</p>
      <p><strong>${escapeHtml(hebrewColumn('active'))}:</strong> ${activeDisplay}</p>
      <div class="ds-perm-grid">${grid}</div>
      <div style="margin-top:0.75rem">${saveBtn}</div>
    </div>
  </details>`;
}

export const permissionsScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state }) {
    const canEdit =
      state?.user?.display_role === 'admin' || state?.user?.display_role === 'operations_reviewer';
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const body =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו שורות הרשאה')
        : `<div class="ds-perm-stack" dir="rtl">${safeRows.map((row) => renderUserBlock(row, canEdit)).join('')}</div>`;

    const roleFilters = [...new Set(safeRows.map((r) => String(r.display_role || '').trim()).filter(Boolean))].map((r) => ({
      value: r,
      label: hebrewRole(r)
    }));

    return dsScreenStack(`
      ${dsPageHeader('הרשאות', 'ניהול גישה — תואם לגיליון permissions')}
      ${safeRows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש משתמש…', filterLabel: 'תפקיד', filters: roleFilters }) : ''}
      ${dsCard({
        title: 'משתמשים והרשאות',
        badge: `${safeRows.length} משתמשים`,
        body,
        padded: safeRows.length === 0
      })}
      <p id="permissions-status" class="ds-muted" role="status"></p>
    `);
  },
  bind({ root, api, rerender }) {
    bindPageListTools(root);
    root.querySelectorAll('[data-save-permission]').forEach((button) =>
      button.addEventListener('click', async () => {
        const userId = button.dataset.userId;
        const box = root.querySelector(`details[data-perm-user="${userId}"]`);
        if (!box) return;
        const status = root.querySelector('#permissions-status');
        const display_role = box?.querySelector(`[data-role-select][data-user-id="${userId}"]`)?.value;
        const active = box?.querySelector(`[data-active-toggle][data-user-id="${userId}"]`)?.checked ? 'yes' : 'no';

        const payload = {
          user_id: userId,
          display_role,
          active
        };

        box?.querySelectorAll('[data-perm-field]').forEach((el) => {
          const field = el.getAttribute('data-perm-field');
          if (!field) return;
          if (el.type === 'checkbox') payload[field] = el.checked ? 'yes' : 'no';
          else payload[field] = String(el.value || '').trim();
        });

        try {
          await api.savePermission(payload);
          if (status) status.textContent = `נשמר עבור ${userId}`;
          if (typeof rerender === 'function') await rerender();
        } catch (error) {
          if (status) status.textContent = translateApiErrorForUser(error?.message);
        }
      })
    );
  }
};
