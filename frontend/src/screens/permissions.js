import { escapeHtml } from './shared/html.js';
import { hebrewPermissionField, hebrewRole, translateApiErrorForUser, hebrewColumn } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState, dsStatusChip, dsKpiGrid } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { showConfirmModal } from './shared/interactions.js';

const KEY_PERM_FLAGS = [
  'can_add_activity',
  'can_edit_direct',
  'can_request_edit',
  'can_review_requests',
  'view_admin',
  'view_permissions'
];

const PERMISSION_ROLE_OPTIONS = [
  'admin',
  'operation_manager',
  'authorized_user',
  'instructor',
  'finance',
  'activities_manager',
  'domain_manager',
  'instructor_manager'
];

function renderRoleOptionsHtml(selectedRole = '') {
  const selected = String(selectedRole || '').trim();
  return PERMISSION_ROLE_OPTIONS.map((role) => {
    const attr = role === selected ? ' selected' : '';
    return `<option value="${escapeHtml(role)}"${attr}>${escapeHtml(hebrewRole(role))}</option>`;
  }).join('');
}

/** Normalized role code from API (`role`). */
function permRowRoleCode(row) {
  const code = String(row?.role != null && row.role !== '' ? row.role : row?.display_role || '').trim();
  return code;
}

/** Label from permissions sheet `display_role` column, or mapped Hebrew from code. */
function permRowRoleLabel(row) {
  const raw = String(row?.display_role || '').trim();
  const code = permRowRoleCode(row);
  if (raw && (!code || raw.toLowerCase() !== code.toLowerCase())) return raw;
  return hebrewRole(code);
}

/**
 * Renders the role-defaults preview snippet.
 * @param {string} role - e.g. 'authorized_user'
 * @param {Object|null} roleDefaults - server-computed roleDefaults map
 */
function buildRolePreviewHtml(role, roleDefaults) {
  if (role === 'admin') {
    return `<p class="ds-perm-section-label ds-perm-section-label--sub" style="margin-top:var(--space-2,8px)">ברירת מחדל: כל ההרשאות (מנהל/ת מערכת)</p>`;
  }
  const source = (roleDefaults && roleDefaults[role]) ? roleDefaults[role] : {};
  const grantedFlags = Object.keys(source).filter((f) => source[f] === 'yes');
  if (grantedFlags.length === 0) {
    return `<p class="ds-perm-section-label ds-perm-section-label--sub ds-muted" style="margin-top:var(--space-2,8px)">ברירת מחדל: ללא הרשאות</p>`;
  }
  const chips = grantedFlags.map((f) =>
    `<span class="ds-perm-flag ds-perm-flag--on" title="${escapeHtml(hebrewPermissionField(f))}">${escapeHtml(hebrewPermissionField(f))}</span>`
  ).join('');
  return `<div style="margin-top:var(--space-2,8px)">
    <p class="ds-perm-section-label ds-perm-section-label--sub">ברירת מחדל לתפקיד זה:</p>
    <div class="ds-perm-flag-grid" style="margin-top:var(--space-1,4px)">${chips}</div>
  </div>`;
}

function sortedPermissionEditorKeys(row) {
  const keys = Object.keys(row).filter((k) => {
    if (k === 'user_id' || k === 'role' || k === 'display_role') return false;
    if (k === 'view_finance') return false;
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
  if (role === 'operation_manager') return 'warning';
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


function resolveEmployeeNumber(row) {
  const source = row && typeof row === 'object' ? row : {};
  const preferredKeys = [
    'entry_code',
    'employee_number',
    'employeeNumber',
    'employee_id',
    'employeeId',
    'worker_number',
    'payroll_number',
    'payrollNumber',
    'ms',
    'id'
  ];

  for (const key of preferredKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '—';
}

function buildAddUserDrawerHtml(roleDefaults) {
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
          ${renderRoleOptionsHtml('instructor')}
        </select>
      </div>
      <div data-role-preview>${buildRolePreviewHtml('instructor', roleDefaults)}</div>
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
          ${renderRoleOptionsHtml(permRowRoleCode(row))}
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

function renderUserRow(row, canEdit, isAdmin, currentUserId, adminCount) {
  const uid = escapeHtml(row.user_id);
  const code = permRowRoleCode(row);
  const label = permRowRoleLabel(row);
  const searchHay = [row.full_name, row.user_id, code, label, row.display_role2].filter(Boolean).join(' ');
  const roleKey = code;
  const isActive = String(row.active || '').toLowerCase() === 'yes';
  const activeLabel = isActive ? 'פעיל/ה' : 'לא פעיל/ה';
  const activeKind = isActive ? 'success' : 'neutral';
  const isSelf = String(row.user_id) === String(currentUserId);

  const editBtn = canEdit
    ? `<button type="button" class="ds-btn ds-btn--sm" data-edit-perm data-user-id="${uid}" title="עריכת הרשאות">עריכה</button>`
    : '';
  const permissionsBtn = `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-view-perm data-user-id="${uid}" title="צפייה בהרשאות">הרשאות</button>`;
  const deactivateBtn = isAdmin && isActive && !isSelf
    ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--danger" data-deactivate-user data-user-id="${uid}">השבת</button>`
    : '';
  const reactivateBtn = isAdmin && !isActive
    ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--success" data-reactivate-user data-user-id="${uid}">הפעל</button>`
    : '';
  const isLastAdmin = adminCount === 1 && permRowRoleCode(row) === 'admin';
  const deleteBtn = isAdmin && !isActive
    ? isLastAdmin
      ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--danger" disabled title="לא ניתן למחוק את מנהל המערכת האחרון">מחק</button>`
      : `<button type="button" class="ds-btn ds-btn--sm ds-btn--danger" data-delete-user data-user-id="${uid}">מחק</button>`
    : '';

  const actionBtns = [editBtn, permissionsBtn, deactivateBtn, reactivateBtn, deleteBtn].filter(Boolean).join(' ');

  return `<tr class="ds-perm-row" data-perm-user="${uid}" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(roleKey)}" data-status-filter="${isActive ? 'yes' : 'no'}">
    <td style="font-weight:600;">${escapeHtml(row.full_name || uid)}</td>
    <td class="ds-muted" style="font-size:0.75rem;">${escapeHtml(resolveEmployeeNumber(row))}</td>
    <td>${dsStatusChip(label, roleChipKind(code))}</td>
    <td>${dsStatusChip(activeLabel, activeKind)}</td>
    <td><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${actionBtns}</div></td>
  </tr>`;
}

function buildPermissionsDetailsHtml(row) {
  const keys = sortedPermissionEditorKeys(row).filter((k) => k.startsWith('view_') || k.startsWith('can_'));
  const groups = [
    { label: 'לוח בקרה', keys: ['view_admin'] },
    { label: 'פעילויות', keys: ['view_activities', 'can_add_activity', 'can_edit_direct', 'can_request_edit', 'can_review_requests'] },
    { label: 'ארכיון', keys: ['view_archive'] },
    { label: 'הצעות', keys: ['view_offers'] },
    { label: 'אנשי קשר', keys: ['view_contacts'] },
    { label: 'אישורים', keys: ['view_approvals'] },
    { label: 'הרשאות', keys: ['view_permissions'] },
    { label: 'ניהול משתמשים', keys: ['view_user_management'] },
    { label: 'נתונים אישיים', keys: ['view_profile'] }
  ];

  const known = new Set(groups.flatMap((g) => g.keys));
  const extraKeys = keys.filter((k) => !known.has(k));
  if (extraKeys.length) groups.push({ label: 'הרשאות נוספות', keys: extraKeys });

  const sections = groups
    .map((group) => {
      const rows = group.keys
        .filter((k) => keys.includes(k))
        .map((k) => {
          const active = String(row[k] || '').toLowerCase() === 'yes';
          return `<div class="ds-perm-detail-item">
            <span>${escapeHtml(hebrewPermissionField(k))}</span>
            ${dsStatusChip(active ? 'מאופשר' : 'חסום', active ? 'success' : 'neutral')}
          </div>`;
        })
        .join('');
      if (!rows) return '';
      return `<section class="ds-perm-detail-section">
        <h4 class="ds-perm-detail-title">${group.label}</h4>
        <div class="ds-perm-detail-grid">${rows}</div>
      </section>`;
    })
    .filter(Boolean)
    .join('');

  return `<div class="ds-perm-details" dir="rtl">${sections || '<p class="ds-muted">לא נמצאו הרשאות להצגה.</p>'}</div>`;
}

export const permissionsScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state }) {
    const canEdit =
      state?.user?.display_role === 'admin' || state?.user?.display_role === 'operation_manager';
    const isAdmin = state?.user?.display_role === 'admin';
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const activeCount = safeRows.filter((r) => String(r.active || '').toLowerCase() === 'yes').length;
    const adminCount = safeRows.filter((r) => permRowRoleCode(r) === 'admin').length;
    const reviewerCount = safeRows.filter((r) => permRowRoleCode(r) === 'operation_manager').length;
    const authorizedCount = safeRows.filter((r) => permRowRoleCode(r) === 'authorized_user').length;
    const instructorCount = safeRows.filter((r) => permRowRoleCode(r) === 'instructor').length;

    const kpis = [
      { label: 'סה"כ משתמשים', value: String(safeRows.length) },
      { label: 'פעילים', value: String(activeCount) },
      { label: 'מנהלים', value: String(adminCount) },
      { label: 'בקרי תפעול', value: String(reviewerCount) },
      ...(authorizedCount > 0 ? [{ label: 'משתמשים מורשים', value: String(authorizedCount) }] : []),
      ...(instructorCount > 0 ? [{ label: 'מדריכים', value: String(instructorCount) }] : [])
    ];

    const rowPairs = safeRows.map((row) => renderUserRow(row, canEdit, isAdmin, state?.user?.user_id, adminCount)).join('');

    const body =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו שורות הרשאה')
        : `<div class="ds-table-wrap" dir="rtl"><table class="ds-table ds-perm-table">
            <thead><tr><th>שם</th><th>מספר עובד</th><th>תפקיד</th><th>סטטוס</th><th style="text-align:start;">פעולות</th></tr></thead>
            <tbody>${rowPairs}</tbody>
          </table></div>`;

    const roleFilters = [...new Set(safeRows.map((r) => permRowRoleCode(r)).filter(Boolean))].map((r) => ({
      value: r,
      label: hebrewRole(r)
    }));

    const statusFilters = [
      { value: 'yes', label: 'פעיל/ה' },
      { value: 'no', label: 'לא פעיל/ה' }
    ];

    const toolsBar = safeRows.length
      ? `<div class="ds-perm-tools" role="search" aria-label="חיפוש וסינון משתמשים">
          <input type="search" class="ds-input ds-input--sm ds-perm-tools__q" data-page-q placeholder="חיפוש משתמש…" aria-label="חיפוש משתמש" />
          <select class="ds-input ds-input--sm ds-perm-tools__select" data-page-role-filter aria-label="סינון לפי תפקיד">
            <option value="">כל התפקידים</option>
            ${roleFilters.map((f) => `<option value="${escapeHtml(String(f.value))}">${escapeHtml(f.label)}</option>`).join('')}
          </select>
          <select class="ds-input ds-input--sm ds-perm-tools__select" data-page-status-filter aria-label="סינון לפי סטטוס">
            <option value="">כל הסטטוסים</option>
            ${statusFilters.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
          </select>
          ${isAdmin ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-add-user>הוסף משתמש</button>' : ''}
        </div>`
      : '';

    return dsScreenStack(`
      <section class="ds-perm-screen">
        ${dsPageHeader('הרשאות', 'ניהול גישה ודגלי הרשאה — תואם לגיליון permissions')}
        ${safeRows.length ? dsKpiGrid(kpis) : ''}
        ${toolsBar}
        ${dsCard({
        title: 'משתמשים והרשאות',
        badge: `${safeRows.length} משתמשים`,
        body,
        padded: safeRows.length === 0
      })}
      </section>
    `);
  },
  bind({ root, data, api, ui, rerender, clearScreenDataCache }) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const searchInput = root.querySelector('[data-page-q]');
    const roleFilter = root.querySelector('[data-page-role-filter]');
    const statusFilter = root.querySelector('[data-page-status-filter]');
    const listRows = Array.from(root.querySelectorAll('[data-list-item]'));
    let searchTimer = null;
    const applyFilters = () => {
      const q = String(searchInput?.value || '').trim().toLowerCase();
      const role = String(roleFilter?.value || '').trim();
      const status = String(statusFilter?.value || '').trim();
      listRows.forEach((el) => {
        const hay = String(el.getAttribute('data-search') || '').toLowerCase();
        const rowRole = String(el.getAttribute('data-filter') || '').trim();
        const rowStatus = String(el.getAttribute('data-status-filter') || '').trim();
        const okQ = !q || hay.includes(q);
        const okRole = !role || rowRole === role;
        const okStatus = !status || rowStatus === status;
        el.toggleAttribute('hidden', !(okQ && okRole && okStatus));
      });
    };
    searchInput?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 120);
    });
    roleFilter?.addEventListener('change', applyFilters);
    statusFilter?.addEventListener('change', applyFilters);
    const addUserBtn = root.querySelector('[data-add-user]');
    if (addUserBtn && ui) {
      addUserBtn.addEventListener('click', () => {
        ui.openDrawer({
          title: 'הוסף משתמש חדש',
          content: buildAddUserDrawerHtml(data?.roleDefaults),
          onOpen: (contentNode) => {
            const statusEl = contentNode.querySelector('.ds-perm-save-status');
            const submitBtn = contentNode.querySelector('[data-add-user-submit]');
            const roleSelect = contentNode.querySelector('#new-display-role');
            const previewEl = contentNode.querySelector('[data-role-preview]');

            if (roleSelect && previewEl) {
              roleSelect.addEventListener('change', () => {
                previewEl.innerHTML = buildRolePreviewHtml(roleSelect.value, data?.roleDefaults);
              });
            }

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
                await api.addUser({ user_id, full_name, entry_code, role: display_role });
                if (statusEl) statusEl.textContent = 'המשתמש נוצר בהצלחה';
                clearScreenDataCache?.();
                if (typeof rerender === 'function') await rerender();
                try {
                  const freshData = await api.permissions();
                  const newRow = (freshData?.rows || []).find((r) => String(r.user_id) === String(user_id));
                  if (newRow) openEditModal(newRow);
                } catch (autoOpenErr) {
                  console.warn('[permissions] Could not auto-open edit drawer after user creation:', autoOpenErr);
                }
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
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        const name = row?.full_name || userId;
        showConfirmModal(ui, {
          title: 'השבתת משתמש/ת',
          message: `האם להשבית את המשתמש/ת "${name}"?\nהמשתמש/ת לא יוכל/תוכל להתחבר למערכת לאחר מכן.`,
          confirmLabel: 'השבת',
          confirmClass: 'ds-btn--danger',
          onConfirm: async () => {
            btn.classList.add('is-loading');
            btn.disabled = true;
            try {
              await api.deactivateUser(userId);
              clearScreenDataCache?.();
              if (typeof rerender === 'function') await rerender();
              showToast(`המשתמש/ת "${name}" הושבת/ה בהצלחה`, 'success');
            } catch (error) {
              showToast(translateApiErrorForUser(error?.message), 'error');
              btn.classList.remove('is-loading');
              btn.disabled = false;
            }
          }
        });
      });
    });

    root.querySelectorAll('[data-reactivate-user]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        const name = row?.full_name || userId;
        showConfirmModal(ui, {
          title: 'הפעלה מחדש של משתמש/ת',
          message: `האם להפעיל מחדש את המשתמש/ת "${name}"?`,
          confirmLabel: 'הפעל',
          confirmClass: 'ds-btn--success',
          onConfirm: async () => {
            btn.classList.add('is-loading');
            btn.disabled = true;
            try {
              await api.reactivateUser(userId);
              clearScreenDataCache?.();
              if (typeof rerender === 'function') await rerender();
              showToast(`המשתמש/ת "${name}" הופעל/ה מחדש בהצלחה`, 'success');
            } catch (error) {
              showToast(translateApiErrorForUser(error?.message), 'error');
              btn.classList.remove('is-loading');
              btn.disabled = false;
            }
          }
        });
      });
    });

    root.querySelectorAll('[data-delete-user]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        const name = row?.full_name || userId;
        const isTargetAdmin = permRowRoleCode(row) === 'admin';
        const adminWarning = isTargetAdmin ? '\n\n⚠️ שים לב: משתמש/ת זה/זו הוא/היא מנהל/ת המערכת!' : '';
        showConfirmModal(ui, {
          title: 'מחיקת משתמש/ת',
          message: `פעולה זו תמחק לצמיתות את המשתמש/ת "${name}" מגיליון ההרשאות.\nלא ניתן לבטל פעולה זו. להמשיך?${adminWarning}`,
          confirmLabel: 'מחק',
          confirmClass: 'ds-btn--danger',
          onConfirm: async () => {
            btn.classList.add('is-loading');
            btn.disabled = true;
            try {
              await api.deleteUser(userId);
              clearScreenDataCache?.();
              if (typeof rerender === 'function') await rerender();
            } catch (error) {
              showToast(translateApiErrorForUser(error?.message), 'error');
              btn.classList.remove('is-loading');
              btn.disabled = false;
            }
          }
        });
      });
    });

    function openEditModal(row) {
      if (!row || !ui) return;
      const userId = String(row.user_id);
      const contentHtml = buildEditDrawerHtml(row);
      ui.openModal({
        title: `עריכת הרשאות — ${row.full_name || userId}`,
        content: contentHtml,
        onClose: () => {}
      });
      /* Bind save inside modal after it opens */
      requestAnimationFrame(() => {
        const modalContent = document.querySelector('.ds-modal__content');
        if (!modalContent) return;
        const statusEl = modalContent.querySelector('.ds-perm-save-status');
        const saveBtn = modalContent.querySelector('[data-save-permission]');
        if (!saveBtn) return;

        saveBtn.addEventListener('click', async () => {
          const role = modalContent.querySelector(`[data-role-select][data-user-id="${userId}"]`)?.value;
          const active = modalContent.querySelector(`[data-active-toggle][data-user-id="${userId}"]`)?.checked
            ? 'yes'
            : 'no';

          const payload = { user_id: userId, role, active };
          modalContent.querySelectorAll('[data-perm-field]').forEach((el) => {
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
      });
    }

    root.querySelectorAll('[data-view-perm]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        if (!row || !ui) return;
        ui.openDrawer({
          title: `הרשאות משתמש — ${row.full_name || userId}` ,
          content: buildPermissionsDetailsHtml(row)
        });
      });
    });

    root.querySelectorAll('[data-edit-perm]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const row = safeRows.find((r) => String(r.user_id) === String(userId));
        openEditModal(row);
      });
    });
  }
};
