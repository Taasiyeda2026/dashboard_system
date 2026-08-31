import { supabase } from './supabase-client.js';

const ACTIVE_TAB_SELECTOR = '.israa-mgmt [data-israa-tab="activities"].is-active';
const FORM_SELECTOR = '.activity-drawer__form[data-row-id]';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function closeDrawer(form) {
  const drawer = form?.closest('.ds-drawer');
  const close = drawer?.querySelector('[data-ui-close-drawer], .ds-drawer__close, [aria-label="סגירה"]');
  close?.click();
}

async function isPrivateManualIsraaRow(rowId) {
  const { data, error } = await supabase
    .from('activities')
    .select('row_id,activity_domain,israa_shared,israa_tracking_id,israa_source_item_id,proposal_agreement_id,proposal_item_id')
    .eq('row_id', rowId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return clean(data.activity_domain) === 'E'
    && data.israa_shared === false
    && !data.israa_tracking_id
    && !data.israa_source_item_id
    && !data.proposal_agreement_id
    && !data.proposal_item_id;
}

async function decorateManualShareDrawer() {
  if (!document.querySelector(ACTIVE_TAB_SELECTOR)) return;
  const forms = Array.from(document.querySelectorAll(FORM_SELECTOR));
  for (const form of forms) {
    const rowId = clean(form.dataset.rowId);
    if (!rowId || rowId.startsWith('israa-draft|')) continue;
    if (form.dataset.israaManualShareChecked === 'yes' || form.dataset.israaManualShareChecked === 'pending') continue;
    form.dataset.israaManualShareChecked = 'pending';
    try {
      const eligible = await isPrivateManualIsraaRow(rowId);
      form.dataset.israaManualShareChecked = 'yes';
      if (!eligible || form.querySelector('[data-israa-manual-share-actions]')) continue;

      const bar = document.createElement('div');
      bar.className = 'israa-draft-special-actions';
      bar.dataset.israaManualShareActions = 'yes';
      bar.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-israa-manual-share>שתף לפעילויות</button>';
      form.prepend(bar);

      bar.querySelector('[data-israa-manual-share]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const { error } = await supabase.rpc('share_israa_manual_activity', { p_row_id: rowId });
          if (error) throw error;
          closeDrawer(form);
          window.dispatchEvent(new CustomEvent('israa-activities-changed'));
        } catch (error) {
          console.error('[israa-manual-share]', error);
          button.disabled = false;
          window.alert('לא ניתן לשתף את הפעילות כרגע.');
        }
      });
    } catch (error) {
      form.dataset.israaManualShareChecked = 'error';
      console.warn('[israa-manual-share] state check failed', error?.message || error);
    }
  }
}

function install() {
  if (typeof document === 'undefined' || globalThis.__israaManualShareRuntimeInstalled) return;
  globalThis.__israaManualShareRuntimeInstalled = true;
  void decorateManualShareDrawer();
  const observer = new MutationObserver(() => { void decorateManualShareDrawer(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

install();
