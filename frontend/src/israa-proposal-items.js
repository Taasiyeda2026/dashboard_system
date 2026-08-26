import { supabase } from './supabase-client.js';

const ACTION_BUTTON_STYLE = 'width:100%;max-width:100%;box-sizing:border-box;white-space:normal;line-height:1.2;padding:5px 6px';
let workspaceImportPromise = null;
let tourPricingImportPromise = null;

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

function ensureMainActivitiesWorkspace() {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!document.querySelector('.israa-mgmt [data-israa-tab="activities"].is-active')) return Promise.resolve();
  if (!workspaceImportPromise) {
    workspaceImportPromise = import('./israa-activities-main-workspace.js?v=20260824-v2')
      .catch((error) => {
        workspaceImportPromise = null;
        console.error('[israa-main-activities-loader]', error);
      });
  }
  return workspaceImportPromise;
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

function decorateTourPricingSimulatorButton() {
  if (typeof document === 'undefined') return;
  const management = document.querySelector('.israa-mgmt');
  if (!management || management.querySelector('[data-israa-tour-pricing]')) return;
  const toolbar = management.querySelector('.israa-toolbar');
  if (!toolbar) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'israa-btn';
  button.dataset.israaTourPricing = 'true';
  button.textContent = 'סימולטור סיורים';
  button.title = 'פתיחת סימולטור סיורים';
  toolbar.append(button);
}

async function openTourPricingSimulator() {
  try {
    if (!tourPricingImportPromise) {
      tourPricingImportPromise = import('./screens/admin-pricing-simulator.js')
        .catch((error) => {
          tourPricingImportPromise = null;
          throw error;
        });
    }
    const module = await tourPricingImportPromise;
    module.openAdminPricingSimulator?.();
  } catch (error) {
    console.error('[israa-tour-pricing-simulator]', error);
    window.alert('לא ניתן לפתוח את סימולטור הסיורים כרגע.');
  }
}

function installRuntimeSelectionBridge() {
  if (typeof document === 'undefined' || globalThis.__israaActivitySelectionBridgeInstalled) return;
  globalThis.__israaActivitySelectionBridgeInstalled = true;

  decoratePrivateDraftRemovalButtons();
  decorateTourPricingSimulatorButton();
  const observer = new MutationObserver(() => {
    decoratePrivateDraftRemovalButtons();
    decorateTourPricingSimulatorButton();
    ensureMainActivitiesWorkspace();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', async (event) => {
    const tourPricingButton = event.target?.closest?.('.israa-mgmt [data-israa-tour-pricing]');
    if (tourPricingButton) {
      event.preventDefault();
      event.stopPropagation();
      await openTourPricingSimulator();
      return;
    }

    const activitiesTab = event.target?.closest?.('.israa-mgmt [data-israa-tab="activities"]');
    if (activitiesTab) {
      setTimeout(() => ensureMainActivitiesWorkspace(), 0);
    }

    const selectButton = event.target?.closest?.('[data-israa-select-activity]');
    const inIsraaUi = selectButton && (selectButton.closest('.israa-mgmt') || selectButton.closest('.ds-drawer--israa-exact'));
    if (inIsraaUi) {
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
        selectButton.disabled = true;
        window.dispatchEvent(new CustomEvent('israa-activities-changed'));
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
      removeButton.closest('.israa-activity-card')?.remove();
      window.dispatchEvent(new CustomEvent('israa-activities-changed'));
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
        ? `<button type="button" class="israa-btn" style="${ACTION_BUTTON_STYLE}" disabled>כבר בפעילויות</button>`
        : `<button type="button" class="israa-btn" style="${ACTION_BUTTON_STYLE}" data-israa-select-activity="${escapeHtml(sourceId)}" data-israa-tracking-id="${escapeHtml(draft.id)}">העבר לפעילויות</button>`}</td>`
      : '';
    return `<tr><td>${escapeHtml(item.program_name || '—')}</td><td>${escapeHtml(item.gefen_number || '—')}</td><td>${escapeHtml(item.quantity ?? '—')}</td>${action}</tr>`;
  }).join('');
  const widths = selectable ? ['43%', '18%', '14%', '25%'] : ['60%', '23%', '17%'];
  return `<table class="israa-drawer__activities"><thead><tr><th style="width:${widths[0]}">שם הפעילות</th><th style="width:${widths[1]}">מספר גפ״ן</th><th style="width:${widths[2]}">מספר קבוצות</th>${selectable ? `<th style="width:${widths[3]}">פעולה</th>` : ''}</tr></thead><tbody>${cells}</tbody></table>`;
}
