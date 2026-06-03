import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsStatusChip,
  dsEmptyState
} from './shared/layout.js';
import { showToast } from './shared/toast.js';

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

/** תאריך ISO YYYY-MM-DD → DD/MM/YYYY לתצוגה */
function formatDateDisplay(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const dt = new Date(t);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  return s;
}

function fieldLabelHe(field) {
  const f = String(field || '').trim();
  if (!f) return 'שדה';
  if (f === 'status') return 'סטטוס פעילות';
  const m = /^date_(\d+)$/.exec(f);
  if (m) return `מפגש ${Number(m[1])}`;
  return hebrewColumn(f);
}

function formatFieldValueForDisplay(fieldName, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const fn = String(fieldName || '');
  if (fn === 'start_date' || fn === 'end_date' || /^date_\d+$/.test(fn)) {
    return formatDateDisplay(s) || s;
  }
  if (fn === 'activity_type') {
    const he = hebrewActivityType(s);
    return he && he !== 'לא מסווג' ? he : s;
  }
  return s;
}

function displayOldNew(fieldName, oldVal, newVal) {
  const o = String(oldVal ?? '').trim();
  const n = String(newVal ?? '').trim();
  const oldDisp = o ? formatFieldValueForDisplay(fieldName, o) : '';
  const newDisp = n ? formatFieldValueForDisplay(fieldName, n) : '';
  return {
    oldHtml: oldDisp ? escapeHtml(oldDisp) : '<span class="ds-muted">לא הוגדר</span>',
    newHtml: newDisp ? escapeHtml(newDisp) : '<span class="ds-muted">נמחק / ריק</span>'
  };
}

function instructorLine(activity) {
  if (!activity) return '—';
  const n1 = String(activity.instructor_name || '').trim();
  const n2 = String(activity.instructor_name_2 || '').trim();
  const e1 = String(activity.emp_id || '').trim();
  const e2 = String(activity.emp_id_2 || '').trim();
  const parts = [];
  if (n1 || e1) parts.push(n1 ? (e1 ? `${n1} (${e1})` : n1) : e1);
  if (n2 || e2) parts.push(n2 ? (e2 ? `${n2} (${e2})` : n2) : e2);
  return parts.length ? parts.join(' · ') : '—';
}

function requestTypeLabel(type) {
  return String(type || '') === 'create_activity' ? 'בקשה להוספת פעילות' : 'בקשת עריכה';
}

function renderGroup(group, canReview) {
  const activity = group.activity || null;
  const isCreateRequest = String(group.request_type || '') === 'create_activity';
  const hasActivity = Boolean(activity);
  const titleName = String(group.activity_name || activity?.activity_name || '').trim() || 'פעילות ללא שם';
  const rowId = String(group.source_row_id || '').trim();
  const activityTypeRaw = String((isCreateRequest ? group?.requested_payload?.activity_type : activity?.activity_type) || '').trim();
  const activityType = activityTypeRaw
    ? (() => {
        const he = hebrewActivityType(activityTypeRaw);
        return he && he !== 'לא מסווג' ? he : activityTypeRaw;
      })()
    : '—';
  const authority = String(group.authority || activity?.authority || '').trim() || '—';
  const school = String(group.school || activity?.school || '').trim() || '—';
  const manager = String((isCreateRequest ? group?.requested_payload?.activity_manager : activity?.activity_manager) || '').trim() || '—';
  const startD = formatDateDisplay(String((isCreateRequest ? group?.requested_payload?.start_date : activity?.start_date) || '').trim());
  const endD = formatDateDisplay(String((isCreateRequest ? group?.requested_payload?.end_date : activity?.end_date) || '').trim());
  const startEnd = [startD, endD].filter(Boolean).join(' — ') || '—';

  const warnIncomplete = (!hasActivity && !isCreateRequest)
    ? `<div class="ds-er-warn" role="alert">לא נמצאו פרטי פעילות מלאים לבדיקה — לא ניתן לאשר עד שנטענת הפעילות מהמערכת.</div>`
    : '';

  const fieldsRows = (group.fields || []).map((f) => {
    const { oldHtml, newHtml } = displayOldNew(f.field_name, f.old_value, f.new_value);
    return `
    <tr>
      <td class="ds-er-field-name">${escapeHtml(fieldLabelHe(f.field_name))}</td>
      <td class="ds-er-old">${oldHtml}</td>
      <td class="ds-er-arrow">→</td>
      <td class="ds-er-new">${newHtml}</td>
    </tr>`;
  }).join('');

  const canApprove = canReview && group.status === 'pending' && group.can_approve !== false;
  const actionsHtml = canApprove ? `
    <div class="ds-er-actions">
      <button type="button" class="ds-btn ds-btn--success ds-btn--sm" data-action="approve" data-request-id="${escapeHtml(group.request_id)}">אישור</button>
      <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-action="reject" data-request-id="${escapeHtml(group.request_id)}">דחייה</button>
    </div>
  ` : '';

  const reviewerNoteHtml = group.review_note ? `
    <p class="ds-er-reviewer-note"><span class="ds-muted">הערת סוקר:</span> ${escapeHtml(group.review_note)}</p>
  ` : '';

  return `
    <article class="ds-er-group" data-status="${escapeHtml(group.status || '')}" data-request-id="${escapeHtml(group.request_id)}">
      <header class="ds-er-card-head">
        <h3 class="ds-er-card-title">${escapeHtml(requestTypeLabel(group.request_type))}: ${escapeHtml(titleName)}</h3>
        <div>${dsStatusChip(statusLabel(group.status), statusVariant(group.status))}</div>
      </header>
      <div class="ds-er-meta-grid" dir="rtl">
        <p><span class="ds-muted">מזהה:</span> <strong>${escapeHtml(rowId || (isCreateRequest ? 'ייווצר באישור' : '—'))}</strong></p>
        <p><span class="ds-muted">סוג בקשה:</span> ${escapeHtml(requestTypeLabel(group.request_type))}</p>
        <p><span class="ds-muted">סוג פעילות:</span> ${escapeHtml(activityType)}</p>
        <p><span class="ds-muted">רשות:</span> ${escapeHtml(authority)}</p>
        <p><span class="ds-muted">בית ספר:</span> ${escapeHtml(school)}</p>
        <p><span class="ds-muted">מנהל פעילות:</span> ${escapeHtml(manager)}</p>
        <p><span class="ds-muted">מדריך:</span> ${escapeHtml(isCreateRequest ? instructorLine(group.requested_payload || {}) : instructorLine(activity))}</p>
        <p><span class="ds-muted">תאריכי התחלה–סיום:</span> ${escapeHtml(startEnd)}</p>
      </div>
      <p class="ds-er-requester-line" dir="rtl">
        <span class="ds-muted">נשלח על ידי:</span>
        ${escapeHtml(group.requested_by_name || group.requested_by_user_id || '—')}
        <span class="ds-muted"> · בתאריך </span>
        ${escapeHtml(formatDateDisplay(group.requested_at) || String(group.requested_at || '—'))}
      </p>
      ${warnIncomplete}
      <h4 class="ds-er-section-title">${isCreateRequest ? 'פרטי הפעילות המבוקשת' : 'מה השתנה?'}</h4>
      <div class="ds-table-wrap ds-er-fields-wrap">
        <table class="ds-table ds-er-fields-table">
          <thead>
            <tr>
              <th>שדה</th>
              <th>${isCreateRequest ? 'פרט' : 'ערך נוכחי'}</th>
              <th></th>
              <th>${isCreateRequest ? 'ערך' : 'ערך מבוקש'}</th>
            </tr>
          </thead>
          <tbody>${fieldsRows}</tbody>
        </table>
      </div>
      ${reviewerNoteHtml}
      ${actionsHtml}
    </article>
  `;
}

const CLOSED_STATUSES = new Set(['approved', 'rejected']);

function isOpen(group) {
  return !CLOSED_STATUSES.has(String(group?.status || '').trim());
}

export const editRequestsScreen = {
  load: ({ api }) => api.editRequests(),
  render(data) {
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const validGroups = groups.filter((group) => String(group?.request_type || '') === 'create_activity' || (Array.isArray(group?.fields) && group.fields.length > 0));
    const canReview = !!data?.canReview;

    const openGroups = validGroups.filter(isOpen);

    const groupsHtml = openGroups.length === 0
      ? dsEmptyState('אין בקשות פתוחות כרגע')
      : openGroups.map((g) => renderGroup(g, canReview)).join('');

    const subtitle = canReview ? 'בקשות פעילות הממתינות לאישורך' : 'בקשות פעילות שהגשת';

    return dsScreenStack(`
      ${dsPageHeader('בקשות פעילות', subtitle)}
      ${dsCard({
        title: `בקשות פתוחות (${openGroups.length})`,
        padded: false,
        body: `<div class="ds-er-list" data-er-list>${groupsHtml}</div>`
      })}
    `);
  },
  bind({ root, api, rerender, clearScreenDataCache }) {
    if (!root) return;

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
          groupEl?.remove();
          clearScreenDataCache?.();
          try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch (_) { /* ignore */ }
          showToast(status === 'approved' ? 'הבקשה אושרה והשינוי נשמר בפעילויות' : 'הבקשה נדחתה', 'success');
          rerender?.();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message || 'שגיאה בעיבוד הבקשה', 'error');
        }
      });
    });
  }
};
