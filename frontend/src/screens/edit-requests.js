import { escapeHtml } from './shared/html.js';
import { hebrewColumn } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsFilterBar,
  dsStatusChip,
  dsEmptyState
} from './shared/layout.js';
import { showToast } from './shared/toast.js';

function hebrewFieldName(field) {
  return hebrewColumn(field) || escapeHtml(field);
}

function statusLabel(status) {
  if (status === 'pending') return 'ממתין';
  if (status === 'approved') return 'אושר';
  if (status === 'rejected') return 'נדחה';
  if (status === 'conflict') return 'קונפליקט';
  return status || '—';
}

function statusVariant(status) {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'conflict') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function renderGroup(group, canReview) {
  const fieldsRows = (group.fields || []).map((f) => `
    <tr>
      <td class="ds-er-field-name">${hebrewFieldName(f.field_name)}</td>
      <td class="ds-er-old">${escapeHtml(f.old_value || '—')}</td>
      <td class="ds-er-arrow">←</td>
      <td class="ds-er-new">${escapeHtml(f.new_value || '—')}</td>
    </tr>
  `).join('');

  const actionsHtml = (canReview && group.status === 'pending') ? `
    <div class="ds-er-actions">
      <button class="ds-btn ds-btn--success ds-btn--sm" data-action="approve" data-request-id="${escapeHtml(group.request_id)}">אישור</button>
      <button class="ds-btn ds-btn--danger ds-btn--sm" data-action="reject" data-request-id="${escapeHtml(group.request_id)}">דחייה</button>
    </div>
  ` : '';

  const reviewerNoteHtml = group.review_note ? `
    <p class="ds-er-reviewer-note"><span class="ds-muted">הערת סוקר:</span> ${escapeHtml(group.review_note)}</p>
  ` : '';

  return `
    <div class="ds-er-group" data-status="${escapeHtml(group.status || '')}" data-request-id="${escapeHtml(group.request_id)}">
      <div class="ds-er-group-head">
        <div class="ds-er-group-meta">
          <span class="ds-er-requester">${escapeHtml(group.requested_by_name || group.requested_by_user_id || '—')}</span>
          <span class="ds-muted ds-er-date">${formatDate(group.requested_at)}</span>
          <span class="ds-er-row-id ds-muted">${escapeHtml(group.activity_name || '')}</span>
          <span class="ds-er-row-id ds-muted">${escapeHtml(group.source_row_id || '')}</span>
        </div>
        <div>${dsStatusChip(statusLabel(group.status), statusVariant(group.status))}</div>
      </div>
      <div class="ds-table-wrap ds-er-fields-wrap">
        <table class="ds-table ds-er-fields-table">
          <thead>
            <tr>
              <th>שדה</th>
              <th>ערך קיים</th>
              <th></th>
              <th>ערך חדש</th>
            </tr>
          </thead>
          <tbody>${fieldsRows}</tbody>
        </table>
      </div>
      ${reviewerNoteHtml}
      ${actionsHtml}
    </div>
  `;
}

export const editRequestsScreen = {
  load: ({ api }) => api.editRequests(),
  render(data) {
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const validGroups = groups.filter((group) => Array.isArray(group?.fields) && group.fields.length > 0);
    const canReview = !!data?.canReview;

    const statusFilters = [
      { value: '', label: 'הכול' },
      { value: 'pending', label: 'ממתינים' },
      { value: 'approved', label: 'מאושרים' },
      { value: 'rejected', label: 'נדחו' },
      { value: 'conflict', label: 'קונפליקט' }
    ];

    const filterChips = statusFilters.map((f) => `
      <button class="ds-chip${f.value === 'pending' ? ' is-active' : ''}"
        data-er-filter="${escapeHtml(f.value)}">${escapeHtml(f.label)}</button>
    `).join('');

    const groupsHtml = validGroups.length === 0
      ? dsEmptyState('אין בקשות עריכה')
      : validGroups.map((g) => renderGroup(g, canReview)).join('');

    const subtitle = canReview ? 'בקשות עריכה הממתינות לאישורך' : 'בקשות עריכה שהגשת';

    return dsScreenStack(`
      ${dsPageHeader('בקשות עריכה', subtitle)}
      ${dsCard({
        title: `בקשות (${validGroups.length})`,
        padded: false,
        body: `
          <div class="ds-filter-bar ds-er-filter-bar">${filterChips}</div>
          <div class="ds-er-list" data-er-list>${groupsHtml}</div>
        `
      })}
    `);
  },
  bind({ root, data, api, rerender, clearScreenDataCache }) {
    if (!root) return;

    const list = root.querySelector('[data-er-list]');
    let activeFilter = 'pending';

    root.querySelectorAll('[data-er-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('[data-er-filter]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const filterVal = btn.dataset.erFilter;
        activeFilter = filterVal;
        if (!list) return;
        list.querySelectorAll('.ds-er-group').forEach((g) => {
          const show = !filterVal || g.dataset.status === filterVal;
          g.style.display = show ? '' : 'none';
        });
      });
    });

    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const requestId = btn.dataset.requestId;
        if (!requestId || !action) return;

        const status = action === 'approve' ? 'approved' : 'rejected';
        btn.disabled = true;

        try {
          await api.reviewEditRequest(requestId, status);
          const groupEl = btn.closest('.ds-er-group');
          if (groupEl) {
            if (activeFilter === 'pending') {
              groupEl.remove();
            } else {
              groupEl.dataset.status = status;
              const statusChipWrap = groupEl.querySelector('.ds-er-group-head > div:last-child');
              if (statusChipWrap) statusChipWrap.innerHTML = dsStatusChip(statusLabel(status), statusVariant(status));
              groupEl.querySelector('.ds-er-actions')?.remove();
            }
          }
          clearScreenDataCache?.();
          showToast(status === 'approved' ? 'הבקשה אושרה' : 'הבקשה נדחתה', 'success');
          rerender?.();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message || 'שגיאה בעיבוד הבקשה', 'error');
        }
      });
    });

    root.querySelectorAll('[data-er-filter]')[1]?.click();
  }
};
