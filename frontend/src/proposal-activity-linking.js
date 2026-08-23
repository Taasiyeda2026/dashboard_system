import { supabase } from './supabase-client.js';
import { state, clearScreenDataCache } from './state.js';
import { canAddActivityDirect } from './permissions.js';
import { showToast } from './screens/shared/toast.js';
import { escapeHtml } from './screens/shared/html.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ELIGIBLE_STATUSES = new Set(['approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח']);
const TEST_HOURS_RE = /(שעות\s*)?בדיק(ה|ות)?/i;
const CREATOR_ATTR = 'data-proposal-activity-creator';
const ENHANCEMENT_DEBOUNCE_MS = 120;

let enhancementTimer = null;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function quotedActivityCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function canCreateActivitiesFromProposal() {
  return canAddActivityDirect(state?.user);
}

function normalizedProposalGroup(value) {
  const raw = clean(value);
  const lower = raw.toLowerCase();
  if (['next_year', 'gefen', 'combined'].includes(lower)) return lower;
  if ([
    'תשפ"ז', 'תשפ״ז',
    'שנת הלימודים תשפ"ז', 'שנת הלימודים תשפ״ז',
    'תוכניות תשפ"ז', 'תוכניות תשפ״ז'
  ].includes(raw)) return 'next_year';
  if (['גפן', 'גפ"ן', 'גפ״ן'].includes(raw)) return 'gefen';
  if (['summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו'].includes(lower)
    || ['קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו'].includes(raw)) return 'summer';
  return lower;
}

function normalizedStatus(value) {
  return clean(value).toLowerCase();
}

function isEligibleProposal(proposal) {
  if (!proposal || proposal.archived_at) return false;
  if (!ELIGIBLE_STATUSES.has(normalizedStatus(proposal.status))) return false;
  return ['next_year', 'gefen', 'combined'].includes(normalizedProposalGroup(proposal.activity_type_group));
}

function isEligibleProposalItem(item, proposal) {
  if (!item?.id || TEST_HOURS_RE.test(clean(item.item_name))) return false;
  const itemGroup = normalizedProposalGroup(item.proposal_group);
  if (itemGroup === 'summer') return false;
  if (normalizedProposalGroup(proposal?.activity_type_group) === 'combined') {
    return itemGroup === 'next_year' || itemGroup === 'gefen';
  }
  return true;
}

function toast(message, type = 'success') {
  try {
    showToast(message, type);
  } catch {
    console[type === 'error' ? 'error' : 'info'](message);
  }
}

function injectStyles() {
  if (document.getElementById('proposal-activity-linking-styles')) return;
  const style = document.createElement('style');
  style.id = 'proposal-activity-linking-styles';
  style.textContent = `
    .proposal-activity-creator {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--ds-border, #d7dde5);
      border-radius: 12px;
      background: var(--ds-surface, #fff);
    }
    .proposal-activity-creator__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .proposal-activity-creator__title {
      margin: 0;
      font-size: .98rem;
      font-weight: 800;
    }
    .proposal-activity-creator__item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--ds-border, #e5e7eb);
    }
    .proposal-activity-creator__item:first-of-type { border-top: 0; }
    .proposal-activity-creator__name {
      min-width: 0;
      font-weight: 700;
    }
    .proposal-activity-creator__meta {
      display: block;
      margin-top: 2px;
      color: #64748b;
      font-size: .76rem;
    }
    .proposal-activity-creator__button {
      min-width: 138px;
      border: 0;
      border-radius: 9px;
      padding: 7px 11px;
      background: #1f2937;
      color: #fff;
      font: inherit;
      font-size: .82rem;
      font-weight: 700;
      cursor: pointer;
    }
    .proposal-activity-creator__button[disabled] {
      background: #e5e7eb;
      color: #475569;
      cursor: default;
    }
    @media (max-width: 900px) {
      .proposal-activity-creator__item { grid-template-columns: 1fr; }
      .proposal-activity-creator__button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function labelledValue(root, acceptedLabels) {
  const labels = new Set(acceptedLabels.map(clean));
  const cells = root.querySelectorAll('.ds-pa-info-cell');
  for (const cell of cells) {
    const label = clean(cell.querySelector('.ds-pa-info-label')?.textContent);
    if (!labels.has(label)) continue;
    return clean(cell.querySelector('.ds-pa-info-value')?.textContent);
  }
  return '';
}

function proposalIdFromElement(root) {
  const nodes = [root, ...root.querySelectorAll('*')];
  for (const node of nodes) {
    for (const attributeName of node.getAttributeNames?.() || []) {
      if (!/proposal/i.test(attributeName)) continue;
      const value = clean(node.getAttribute(attributeName));
      if (UUID_RE.test(value)) return value;
    }
  }
  return '';
}

async function readProposalForDetail(root) {
  const proposalId = proposalIdFromElement(root);
  const columns = 'id,quote_number,status,activity_type_group,archived_at,version_number';
  if (proposalId) {
    const { data, error } = await supabase
      .from('proposals_agreements')
      .select(columns)
      .eq('id', proposalId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  const quoteNumber = labelledValue(root, ['מספר הצעה', 'מספר הצעת מחיר', 'מס׳ הצעה']);
  if (!quoteNumber) return null;
  const { data, error } = await supabase
    .from('proposals_agreements')
    .select(columns)
    .eq('quote_number', quoteNumber)
    .is('archived_at', null)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function readProposalActivityData(proposalId) {
  const [{ data: items, error: itemsError }, { data: activities, error: activitiesError }] = await Promise.all([
    supabase
      .from('proposal_agreement_items')
      .select('id,proposal_agreement_id,item_name,item_type,gefen_number,activity_no,list_id,meetings_count,hours_count,quantity,unit_price,total_price,proposal_group,sort_order')
      .eq('proposal_agreement_id', proposalId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('activities')
      .select('row_id,proposal_agreement_id,proposal_item_id,proposal_item_sequence,exists_in_gefen')
      .eq('proposal_agreement_id', proposalId)
  ]);
  if (itemsError) throw itemsError;
  if (activitiesError) throw activitiesError;
  return {
    items: Array.isArray(items) ? items : [],
    activities: Array.isArray(activities) ? activities : []
  };
}

function proposalCreatorHost(root) {
  const items = root.querySelector('[data-pa-drawer-items]');
  if (items) return items.closest('.ds-pa-info-card') || items.parentElement || root;
  return root.querySelector('.ds-pa-activities-wide') || root;
}

function proposalItemMeta(item) {
  const parts = [];
  const count = quotedActivityCount(item.quantity);
  parts.push(count === 1 ? 'קבוצה אחת' : `${count} קבוצות`);
  if (clean(item.gefen_number)) parts.push(`מס׳ גפ״ן ${clean(item.gefen_number)}`);
  if (item.meetings_count != null) parts.push(`${clean(item.meetings_count)} מפגשים`);
  return parts.join(' · ');
}

function activitiesByProposalItem(activities) {
  const grouped = new Map();
  for (const activity of activities) {
    const itemId = clean(activity.proposal_item_id);
    if (!itemId) continue;
    const rows = grouped.get(itemId) || [];
    rows.push(activity);
    grouped.set(itemId, rows);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => Number(a.proposal_item_sequence || 0) - Number(b.proposal_item_sequence || 0));
  }
  return grouped;
}

function creationButtonText(requiredCount, createdCount) {
  const remaining = Math.max(0, requiredCount - createdCount);
  if (remaining === 0) return requiredCount === 1 ? 'הפעילות נוצרה' : `${requiredCount} פעילויות נוצרו`;
  return remaining === 1 ? 'יצירת פעילות' : `יצירת ${remaining} פעילויות`;
}

function renderProposalCreator(root, proposal, data) {
  root.querySelector(`[${CREATOR_ATTR}]`)?.remove();

  const eligibleItems = data.items.filter((item) => isEligibleProposalItem(item, proposal));
  if (!eligibleItems.length) return;

  const byItemId = activitiesByProposalItem(data.activities);
  const card = document.createElement('section');
  card.className = 'proposal-activity-creator';
  card.setAttribute(CREATOR_ATTR, proposal.id);

  card.innerHTML = `
    <div class="proposal-activity-creator__head">
      <h3 class="proposal-activity-creator__title">פעילויות 2027</h3>
    </div>
    ${eligibleItems.map((item) => {
      const requiredCount = quotedActivityCount(item.quantity);
      const activities = byItemId.get(clean(item.id)) || [];
      const createdCount = activities.length;
      const complete = createdCount >= requiredCount;
      const existsCount = activities.filter((activity) => activity.exists_in_gefen === true).length;
      const createdMeta = createdCount
        ? [
            `${Math.min(createdCount, requiredCount)} מתוך ${requiredCount} פעילויות נוצרו`,
            existsCount ? `${existsCount} סומנו כקיימות בגפ״ן` : ''
          ].filter(Boolean).join(' · ')
        : proposalItemMeta(item);
      return `
        <div class="proposal-activity-creator__item" data-proposal-item-id="${clean(item.id)}">
          <div class="proposal-activity-creator__name">
            ${escapeHtml(clean(item.item_name))}
            ${createdMeta ? `<span class="proposal-activity-creator__meta">${escapeHtml(createdMeta)}</span>` : ''}
          </div>
          <button type="button"
            class="proposal-activity-creator__button"
            data-create-activity-from-proposal-item="${clean(item.id)}"
            ${complete || !canCreateActivitiesFromProposal() ? 'disabled' : ''}>
            ${creationButtonText(requiredCount, createdCount)}
          </button>
        </div>
      `;
    }).join('')}
  `;

  card.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-create-activity-from-proposal-item]');
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const proposalItemId = clean(button.getAttribute('data-create-activity-from-proposal-item'));
    if (!UUID_RE.test(proposalItemId)) return;

    button.disabled = true;
    button.textContent = 'יוצר פעילויות…';
    const { data: result, error } = await supabase.rpc('create_activity_from_proposal_item', {
      p_proposal_item_id: proposalItemId
    });
    if (error) {
      console.error('[proposal-activity-create]', error);
      button.disabled = false;
      button.textContent = 'יצירת פעילות';
      toast(error.message || 'יצירת הפעילויות נכשלה.', 'error');
      return;
    }

    clearScreenDataCache();
    const createdCount = Number(result?.created_count || 0);
    if (createdCount <= 0) toast('כל שורות הפעילות כבר קיימות.');
    else if (createdCount === 1) toast('שורת הפעילות נוצרה בהצלחה.');
    else toast(`${createdCount} שורות פעילות נוצרו בהצלחה.`);

    root.removeAttribute('data-proposal-activity-loaded');
    scheduleEnhancements();
  });

  const host = proposalCreatorHost(root);
  host.insertAdjacentElement('afterend', card);
  root.setAttribute('data-proposal-activity-loaded', proposal.id);
}

async function enhanceProposalDetail(root) {
  if (!supabase || root.getAttribute('data-proposal-activity-loading') === 'true') return;
  root.setAttribute('data-proposal-activity-loading', 'true');
  try {
    const proposal = await readProposalForDetail(root);
    if (!proposal || !isEligibleProposal(proposal)) {
      root.querySelector(`[${CREATOR_ATTR}]`)?.remove();
      return;
    }
    if (root.getAttribute('data-proposal-activity-loaded') === proposal.id
      && root.querySelector(`[${CREATOR_ATTR}="${proposal.id}"]`)) return;
    const data = await readProposalActivityData(proposal.id);
    renderProposalCreator(root, proposal, data);
  } catch (error) {
    console.error('[proposal-activity-enhancement]', error);
  } finally {
    root.removeAttribute('data-proposal-activity-loading');
  }
}

async function runEnhancements() {
  injectStyles();
  const proposalDetails = [...document.querySelectorAll('#app [data-pa-proposal-detail]')];
  await Promise.all(proposalDetails.map(enhanceProposalDetail));
}

function scheduleEnhancements() {
  clearTimeout(enhancementTimer);
  enhancementTimer = setTimeout(() => {
    runEnhancements().catch((error) => console.error('[proposal-activity-linking]', error));
  }, ENHANCEMENT_DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleEnhancements, { once: true });
} else {
  scheduleEnhancements();
}

new MutationObserver(scheduleEnhancements).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', scheduleEnhancements);
