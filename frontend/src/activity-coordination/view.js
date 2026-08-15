import { escapeHtml } from '../screens/shared/html.js';
import { COORDINATION_STATUS, groupActivitiesForDispatch } from './domain.js';

export const STATUS_PRESENTATION = Object.freeze({
  [COORDINATION_STATUS.SENT]: { icon: '✅', label: 'נשלח', className: 'is-sent' },
  [COORDINATION_STATUS.CHANGED_SINCE_SENT]: { icon: '🔄', label: 'עודכן מאז השליחה', className: 'is-changed' },
  [COORDINATION_STATUS.DRAFT]: { icon: '◷', label: 'טיוטה הוכנה', className: 'is-draft' },
  [COORDINATION_STATUS.MISSING_DETAILS]: { icon: '⚠️', label: 'חסרים פרטים', className: 'is-missing' },
  [COORDINATION_STATUS.READY]: { icon: '○', label: 'מוכן לשליחה', className: 'is-ready' },
  [COORDINATION_STATUS.NOT_SENT]: { icon: '○', label: 'טרם נשלח', className: 'is-pending' }
});

export function coordinationStatusHtml(item, { action = false } = {}) {
  const meta = STATUS_PRESENTATION[item?.status] || STATUS_PRESENTATION[COORDINATION_STATUS.NOT_SENT];
  const sentDate = item?.persisted?.sent_at ? new Date(item.persisted.sent_at).toLocaleDateString('he-IL') : '';
  const title = [item?.technical_blocker, item?.cc_warning, item?.persisted?.reconciliation_error].filter(Boolean).join(' · ');
  const buttonLabel = item?.status === COORDINATION_STATUS.CHANGED_SINCE_SENT ? 'שליחת אישור מעודכן' : 'אישור תיאום';
  const button = action && item?.readiness?.ready && !item?.technical_blocker && ![COORDINATION_STATUS.DRAFT, COORDINATION_STATUS.SENT].includes(item?.status)
    ? `<button type="button" class="coordination-send-link" data-coordination-send="${escapeHtml(item.activity_row_id)}">${buttonLabel}</button>` : '';
  return `<span class="coordination-status ${meta.className}" title="${escapeHtml(title)}"><span aria-hidden="true">${meta.icon}</span> ${meta.label}${sentDate ? ` · ${escapeHtml(sentDate)}` : ''}</span>${button}`;
}

export function coordinationDrawerActionHtml(item) {
  if (item?.status === COORDINATION_STATUS.SENT) {
    return '<span class="coordination-drawer-sent"><span class="coordination-drawer-sent__check" aria-hidden="true">✓</span> אישור תיאום נשלח</span>';
  }
  const label = item?.status === COORDINATION_STATUS.CHANGED_SINCE_SENT ? 'שליחת אישור מעודכן' : 'אישור תיאום';
  return `<button type="button" class="ds-btn ds-btn--sm" data-coordination-approval>${label}</button>`;
}

export function renderCoordinationWorkspace(context = {}, { canManage = false } = {}) {
  const items = context.items || [];
  const counts = Object.fromEntries(Object.values(COORDINATION_STATUS).map((status) => [status, items.filter((item) => item.status === status).length]));
  const kpis = [
    ['סה״כ', items.length], ['נשלחו', counts.sent || 0], ['מוכנים לשליחה', counts.ready || 0],
    ['חסרים פרטים', counts.missing_details || 0], ['טיוטה הוכנה', counts.draft || 0], ['עודכנו מאז השליחה', counts.changed_since_sent || 0]
  ];
  const schoolGroups = new Map();
  for (const item of items) {
    const schoolKey = String(item.activity.school_id || item.snapshot.school.name);
    if (!schoolGroups.has(schoolKey)) schoolGroups.set(schoolKey, []);
    schoolGroups.get(schoolKey).push(item);
  }
  return `<section class="coordination-workspace" dir="rtl">
    <div class="coordination-kpis">${kpis.map(([label, value]) => `<div class="coordination-kpi"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>
    <div class="coordination-toolbar">
      <select class="ds-input ds-input--sm" data-coordination-filter aria-label="סינון לפי סטטוס"><option value="">כל הסטטוסים</option>${Object.entries(STATUS_PRESENTATION).map(([key, value]) => `<option value="${key}">${value.icon} ${value.label}</option>`).join('')}</select>
      ${canManage ? '<button type="button" class="ds-btn ds-btn--sm" data-coordination-select-ready>בחר את כל המוכנים לשליחה</button><button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-coordination-prepare>הכנת מיילים נבחרים</button>' : ''}
      <span data-coordination-progress role="status" aria-live="polite"></span>
    </div>
    <div class="coordination-schools">${Array.from(schoolGroups.entries()).map(([key, group]) => `<section class="coordination-school" data-coordination-school data-school-key="${escapeHtml(key)}">
      <header><label><input type="checkbox" data-coordination-school-select> <strong>${escapeHtml(group[0].snapshot.school.name || 'בית ספר')}</strong></label><span>${group.length} פעילויות</span></header>
      <div class="coordination-rows">${group.map((item) => `<label class="coordination-row" data-coordination-row data-status="${item.status}"><input type="checkbox" data-coordination-item value="${escapeHtml(item.activity_row_id)}" ${(!canManage || !item.readiness.ready || item.technical_blocker || item.status === COORDINATION_STATUS.DRAFT) ? 'disabled' : ''}><span><strong>${escapeHtml(item.snapshot.program.name || 'ללא שם')}</strong><small>${escapeHtml(item.technical_blocker || item.recipient_email)}</small></span><span>${coordinationStatusHtml(item)}</span></label>`).join('')}</div>
    </section>`).join('')}</div>
  </section>`;
}

function applyCoordinationStatusFilter(root, status = '') {
  const selectedStatus = String(status || '').trim();
  root.querySelectorAll('[data-coordination-school]').forEach((school) => {
    let visibleRows = 0;
    school.querySelectorAll('[data-coordination-row]').forEach((row) => {
      const visible = !selectedStatus || row.dataset.status === selectedStatus;
      row.hidden = !visible;
      row.style.display = visible ? '' : 'none';
      if (!visible) {
        const item = row.querySelector('[data-coordination-item]');
        if (item) item.checked = false;
      } else {
        visibleRows += 1;
      }
    });
    const schoolVisible = !selectedStatus || visibleRows > 0;
    school.hidden = !schoolVisible;
    school.style.display = schoolVisible ? '' : 'none';
    const schoolCheckbox = school.querySelector('[data-coordination-school-select]');
    if (schoolCheckbox) schoolCheckbox.checked = false;
  });
}

export function bindCoordinationWorkspace(root, context, { loginHint = '', onChanged = () => {} } = {}) {
  const filter = root.querySelector('[data-coordination-filter]');
  filter?.addEventListener('change', () => applyCoordinationStatusFilter(root, filter.value));
  root.querySelectorAll('[data-coordination-school-select]').forEach((box) => box.addEventListener('change', () => {
    box.closest('[data-coordination-school]').querySelectorAll('[data-coordination-row]').forEach((row) => {
      if (row.hidden) return;
      const item = row.querySelector('[data-coordination-item]:not(:disabled)');
      if (item) item.checked = box.checked;
    });
  }));
  root.querySelector('[data-coordination-select-ready]')?.addEventListener('click', () => {
    root.querySelectorAll('[data-coordination-item]').forEach((item) => {
      const row = item.closest('[data-coordination-row]');
      item.checked = !item.disabled && row?.dataset.status === COORDINATION_STATUS.READY;
    });
  });
  root.querySelector('[data-coordination-prepare]')?.addEventListener('click', async () => {
    const ids = new Set(Array.from(root.querySelectorAll('[data-coordination-item]:checked')).map((item) => item.value));
    const selected = context.items.filter((item) => ids.has(item.activity_row_id));
    const groups = groupActivitiesForDispatch(selected);
    if (!selected.length) return;
    if (!globalThis.confirm(`יוכנו ${groups.length} מיילים עבור ${selected.length} פעילויות. להמשיך?`)) return;
    const progress = root.querySelector('[data-coordination-progress]');
    const { prepareCoordinationDrafts } = await import('./outlook.js');
    const results = await prepareCoordinationDrafts(selected, { loginHint, onProgress: ({ current, total }) => { progress.textContent = `מכין מיילים ${current} מתוך ${total}`; } });
    const succeeded = results.filter((item) => item.ok && !item.value?.existing).length;
    const skipped = results.filter((item) => item.ok && item.value?.existing).length;
    const failed = results.filter((item) => !item.ok).length;
    progress.textContent = `נוצרו ${succeeded} טיוטות · ${skipped} דולגו · ${failed} נכשלו`;
    await onChanged(results);
  });
}

export async function reconcileVisibleDrafts(context, { loginHint = '' } = {}) {
  const [{ delegatedMailToken }, { reconcileDispatch }] = await Promise.all([import('../microsoft/graph-mail.js'), import('./outlook.js')]);
  const drafts = new Map();
  for (const item of context.items || []) {
    const p = item.persisted || {};
    if (!p.active_draft_dispatch_id || !p.graph_message_id) continue;
    drafts.set(p.active_draft_dispatch_id, {
      id: p.active_draft_dispatch_id, graph_message_id: p.graph_message_id,
      client_correlation_id: p.client_correlation_id, recipient_email: p.recipient_email,
      summary_pdf_filename: p.summary_pdf_filename, photography_pdf_filename: p.photography_pdf_filename
    });
  }
  if (!drafts.size) return [];
  const token = await delegatedMailToken(loginHint);
  const results = [];
  for (const dispatch of drafts.values()) results.push(await reconcileDispatch(dispatch, token).catch((error) => ({ status: 'error', error })));
  return results;
}
