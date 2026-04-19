import { escapeHtml } from './shared/html.js';
import { hebrewPermissionField, hebrewRole, translateApiErrorForUser, hebrewColumn } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState, dsStatusChip, dsKpiGrid } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

const KEY_PERM_FLAGS = [
  'can_add_activity',
  'can_edit_direct',
  'can_request_edit',
  'can_review_requests',
  'view_finance',
  'view_admin',
  'view_permissions'
];

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

function buildPermFlagGrid(row, keys) {
  const allFlags = keys.filter((k) => k.startsWith('view_') || k.startsWith('can_'));
  if (allFlags.length === 0) return '';

  const chips = allFlags.map((k) => {
    const active = String(row[k] || '').toLowerCase() === 'yes';
    const isKey = KEY_PERM_FLAGS.includes(k);
    return `<span class="ds-perm-flag ${active ? 'ds-perm-flag--on' : 'ds-perm-flag--off'} ${isKey && active ? 'ds-perm-flag--key' : ''}" title="${escapeHtml(hebrewPermissionField(k))}">
      ${active ? '✓' : '✗'} ${escapeHtml(hebrewPermissionField(k))}
    </span>`;
  }).join('');

  return `<div class="ds-perm-flag-grid">${chips}</div>`;
}

function buildAddUserDrawerHtml() {
  return `<div class="ds-perm-edit-form" dir="rtl">
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">פרטי משתמש חדש</p>
      <div class="ds-perm-field">
        <span class="ds-muted">מזהה משתמש</span>
        <input type="text" class="ds-input ds-input--sm" id="new-user-id" placeholder="user_id" />
      </div>
      <div class="ds-perm-field">
        <span class="ds-muted">שם מלא</span>
        <input type="text" class="ds-input ds-input--sm" id="new-full-name" placeholder="שם מלא" />
      </div>
      <div class="ds-perm-field">
        <span class="ds-muted">קוד כניסה</span>
        <input type="text" class="ds-input ds-input--sm" id="new-entry-code" placeholder="קוד כניסה" />
      </div>
      <div class="ds-perm-field">
        <span class="ds-muted">תפקיד</span>
        <select class="ds-input ds-input--sm" id="new-display-role">
          <option value="instructor">מדריך/ה</option>
          <option value="authorized_user">משתמש/ת מורשה</option>
          <option value="operations_reviewer">בקר/ת תפעול</option>
          <option value="admin">מנהל/ת</option>
        </select>
      </div>
    </div>
    <div class="ds-perm-actions">
      <button type="button" class="ds-btn ds-btn--primary" data-add-user-submit>הוספה</button>
      <p class="ds-perm-save-status ds-muted" role="status" aria-live="polite"></p>
    </div>
  </div>`;
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

  const viewFlags = keys.filter((k) => k.startsWith('view_'));
  const canFlags = keys.filter((k) => k.startsWith('can_'));

  function renderBoolGroup(flagKeys, groupTitle) {
    if (flagKeys.length === 0) return '';
    const fields = flagKeys.map((k) => {
      const checked = String(row[k] || '').toLowerCase() === 'yes';
      const fieldAttr = `data-perm-field="${escapeHtml(k)}" data-user-id="${uid}"`;
      return `<label class="ds-perm-check">
        <input type="checkbox" ${fieldAttr} ${checked ? 'checked' : ''} />
        ${escapeHtml(hebrewPermissionField(k))}
      </label>`;
    }).join('');
    return `<div class="ds-perm-bool-group">
      <p class="ds-perm-section-label ds-perm-section-label--sub">${escapeHtml(groupTitle)}</p>
      <div class="ds-perm-bool-grid">${fields}</div>
    </div>`;
  }

  return `<div class="ds-perm-edit-form" dir="rtl">
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">פרטי משתמש</p>
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
          <input type="checkbox" data-active-toggle data-user-id="${uid}" ${String(row.active || '').toLowerCase() === 'yes' ? 'checked' : ''} />
          פעיל/ה
        </label>
      </div>
      ${textFields}
    </div>
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">הרשאות גישה</p>
      ${renderBoolGroup(viewFlags, 'צפייה במסכים')}
      ${renderBoolGroup(canFlags, 'פעולות מותרות')}
    </div>
    <div class="ds-perm-actions">
      <button type="button" class="ds-btn ds-btn--primary" data-save-permission data-user-id="${uid}">שמירה</button>
      <p class="ds-perm-save-status ds-muted" role="status" aria-live="polite"></p>
    </div>
  </div>`;
}

function renderUserBlock(row, canEdit, isAdmin, currentUserId) {
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
  const isActive = String(row.active || '').toLowerCase() === 'yes';

  const flagGrid = buildPermFlagGrid(row, keys);
  const editBtn = canEdit
    ? `<button type="button" class="ds-btn ds-btn--sm" data-edit-perm data-user-id="${uid}">עריכת הרשאות</button>`
    : '';
  const isSelf = String(row.user_id) === String(currentUserId);
  const deactivateBtn = isAdmin && isActive && !isSelf
    ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--danger" data-deactivate-user data-user-id="${uid}">השבת</button>`
    : '';

  const actionBtns = [editBtn, deactivateBtn].filter(Boolean).join('');

  return `<details class="ds-perm-card" data-perm-user="${uid}" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(roleKey)}">
    <summary>
      <span class="ds-perm-summary-name">${escapeHtml(row.full_name || uid)}</span>
      ${dsStatusChip(hebrewRole(row.display_role), roleChipKind(row.display_role))}
      ${dsStatusChip(activeLabel, activeKind)}
    </summary>
    <div class="ds-perm-body">
      <p class="ds-perm-uid ds-muted">${uid}</p>
      ${textFields}
      ${flagGrid}
      ${actionBtns ? `<div class="ds-perm-actions">${actionBtns}</div>` : ''}
    </div>
  </details>`;
}

export const permissionsScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state }) {
    const canEdit =
      state?.user?.display_role === 'admin' || state?.user?.display_role === 'operations_reviewer';
    const isAdmin = state?.user?.display_role === 'admin';
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const activeCount = safeRows.filter((r) => String(r.active || '').toLowerCase() === 'yes').length;
    const adminCount = safeRows.filter((r) => r.display_role === 'admin').length;
    const reviewerCount = safeRows.filter((r) => r.display_role === 'operations_reviewer').length;
    const authorizedCount = safeRows.filter((r) => r.display_role === 'authorized_user').length;
    const instructorCount = safeRows.filter((r) => r.display_role === 'instructor').length;

    const kpis = [
      { label: 'סה"כ משתמשים', value: String(safeRows.length) },
      { label: 'פעילים', value: String(activeCount) },
      { label: 'מנהלים', value: String(adminCount) },
      { label: 'בקרי תפעול', value: String(reviewerCount) },
      ...(authorizedCount > 0 ? [{ label: 'משתמשים מורשים', value: String(authorizedCount) }] : []),
      ...(instructorCount > 0 ? [{ label: 'מדריכים', value: String(instructorCount) }] : [])
    ];

    const body =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו שורות הרשאה')
        : `<div class="ds-perm-stack" dir="rtl">${safeRows.map((row) => renderUserBlock(row, canEdit, isAdmin, state?.user?.user_id)).join('')}</div>`;

    const roleFilters = [...new Set(safeRows.map((r) => String(r.display_role || '').trim()).filter(Boolean))].map((r) => ({
      value: r,
      label: hebrewRole(r)
    }));

    const addUserBtn = isAdmin
      ? `<div dir="rtl" style="margin-bottom:var(--space-3,12px)"><button type="button" class="ds-btn ds-btn--primary" data-add-user>הוסף משתמש</button></div>`
      : '';

    return dsScreenStack(`
      ${dsPageHeader('הרשאות', 'ניהול גישה ודגלי הרשאה — תואם לגיליון permissions')}
      ${safeRows.length ? dsKpiGrid(kpis) : ''}
      ${safeRows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש משתמש…', filterLabel: 'תפקיד', filters: roleFilters }) : ''}
      ${addUserBtn}
      ${dsCard({
        title: 'משתמשים והרשאות',
        badge: `${safeRows.length} משתמשים`,
        body,
        padded: safeRows.length === 0
      })}
    `);
  },
  bind({ root, data, api, ui, rerender, clearScreenDataCache }) {
    bindPageListTools(root);
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const addUserBtn = root.querySelector('[data-add-user]');
    if (addUserBtn && ui) {
      addUserBtn.addEventListener('click', () => {
        ui.openDrawer({
          title: 'הוסף משתמש חדש',
          content: buildAddUserDrawerHtml(),
          onOpen: (contentNode) => {
            const statusEl = contentNode.querySelector('.ds-perm-save-status');
            const submitBtn = contentNode.querySelector('[data-add-user-submit]');
            if (!submitBtn) return;

            submitBtn.addEventListener('click', async () => {
              const user_id = contentNode.querySelector('#new-user-id')?.value.trim();
              const full_name = contentNode.querySelector('#new-full-name')?.value.trim();
              const entry_code = contentNode.querySelector('#new-entry-code')?.value.trim();
              const display_role = contentNode.querySelector('#new-display-role')?.value;

              if (!user_id) {
                if (statusEl) statusEl.textContent = 'יש להזין מזהה משתמש';
                return;
              }

              submitBtn.classList.add('is-loading');
              if (statusEl) statusEl.textContent = '';
              try {
                await api.addUser({ user_id, full_name, entry_code, display_role });
                if (statusEl) statusEl.textContent = 'המשתמש נוצר בהצלחה';
                clearScreenDataCache?.();
                if (typeof rerender === 'function') await rerender();
              } catch (error) {
                if (statusEl) statusEl.textContent = translateApiErrorForUser(error?.message);
              } finally {
                submitBtn.classList.remove('is-loading');
              }
            });
          }
        });
      });
    }

    root.querySelectorAll('[data-deactivate-user]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        const name = row?.full_name || userId;
        if (!window.confirm(`האם להשבית את המשתמש/ת "${name}"?\nהמשתמש/ת לא יוכל/תוכל להתחבר למערכת לאחר מכן.`)) return;

        btn.classList.add('is-loading');
        btn.disabled = true;
        try {
          await api.deactivateUser(userId);
          clearScreenDataCache?.();
          if (typeof rerender === 'function') await rerender();
        } catch (error) {
          window.alert(translateApiErrorForUser(error?.message));
          btn.classList.remove('is-loading');
          btn.disabled = false;
        }
      });
    });

    root.querySelectorAll('[data-edit-perm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        if (!row || !ui) return;

        ui.openDrawer({
          title: `עריכת הרשאות — ${row.full_name || userId}`,
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
                clearScreenDataCache?.();
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
