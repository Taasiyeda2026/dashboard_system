import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewRole, translateApiErrorForUser } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';

function hebrewYesNo(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'yes') return 'כן';
  if (v === 'no') return 'לא';
  return value || '—';
}

function roleSelectMarkup(row, canEdit) {
  if (!canEdit) return escapeHtml(hebrewRole(row.display_role));
  return `<select data-role-select data-user-id="${escapeHtml(row.user_id)}">
            <option value="admin" ${row.display_role === 'admin' ? 'selected' : ''}>מנהל/ת</option>
            <option value="operations_reviewer" ${row.display_role === 'operations_reviewer' ? 'selected' : ''}>בקר/ת תפעול</option>
            <option value="authorized_user" ${row.display_role === 'authorized_user' ? 'selected' : ''}>משתמש/ת מורשה</option>
            <option value="instructor" ${row.display_role === 'instructor' ? 'selected' : ''}>מדריך/ה</option>
          </select>`;
}

function activeMarkup(row, canEdit) {
  if (!canEdit) return escapeHtml(hebrewYesNo(row.active));
  return `<label class="perm-active-label"><input type="checkbox" data-active-toggle data-user-id="${escapeHtml(row.user_id)}" ${row.active === 'yes' ? 'checked' : ''} /> פעיל</label>`;
}

function saveButtonMarkup(row, canEdit) {
  if (!canEdit) return '';
  return `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-save-permission data-user-id="${escapeHtml(row.user_id)}" data-full-name="${escapeHtml(row.full_name)}" data-entry-code="${escapeHtml(row.entry_code || '')}" data-default-view="${escapeHtml(row.default_view || '')}">שמירה</button>`;
}

export const permissionsScreen = {
  load: ({ api }) => api.permissions(),
  render(data, { state }) {
    const canEdit =
      state?.user?.display_role === 'admin' || state?.user?.display_role === 'operations_reviewer';
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const tableBody = safeRows
      .map((row) => {
        const roleDisplay = roleSelectMarkup(row, canEdit);
        const activeDisplay = activeMarkup(row, canEdit);
        const saveButton = saveButtonMarkup(row, canEdit);
        return `<tr><td>${escapeHtml(row.user_id)}</td><td>${escapeHtml(row.full_name)}</td><td>${roleDisplay}</td><td>${activeDisplay}</td><td>${saveButton}</td></tr>`;
      })
      .join('');

    const mobileBody = safeRows
      .map((row) => {
        const roleDisplay = roleSelectMarkup(row, canEdit);
        const activeDisplay = activeMarkup(row, canEdit);
        const saveButton = saveButtonMarkup(row, canEdit);
        return `<article class="ds-entity-card">
          <div class="ds-entity-card__title">${escapeHtml(row.full_name)}</div>
          <div class="ds-entity-card__meta">${escapeHtml(row.user_id)}</div>
          <div class="ds-entity-card__body">
            <div><span class="ds-muted">${escapeHtml(hebrewColumn('display_role'))}</span><br />${roleDisplay}</div>
            <div><span class="ds-muted">${escapeHtml(hebrewColumn('active'))}</span><br />${activeDisplay}</div>
            <div>${saveButton}</div>
          </div>
        </article>`;
      })
      .join('');

    const tableInner =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו שורות הרשאה')
        : dsTableWrap(`<table class="ds-table">
            <thead><tr><th>${escapeHtml(hebrewColumn('user_id'))}</th><th>${escapeHtml(hebrewColumn('full_name'))}</th><th>${escapeHtml(hebrewColumn('display_role'))}</th><th>${escapeHtml(hebrewColumn('active'))}</th><th>${escapeHtml(hebrewColumn('actions'))}</th></tr></thead>
            <tbody>${tableBody}</tbody>
          </table>`);

    const mobileInner =
      safeRows.length === 0 ? dsEmptyState('לא נמצאו שורות הרשאה') : `<div class="ds-perm-mobile-list">${mobileBody}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('הרשאות', 'ניהול גישה למערכת')}
      ${dsCard({
        title: 'משתמשים והרשאות',
        badge: `${safeRows.length} משתמשים`,
        body: narrow ? mobileInner : tableInner,
        padded: safeRows.length === 0 || narrow
      })}
      <p id="permissions-status" class="ds-muted" role="status"></p>
    `);
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
          if (status) status.textContent = `נשמר עבור ${userId}`;
          if (typeof rerender === 'function') await rerender();
        } catch (error) {
          if (status) status.textContent = translateApiErrorForUser(error?.message);
        }
      })
    );
  }
};
