import { escapeHtml } from '../screens/shared/html.js';
import { COORDINATION_STATUS, groupActivitiesForDispatch } from './domain.js';

export const STATUS_PRESENTATION = Object.freeze({
  [COORDINATION_STATUS.SENT]: { icon: '✅', label: 'נשלח', className: 'is-sent' },
  [COORDINATION_STATUS.MISSING_DETAILS]: { icon: '⚠️', label: 'חסרים פרטים', className: 'is-missing' },
  [COORDINATION_STATUS.READY]: { icon: '○', label: 'מוכן לשליחה', className: 'is-ready' }
});

const MISSING_LABELS = Object.freeze({
  school: 'חסר שם בית ספר',
  program: 'חסר שם תוכנית / פעילות',
  contact: 'חסר איש קשר',
  grade_class: 'חסרה כיתה / קבוצה',
  sessions: 'חסר מספר מפגשים',
  start_time: 'חסרה שעת התחלה',
  end_time: 'חסרה שעת סיום',
  instructor: 'חסר/ה מדריך/ה'
});

export function coordinationUiStatus(item = {}) {
  if ([COORDINATION_STATUS.SENT, COORDINATION_STATUS.CHANGED_SINCE_SENT].includes(item.status)) return COORDINATION_STATUS.SENT;
  if (!item.readiness?.ready || item.technical_blocker) return COORDINATION_STATUS.MISSING_DETAILS;
  return COORDINATION_STATUS.READY;
}

export function coordinationMissingDetails(item = {}) {
  const details = (item.readiness?.missing || []).map((key) => key.startsWith('date_') ? 'חסרים תאריכי פעילות' : (MISSING_LABELS[key] || `חסר: ${key}`));
  if (item.technical_blocker) details.push(item.technical_blocker);
  return [...new Set(details)];
}

export function coordinationStatusHtml(item, { action = false } = {}) {
  const uiStatus = coordinationUiStatus(item);
  const meta = STATUS_PRESENTATION[uiStatus];
  const sentDate = item?.persisted?.sent_at ? new Date(item.persisted.sent_at).toLocaleDateString('he-IL') : '';
  const title = [item?.technical_blocker, item?.cc_warning, item?.persisted?.reconciliation_error].filter(Boolean).join(' · ');
  const buttonLabel = item?.status === COORDINATION_STATUS.CHANGED_SINCE_SENT ? 'שליחת אישור מעודכן' : 'אישור תיאום';
  const button = action && item?.readiness?.ready && !item?.technical_blocker && ![COORDINATION_STATUS.DRAFT, COORDINATION_STATUS.SENT].includes(item?.status)
    ? `<button type="button" class="coordination-send-link" data-coordination-send="${escapeHtml(item.activity_row_id)}">${buttonLabel}</button>` : '';
  const changed = item?.status === COORDINATION_STATUS.CHANGED_SINCE_SENT ? '<small class="coordination-changed-note">הפרטים השתנו מאז השליחה</small>' : '';
  const missing = uiStatus === COORDINATION_STATUS.MISSING_DETAILS ? `<small class="coordination-missing-list">${coordinationMissingDetails(item).map(escapeHtml).join(' · ')}</small>` : '';
  return `<span class="coordination-status ${meta.className}" title="${escapeHtml(title)}"><span aria-hidden="true">${meta.icon}</span> ${meta.label}${sentDate ? ` · ${escapeHtml(sentDate)}` : ''}</span>${changed}${missing}${button}`;
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
  const schoolGroups = new Map();
  for (const item of items) {
    const schoolKey = String(item.activity.school_id || item.snapshot.school.name);
    if (!schoolGroups.has(schoolKey)) schoolGroups.set(schoolKey, []);
    schoolGroups.get(schoolKey).push(item);
  }
  return `<section class="coordination-workspace" dir="rtl">
    <div class="coordination-toolbar">
      ${canManage ? '<button type="button" class="ds-btn ds-btn--sm" data-coordination-select-ready>בחר את כל המוכנים לשליחה</button><button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-coordination-prepare>הכנת מיילים נבחרים</button>' : ''}
      <span data-coordination-progress role="status" aria-live="polite"></span>
    </div>
    <div class="coordination-schools">${Array.from(schoolGroups.entries()).map(([key, group]) => `<section class="coordination-school" data-coordination-school data-school-key="${escapeHtml(key)}">
      <header><label><input type="checkbox" data-coordination-school-select> <strong>${escapeHtml(group[0].snapshot.school.name || 'בית ספר')}</strong></label><span>${group.length} פעילויות</span></header>
      <div class="coordination-rows">${group.map((item) => `<label class="coordination-row" data-coordination-row data-status="${coordinationUiStatus(item)}"><input type="checkbox" data-coordination-item value="${escapeHtml(item.activity_row_id)}" ${(!canManage || coordinationUiStatus(item) !== COORDINATION_STATUS.READY) ? 'disabled' : ''}><span><strong>${escapeHtml(item.snapshot.program.name || 'ללא שם')}</strong><small>${escapeHtml([item.activity?.grade, item.activity?.class_group].filter(Boolean).join(' / ') || 'ללא כיתה / קבוצה')}</small><small>נמען: ${escapeHtml(item.snapshot.contact.name || 'לא צוין')} · ${escapeHtml(item.recipient_email || 'ללא מייל')}</small></span><span>${coordinationStatusHtml(item)}</span></label>`).join('')}</div>
    </section>`).join('')}</div>
  </section>`;
}

export function bindCoordinationWorkspace(root, context, { loginHint = '', onChanged = () => {} } = {}) {
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

export function renderCoordinationActivityModal(item) {
  if (!item) return '<p class="ds-muted">לא נמצאו נתוני אישור תיאום לפעילות זו.</p>';
  const meetings = item.snapshot?.program?.meetings || [];
  const dates = meetings.map((meeting) => meeting.date).filter(Boolean).join(', ') || '—';
  const hours = meetings.find((meeting) => meeting.hours)?.hours || '—';
  const grade = [item.activity?.grade, item.activity?.class_group].filter(Boolean).join(' / ') || '—';
  const canPrepare = coordinationUiStatus(item) === COORDINATION_STATUS.READY || item.status === COORDINATION_STATUS.CHANGED_SINCE_SENT;
  const label = item.status === COORDINATION_STATUS.CHANGED_SINCE_SENT ? 'שליחת אישור מעודכן' : 'הכנת אישור תיאום';
  const field = (name, value) => `<div><dt>${name}</dt><dd>${escapeHtml(value || '—')}</dd></div>`;
  return `<section class="coordination-activity-modal" data-coordination-activity-modal data-activity-id="${escapeHtml(item.activity_row_id)}" dir="rtl">
    <div class="coordination-activity-modal__status">${coordinationStatusHtml(item)}</div>
    <dl>${field('בית ספר', item.snapshot?.school?.name)}${field('תוכנית / פעילות', item.snapshot?.program?.name)}${field('כיתה / קבוצה', grade)}${field('תאריכים', dates)}${field('שעות', hours)}${field('איש קשר', item.snapshot?.contact?.name)}${field('מייל לנמען', item.recipient_email)}${field('העתק', item.cc_email)}${field('מסמכים', 'סיכום תיאום ואישור צילום')}</dl>
    ${canPrepare ? `<button type="button" class="ds-btn ds-btn--primary" data-coordination-modal-prepare>${label}</button>` : ''}
    <span data-coordination-modal-progress role="status" aria-live="polite"></span>
  </section>`;
}

export function bindCoordinationActivityModal(root, item, { loginHint = '', onChanged = () => {} } = {}) {
  root.querySelector('[data-coordination-modal-prepare]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const progress = root.querySelector('[data-coordination-modal-progress]');
    button.disabled = true;
    progress.textContent = 'מכין את המייל…';
    try {
      const { prepareCoordinationDrafts } = await import('./outlook.js');
      const results = await prepareCoordinationDrafts([item], { loginHint });
      const failed = results.find((result) => !result.ok);
      if (failed) throw failed.error;
      progress.textContent = 'טיוטת אישור התיאום הוכנה ב-Outlook.';
      await onChanged(results);
    } catch (error) {
      progress.textContent = error?.message || 'לא ניתן להכין את הטיוטה.';
      button.disabled = false;
    }
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
