import { escapeHtml } from '../screens/shared/html.js';
import { COORDINATION_STATUS, groupActivitiesForDispatch } from './domain.js';

export const STATUS_PRESENTATION = Object.freeze({
  [COORDINATION_STATUS.SENT]: { icon: '✅', label: 'נשלח', className: 'is-sent' },
  [COORDINATION_STATUS.MISSING_DETAILS]: { icon: '⚠️', label: 'חסרים פרטים', className: 'is-missing' },
  [COORDINATION_STATUS.READY]: { icon: '○', label: 'מוכן לשליחה', className: 'is-ready' }
});

const MISSING_LABELS = Object.freeze({
  school: 'שם בית ספר',
  program: 'שם תוכנית / פעילות',
  contact: 'איש קשר',
  grade_class: 'כיתה / קבוצה',
  sessions: 'מספר מפגשים',
  start_time: 'שעת התחלה',
  end_time: 'שעת סיום',
  instructor: 'מדריך/ה'
});

const OUTLOOK_DRAFTS_URL = 'https://outlook.office.com/mail/drafts';

export function preparedCoordinationDraftLink(result = {}) {
  return String(
    result?.value?.draft?.webLink
    || result?.value?.dispatch?.graph_web_link
    || result?.value?.dispatch?.webLink
    || ''
  ).trim();
}

export function openCoordinationDraftPlaceholder(windowRef = globalThis) {
  const popup = windowRef?.open?.('about:blank', '_blank');
  if (!popup) return null;
  try {
    popup.opener = null;
    popup.document.title = 'מכין אישור תיאום';
    popup.document.body.setAttribute('dir', 'rtl');
    popup.document.body.style.fontFamily = 'Arial, sans-serif';
    popup.document.body.style.padding = '32px';
    popup.document.body.textContent = 'מכין את טיוטת אישור התיאום ב-Outlook…';
  } catch (_) {}
  return popup;
}

export function revealCoordinationDraft(result, popup, windowRef = globalThis) {
  const link = preparedCoordinationDraftLink(result) || OUTLOOK_DRAFTS_URL;
  if (popup && !popup.closed) {
    try {
      popup.location.href = link;
      return link;
    } catch (_) {}
  }
  try { windowRef?.open?.(link, '_blank'); } catch (_) {}
  return link;
}

function closeCoordinationDraftPlaceholder(popup) {
  try { if (popup && !popup.closed) popup.close(); } catch (_) {}
}

export function coordinationUiStatus(item = {}) {
  if ([COORDINATION_STATUS.SENT, COORDINATION_STATUS.CHANGED_SINCE_SENT].includes(item.status)) return COORDINATION_STATUS.SENT;
  if (!item.readiness?.ready || item.technical_blocker) return COORDINATION_STATUS.MISSING_DETAILS;
  return COORDINATION_STATUS.READY;
}

export function coordinationMissingDetails(item = {}) {
  const details = (item.readiness?.missing || []).map((key) => key.startsWith('date_') ? 'תאריכי פעילות' : (MISSING_LABELS[key] || key));
  if (item.technical_blocker) {
    details.push(/מייל|דוא[״\"]?ל/.test(item.technical_blocker) ? 'מייל' : item.technical_blocker.replace(/^חסר(?:ה|ים)?\s+/, ''));
  }
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
  if (uiStatus === COORDINATION_STATUS.MISSING_DETAILS) {
    return `<span class="coordination-missing-list" title="${escapeHtml(title)}"><span aria-hidden="true">⚠</span> חסרים: ${coordinationMissingDetails(item).map(escapeHtml).join(', ')}</span>`;
  }
  return `<span class="coordination-status ${meta.className}" title="${escapeHtml(title)}"><span aria-hidden="true">${meta.icon}</span> ${meta.label}${sentDate ? ` · ${escapeHtml(sentDate)}` : ''}</span>${changed}${button}`;
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
  const byStatus = {
    [COORDINATION_STATUS.MISSING_DETAILS]: items.filter((item) => coordinationUiStatus(item) === COORDINATION_STATUS.MISSING_DETAILS),
    [COORDINATION_STATUS.READY]: items.filter((item) => coordinationUiStatus(item) === COORDINATION_STATUS.READY),
    [COORDINATION_STATUS.SENT]: items.filter((item) => coordinationUiStatus(item) === COORDINATION_STATUS.SENT)
  };
  const schoolGroups = (sectionItems) => {
    const groups = new Map();
    for (const item of sectionItems) {
      const key = String(item.activity?.school_id || item.snapshot?.school?.name || 'school');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  };
  const detailsHtml = (item) => {
    const grade = [item.activity?.grade, item.activity?.class_group].filter(Boolean).join(' / ');
    const date = item.snapshot?.program?.meetings?.find((meeting) => meeting.date)?.date || '';
    return [grade, item.snapshot?.contact?.name, item.recipient_email, date]
      .filter(Boolean).map((value) => `<small>${escapeHtml(value)}</small>`).join('');
  };
  const sectionHtml = (status, title, { actions = false } = {}) => {
    const sectionItems = byStatus[status];
    const groups = schoolGroups(sectionItems);
    return `<section class="coordination-section coordination-section--${status}" data-coordination-section="${status}">
      <header class="coordination-section__header"><h3>${escapeHtml(title)} <span>${sectionItems.length}</span></h3>${actions && canManage ? `<div class="coordination-toolbar"><button type="button" class="ds-btn ds-btn--sm" data-coordination-select-ready>סמן מוכנים</button><button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-coordination-prepare>שליחת מוכנים</button><span data-coordination-progress role="status" aria-live="polite"></span></div>` : ''}</header>
      ${sectionItems.length ? `<div class="coordination-schools">${Array.from(groups.entries()).map(([key, group]) => `<section class="coordination-school" data-coordination-school data-school-key="${escapeHtml(key)}">
        <header>${status === COORDINATION_STATUS.READY && canManage ? '<label><input type="checkbox" data-coordination-school-select> ' : ''}<strong>${escapeHtml(group[0].snapshot?.school?.name || 'בית ספר')}</strong>${status === COORDINATION_STATUS.READY && canManage ? '</label>' : ''}<span>${group.length} פעילויות</span></header>
        <div class="coordination-rows">${group.map((item) => `<label class="coordination-row" data-coordination-row data-status="${status}">${status === COORDINATION_STATUS.READY && canManage ? `<input type="checkbox" data-coordination-item value="${escapeHtml(item.activity_row_id)}">` : ''}<span class="coordination-row__details"><strong>${escapeHtml(item.snapshot?.program?.name || '')}</strong>${detailsHtml(item)}</span><span class="coordination-row__state">${coordinationStatusHtml(item)}</span></label>`).join('')}</div>
      </section>`).join('')}</div>` : '<p class="coordination-section__empty">אין פעילויות במצב זה.</p>'}
    </section>`;
  };
  return `<section class="coordination-workspace" dir="rtl">
    <div class="coordination-workspace__columns">
      <div class="coordination-workspace__missing">
        ${sectionHtml(COORDINATION_STATUS.MISSING_DETAILS, 'חסרים פרטים')}
      </div>
      <div class="coordination-workspace__right">
        ${sectionHtml(COORDINATION_STATUS.READY, 'מוכנים לשליחה', { actions: true })}
        ${sectionHtml(COORDINATION_STATUS.SENT, 'נשלח')}
      </div>
    </div>
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
    const draftWindow = openCoordinationDraftPlaceholder();
    const progress = root.querySelector('[data-coordination-progress]');
    const { prepareCoordinationDrafts } = await import('./outlook.js');
    const results = await prepareCoordinationDrafts(selected, { loginHint, onProgress: ({ current, total }) => { progress.textContent = `מכין מיילים ${current} מתוך ${total}`; } });
    const succeeded = results.filter((item) => item.ok && !item.value?.existing).length;
    const skipped = results.filter((item) => item.ok && item.value?.existing).length;
    const failed = results.filter((item) => !item.ok).length;
    const firstSuccessful = results.find((result) => result.ok);
    if (firstSuccessful) revealCoordinationDraft(firstSuccessful, draftWindow);
    else closeCoordinationDraftPlaceholder(draftWindow);
    progress.textContent = `נוצרו ${succeeded} טיוטות · ${skipped} דולגו · ${failed} נכשלו${firstSuccessful ? ' · הטיוטה הראשונה נפתחה ב-Outlook' : ''}`;
    await onChanged(results);
  });
}

export function renderCoordinationActivityModal(item) {
  if (!item) return '<p class="ds-muted">לא נמצאו נתוני אישור תיאום לפעילות זו.</p>';
  const meetings = item.snapshot?.program?.meetings || [];
  const dates = meetings.map((meeting) => meeting.date).filter(Boolean).join(', ');
  const hours = meetings.find((meeting) => meeting.hours)?.hours || '';
  const grade = [item.activity?.grade, item.activity?.class_group].filter(Boolean).join(' / ');
  const canPrepare = coordinationUiStatus(item) === COORDINATION_STATUS.READY || item.status === COORDINATION_STATUS.CHANGED_SINCE_SENT;
  const label = item.status === COORDINATION_STATUS.CHANGED_SINCE_SENT ? 'שליחת אישור מעודכן' : 'שליחת אישור תיאום';
  const field = (name, value) => value ? `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>` : '';
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
    const draftWindow = openCoordinationDraftPlaceholder();
    button.disabled = true;
    progress.textContent = 'מכין את המייל…';
    try {
      const { prepareCoordinationDrafts } = await import('./outlook.js');
      const results = await prepareCoordinationDrafts([item], { loginHint });
      const failed = results.find((result) => !result.ok);
      if (failed) throw failed.error;
      const successful = results.find((result) => result.ok);
      revealCoordinationDraft(successful, draftWindow);
      progress.textContent = 'טיוטת אישור התיאום הוכנה ונפתחה ב-Outlook.';
      await onChanged(results);
    } catch (error) {
      closeCoordinationDraftPlaceholder(draftWindow);
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
  const token = await delegatedMailToken(loginHint, { interactive: false });
  if (!token) return [];
  const results = [];
  for (const dispatch of drafts.values()) results.push(await reconcileDispatch(dispatch, token).catch((error) => ({ status: 'error', error })));
  return results;
}
