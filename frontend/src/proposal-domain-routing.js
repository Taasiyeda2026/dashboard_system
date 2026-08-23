import { supabase } from './supabase-client.js';
import { state, clearScreenDataCache } from './state.js';
import { showToast } from './screens/shared/toast.js';
import { escapeHtml } from './screens/shared/html.js';
import { hasPermission } from './permission-policy.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ELIGIBLE_STATUSES = new Set(['approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח']);
const ROUTING_ATTR = 'data-proposal-domain-routing';
const CREATOR_ATTR = 'data-proposal-activity-creator';
const DEBOUNCE_MS = 90;

let timer = null;
let running = false;
const proposalCache = new Map();

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'yes' || value === 'true';
}

function normalizedStatus(value) {
  return clean(value).toLowerCase();
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
  return lower;
}

function canRouteToIsraa() {
  return hasPermission(state?.user, 'manage_proposals_agreements')
    && hasPermission(state?.user, 'view_israa_management');
}

function toast(message, type = 'success') {
  try {
    showToast(message, type);
  } catch {
    console[type === 'error' ? 'error' : 'info'](message);
  }
}

function injectStyles() {
  if (document.getElementById('proposal-domain-routing-styles')) return;
  const style = document.createElement('style');
  style.id = 'proposal-domain-routing-styles';
  style.textContent = `
    .proposal-israa-routing {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--ds-border, #d7dde5);
      border-radius: 12px;
      background: var(--ds-surface, #fff);
    }
    .proposal-israa-routing__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .proposal-israa-routing__title {
      margin: 0;
      font-size: .96rem;
      font-weight: 800;
    }
    .proposal-israa-routing__domain {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 23px;
      padding: 0 7px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #075985;
      font-size: .72rem;
      font-weight: 800;
    }
    .proposal-israa-routing__body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
    }
    .proposal-israa-routing__summary {
      min-width: 0;
      color: #475569;
      font-size: .8rem;
      line-height: 1.45;
    }
    .proposal-israa-routing__button {
      min-width: 190px;
      border: 0;
      border-radius: 9px;
      padding: 8px 12px;
      background: #0f766e;
      color: #fff;
      font: inherit;
      font-size: .82rem;
      font-weight: 800;
      cursor: pointer;
    }
    .proposal-israa-routing__button[disabled] {
      background: #e5e7eb;
      color: #64748b;
      cursor: default;
    }
    @media (max-width: 900px) {
      .proposal-israa-routing__body { grid-template-columns: 1fr; }
      .proposal-israa-routing__button { width: 100%; }
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

async function readProposal(root) {
  const proposalId = proposalIdFromElement(root);
  const quoteNumber = labelledValue(root, ['מספר הצעה', 'מספר הצעת מחיר', 'מס׳ הצעה']);
  const cacheKey = proposalId || `quote:${quoteNumber}`;
  const cached = proposalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30_000) return cached.row;

  const columns = [
    'id', 'quote_number', 'status', 'activity_type_group', 'proposal_domain',
    'archived_at', 'version_number', 'school_framework', 'client_authority', 'total_amount'
  ].join(',');

  let query = supabase.from('proposals_agreements').select(columns);
  if (proposalId) {
    query = query.eq('id', proposalId).maybeSingle();
  } else if (quoteNumber) {
    query = query
      .eq('quote_number', quoteNumber)
      .is('archived_at', null)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error) throw error;
  const row = data || null;
  proposalCache.set(cacheKey, { at: Date.now(), row });
  return row;
}

function proposalCreatorHost(root) {
  const items = root.querySelector('[data-pa-drawer-items]');
  if (items) return items.closest('.ds-pa-info-card') || items.parentElement || root;
  return root.querySelector('.ds-pa-activities-wide') || root;
}

function isEligible2027Proposal(proposal) {
  if (!proposal || proposal.archived_at) return false;
  if (!ELIGIBLE_STATUSES.has(normalizedStatus(proposal.status))) return false;
  return ['next_year', 'gefen', 'combined'].includes(normalizedProposalGroup(proposal.activity_type_group));
}

function clearOurRouting(root) {
  root.querySelector(`[${CREATOR_ATTR}][${ROUTING_ATTR}]`)?.remove();
  root.removeAttribute('data-proposal-domain-routing-loaded');
}

function renderIsraaRouting(root, proposal) {
  const signature = `${proposal.id}:E:${normalizedStatus(proposal.status)}`;
  const existing = root.querySelector(`[${CREATOR_ATTR}][${ROUTING_ATTR}="E"]`);
  if (existing && root.getAttribute('data-proposal-domain-routing-loaded') === signature) {
    root.setAttribute('data-proposal-activity-loaded', proposal.id);
    return;
  }

  root.querySelector(`[${CREATOR_ATTR}]`)?.remove();

  const card = document.createElement('section');
  card.className = 'proposal-israa-routing';
  card.setAttribute(CREATOR_ATTR, proposal.id);
  card.setAttribute(ROUTING_ATTR, 'E');

  const quote = clean(proposal.quote_number);
  const school = clean(proposal.school_framework);
  const authority = clean(proposal.client_authority);
  const summary = [quote ? `הצעה ${quote}` : '', school, authority].filter(Boolean).join(' · ');
  const permitted = canRouteToIsraa();

  card.innerHTML = `
    <div class="proposal-israa-routing__head">
      <h3 class="proposal-israa-routing__title">מעקב הצעות גפ״ן – תשפ״ז</h3>
      <span class="proposal-israa-routing__domain">E</span>
    </div>
    <div class="proposal-israa-routing__body">
      <div class="proposal-israa-routing__summary">
        ${escapeHtml(summary || 'הצעה בתחום E')}
        <br>ההצעה תתווסף לטבלת המעקב של איסראא ולא למסך כל הפעילויות.
      </div>
      <button type="button"
        class="proposal-israa-routing__button"
        data-route-proposal-to-israa="${escapeHtml(proposal.id)}"
        ${permitted ? '' : 'disabled'}>
        ${permitted ? 'הוספה / עדכון במעקב איסראא' : 'אין הרשאה להוספה'}
      </button>
    </div>
  `;

  card.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-route-proposal-to-israa]');
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'מעדכן את המעקב…';

    try {
      const { data: result, error } = await supabase.rpc('create_israa_tracking_from_proposal', {
        p_proposal_id: proposal.id
      });
      if (error) throw error;

      clearScreenDataCache();
      window.dispatchEvent(new CustomEvent('israa-tracking-updated', {
        detail: { proposalId: proposal.id, row: result?.row || null }
      }));

      button.textContent = result?.created ? 'נוסף למעקב איסראא' : 'עודכן במעקב איסראא';
      toast(result?.created ? 'ההצעה נוספה למעקב איסראא.' : 'ההצעה עודכנה במעקב איסראא.');
      setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.textContent = 'עדכון במעקב איסראא';
      }, 1400);
    } catch (error) {
      console.error('[proposal-domain-e-israa-routing]', error);
      button.disabled = false;
      button.textContent = originalText;
      toast(error?.message || 'הוספת ההצעה למעקב איסראא נכשלה.', 'error');
    }
  });

  proposalCreatorHost(root).insertAdjacentElement('afterend', card);
  root.setAttribute('data-proposal-domain-routing-loaded', signature);
  root.setAttribute('data-proposal-activity-loaded', proposal.id);
}

async function enhanceProposalDetail(root) {
  if (!supabase || root.getAttribute('data-proposal-domain-routing-loading') === 'true') return;
  root.setAttribute('data-proposal-domain-routing-loading', 'true');
  try {
    const proposal = await readProposal(root);
    if (!proposal) return;

    const domain = clean(proposal.proposal_domain).toUpperCase();
    if (domain === 'Y') {
      clearOurRouting(root);
      return;
    }

    if (domain !== 'E' || !isEligible2027Proposal(proposal)) {
      root.querySelector(`[${CREATOR_ATTR}]`)?.remove();
      root.removeAttribute('data-proposal-activity-loaded');
      clearOurRouting(root);
      return;
    }

    renderIsraaRouting(root, proposal);
  } catch (error) {
    console.error('[proposal-domain-routing]', error);
  } finally {
    root.removeAttribute('data-proposal-domain-routing-loading');
  }
}

async function run() {
  if (running) return;
  running = true;
  try {
    injectStyles();
    const roots = [...document.querySelectorAll('#app [data-pa-proposal-detail]')];
    for (const root of roots) await enhanceProposalDetail(root);
  } finally {
    running = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    run().catch((error) => console.error('[proposal-domain-routing-run]', error));
  }, DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
} else {
  schedule();
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', schedule);
