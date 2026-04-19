import { escapeHtml } from './shared/html.js';
import { hebrewPermissionField, hebrewRole, translateApiErrorForUser, hebrewColumn } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';
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

function roleChipKind(role) {
  if (role === 'admin') return 'danger';
  if (role === 'operations_reviewer') return 'warning';
  return 'neutral';
}

function buildEditDrawerHtml(row) {
  const uid = escapeHtml(row.user_id);
  const keys = sortedPermissionEditorKeys(row);

  const textFields = keys
    .filter((k) => !k.startsWith('view_') && !k.startsWith('can_'))
    .map((k) => {
      const val = escapeHtml(String(row[k] ?? ''));
      const fieldAttr = `data-perm-field="${escapeHtml(k)}" data-user-id="${uid}"`;
      return `<div class="ds-perm-field">
        <span class="ds-muted">${escapeHtml(hebrewPermissionField(k))}</span>
        <input type="text" class="ds-input ds-input--sm" ${fieldAttr} value="${val}" />
      </div>`;
    })
    .join('');

  const boolFields = keys
    .filter((k) => k.startsWith('view_') || k.startsWith('can_'))
    .map((k) => {
      const checked = String(row[k] || '').toLowerCase() === 'yes';
      const fieldAttr = `data-perm-field="${escapeHtml(k)}" data-user-id="${uid}"`;
      return `<div class="ds-perm-field">
        <label class="ds-perm-check">
          <input type="checkbox" ${fieldAttr} ${checked ? 'checked' : ''} />
          ${escapeHtml(hebrewPermissionField(k))}
        </label>
      </div>`;
    })
    .join('');

  return `<div class="ds-perm-edit-form" dir="rtl">
    <div class="ds-perm-edit-section">
      <div class="ds-perm-field">
        <span class="ds-muted">${escapeHtml(hebrewColumn('display_role'))}</span>
        <select data-role-select data-user-id="${uid}" class="ds-input ds-input--sm">
          <option value="admin" ${row.display_role === 'admin' ? 'selected' : ''}>מנהל/ת</option>
          <option value="operations_reviewer" ${row.display_role === 'operations_reviewer' ? 'selected' : ''}>בקר/ת תפעול</option>
          <option value="authorized_user" ${row.display_role === 'authorized_user' ? 'selected' : ''}>משתמש/ת מורשה</option>
          <option value="instructor" ${row.display_role === 'instructor' ? 'selected' : ''}>מדריך/ה</option>
        </select>
      </div>
      <div class="ds-perm-field">
        <label class="ds-perm-check">
          <input type="checkbox" data-active-toggle data-user-id="${uid}" ${row.active === 'yes' ? 'checked' : ''} />
          פעיל/ה
        </label>
      </div>
      ${textFields}
    </div>
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">${escapeHtml('הרשאות גישה')}</p>
      <div class="ds-perm-bool-grid">${boolFields}</div>
    </div>
    <div class="ds-perm-actions">
      <button type="button" class="ds-btn ds-btn--primary" data-save-permission data-user-id="${uid}">שמירה</button>
      <p class="ds-perm-save-status ds-muted" role="status" aria-live="polite"></p>
    </div>
  </div>`;
}

function renderUserBlock(row, canEdit) {
  const uid = escapeHtml(row.user_id);
  const searchHay = [row.full_name, row.user_id, row.display_role, hebrewRole(row.display_role), row.display_role2]
    .filter(Boolean)
    .join(' ');
  const roleKey = String(row.display_role || '').trim();

  const keys = sortedPermissionEditorKeys(row);

  const textFields = keys
    .filter((k) => !k.startsWith('view_') && !k.startsWith('can_'))
    .map((k) => {
      const val = escapeHtml(String(row[k] ?? ''));
      return `<div class="ds-perm-field">
        <span class="ds-muted">${escapeHtml(hebrewPermissionField(k))}</span>
        <span>${val}</span>
      </div>`;
    })
    .join('');

  const activeLabel = String(row.active || '').toLowerCase() === 'yes' ? 'פעיל/ה' : 'לא פעיל/ה';
  const activeKind = String(row.active || '').toLowerCase() === 'yes' ? 'success' : 'neutral';

  const permChips = keys
    .filter((k) => k.startsWith('view_') || k.startsWith('can_'))
    .filter((k) => String(row[k] || '').toLowerCase() === 'yes')
    .map((k) => `<span class="ds-chip ds-chip--perm">${escapeHtml(hebrewPermissionField(k))}</span>`)
    .join('');

  const editBtn = canEdit
    ? `<button type="button" class="ds-btn ds-btn--sm" data-edit-perm data-user-id="${uid}">עריכה</button>`
    : '';

  return `<details class="ds-perm-card" data-perm-user="${uid}" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(roleKey)}">
    <summary>
      <span class="ds-perm-summary-name">${escapeHtml(row.full_name || uid)}</span>
      ${dsStatusChip(hebrewRole(row.display_role), roleChipKind(row.display_role))}
      ${dsStatusChip(activeLabel, activeKind)}
    </summary>
    <div class="ds-perm-body">
      <p class="ds-perm-uid ds-muted">${uid}</p>
      ${textFields}
      ${permChips ? `<div class="ds-perm-chips">${permChips}</div>` : ''}
      ${editBtn ? `<div class="ds-perm-actions">${editBtn}</div>` : ''}
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
    `);
  },
  bind({ root, data, api, ui, rerender }) {
    bindPageListTools(root);
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    root.querySelectorAll('[data-edit-perm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        if (!row || !ui) return;

        ui.openDrawer({
          title: `עריכת הרשאות — ${escapeHtml(row.full_name || userId)}`,
          content: buildEditDrawerHtml(row),
          onOpen: (contentNode) => {
            const statusEl = contentNode.querySelector('.ds-perm-save-status');
            const saveBtn = contentNode.querySelector('[data-save-permission]');
            if (!saveBtn) return;

            saveBtn.addEventListener('click', async () => {
              const display_role = contentNode.querySelector(`[data-role-select][data-user-id="${userId}"]`)?.value;
              const active = contentNode.querySelector(`[data-active-toggle][data-user-id="${userId}"]`)?.checked
                ? 'yes'
                : 'no';

              const payload = { user_id: userId, display_role, active };
              contentNode.querySelectorAll('[data-perm-field]').forEach((el) => {
                const field = el.getAttribute('data-perm-field');
                if (!field) return;
                if (el.type === 'checkbox') payload[field] = el.checked ? 'yes' : 'no';
                else payload[field] = String(el.value || '').trim();
              });

              saveBtn.classList.add('is-loading');
              if (statusEl) statusEl.textContent = '';
              try {
                await api.savePermission(payload);
                if (statusEl) statusEl.textContent = 'נשמר בהצלחה';
                if (typeof rerender === 'function') await rerender();
              } catch (error) {
                if (statusEl) statusEl.textContent = translateApiErrorForUser(error?.message);
              } finally {
                saveBtn.classList.remove('is-loading');
              }
            });
          }
        });
      });
    });
  }
};
