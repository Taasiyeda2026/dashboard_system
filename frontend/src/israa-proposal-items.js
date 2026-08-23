import { supabase } from './supabase-client.js';

const REOPEN_ACTIVITIES_KEY = 'israa_reopen_activities_after_reload';

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function selectedProposalItemIds(draft) {
  return new Set((Array.isArray(draft?.selected_activity_drafts) ? draft.selected_activity_drafts : [])
    .map((item) => clean(item?.proposal_item_id))
    .filter(Boolean));
}

function markActivitiesTabForReload() {
  try { sessionStorage.setItem(REOPEN_ACTIVITIES_KEY, '1'); } catch {}
}

function reopenActivitiesTabAfterReload() {
  if (typeof document === 'undefined') return;
  let shouldReopen = false;
  try {
    shouldReopen = sessionStorage.getItem(REOPEN_ACTIVITIES_KEY) === '1';
    if (shouldReopen) sessionStorage.removeItem(REOPEN_ACTIVITIES_KEY);
  } catch {}
  if (!shouldReopen) return;

  let observer;
  const open = () => {
    const tab = document.querySelector('.israa-mgmt [data-israa-tab="activities"]');
    if (!tab) return false;
    observer?.disconnect();
    tab.click();
    return true;
  };
  if (open()) return;
  observer = new MutationObserver(() => open());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer?.disconnect(), 8000);
}

function decoratePrivateDraftRemovalButtons() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.israa-activity-card[data-israa-draft][data-tracking-id]').forEach((card) => {
    const actions = card.querySelector('.israa-activity-actions');
    if (!actions || actions.querySelector('[data-israa-remove-draft]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'israa-btn';
    button.dataset.israaRemoveDraft = card.dataset.israaDraft || '';
    button.dataset.trackingId = card.dataset.trackingId || '';
    button.textContent = 'הסר מהפעילויות שלי';
    actions.prepend(button);
  });
}

function installRuntimeSelectionBridge() {
  if (typeof document === 'undefined' || globalThis.__israaActivitySelectionBridgeInstalled) return;
  globalThis.__israaActivitySelectionBridgeInstalled = true;

  reopenActivitiesTabAfterReload();
  decoratePrivateDraftRemovalButtons();
  const observer = new MutationObserver(() => decoratePrivateDraftRemovalButtons());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', async (event) => {
    const selectButton = event.target?.closest?.('[data-israa-select-activity]');
    if (selectButton && selectButton.closest('.ds-drawer--israa-exact')) {
      event.preventDefault();
      event.stopPropagation();
      if (selectButton.disabled) return;
      selectButton.disabled = true;
      const originalText = selectButton.textContent;
      try {
        const { error } = await supabase.rpc('save_israa_activity_draft', {
          p_tracking_id: selectButton.dataset.israaTrackingId,
          p_proposal_item_id: selectButton.dataset.israaSelectActivity,
          p_draft: {}
        });
        if (error) throw error;
        selectButton.textContent = 'כבר בפעילויות';
        markActivitiesTabForReload();
        setTimeout(() => window.location.reload(), 120);
      } catch (error) {
        console.error('[israa-select-activity]', error);
        selectButton.disabled = false;
        selectButton.textContent = originalText;
        window.alert('לא ניתן להעביר את הפעילות כרגע.');
      }
      return;
    }

    const removeButton = event.target?.closest?.('[data-israa-remove-draft]');
    if (!removeButton) return;
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm('להסיר מהפעילויות שלי? הפעילות תישאר בהצעה וניתן יהיה לבחור אותה שוב.')) return;
    removeButton.disabled = true;
    try {
      const { error } = await supabase.rpc('remove_israa_activity_draft', {
        p_tracking_id: removeButton.dataset.trackingId,
        p_proposal_item_id: removeButton.dataset.israaRemoveDraft
      });
      if (error) throw error;
      markActivitiesTabForReload();
      window.location.reload();
    } catch (error) {
      console.error('[israa-remove-activity-draft]', error);
      removeButton.disabled = false;
      window.alert(error?.message?.includes('israa_activity_already_shared')
        ? 'הפעילות כבר שותפה למערכת ולכן לא ניתן להסיר אותה מכאן.'
        : 'לא ניתן להסיר את הפעילות כרגע.');
    }
  }, true);
}

installRuntimeSelectionBridge();

export function proposalItemRows(draft) {
  if (!Array.isArray(draft?.proposal_items)) return [];
  return draft.proposal_items.map((item) => ({
    program_name: clean(item?.program_name),
    gefen_number: clean(item?.gefen_number),
    quantity: item?.quantity == null || item.quantity === '' ? null : Number(item.quantity),
  }));
}

export function activitiesTable(draft, { selectable = true } = {}) {
  const items = proposalItemRows(draft);
  if (!items.length) {
    return `<div class="israa-drawer__legacy-activities">
      <div><strong>פירוט ההצעה:</strong> ${escapeHtml(clean(draft?.program_name) || '—')}</div>
      <div><strong>מספרי גפ״ן:</strong> ${escapeHtml(clean(draft?.gefen_numbers) || '—')}</div>
    </div>`;
  }
  const selectedIds = selectedProposalItemIds(draft);
  const cells = items.map((item, index) => {
    const source = draft.proposal_items[index] || {};
    const sourceId = clean(source.proposal_item_id);
    const selected = sourceId && selectedIds.has(sourceId);
    const action = selectable && sourceId
      ? `<td>${selected
        ? '<button type="button" class="israa-btn" disabled>כבר בפעילויות</button>'
        : `<button type="button" class="israa-btn" data-israa-select-activity="${escapeHtml(sourceId)}" data-israa-tracking-id="${escapeHtml(draft.id)}">העבר לפעילויות</button>`}</td>`
      : '';
    return `<tr><td>${escapeHtml(item.program_name || '—')}</td><td>${escapeHtml(item.gefen_number || '—')}</td><td>${escapeHtml(item.quantity ?? '—')}</td>${action}</tr>`;
  }).join('');
  return `<table class="israa-drawer__activities"><thead><tr><th>שם הפעילות</th><th>מספר גפ״ן</th><th>מספר קבוצות</th>${selectable ? '<th>פעולה</th>' : ''}</tr></thead><tbody>${cells}</tbody></table>`;
}
