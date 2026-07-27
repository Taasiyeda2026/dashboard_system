import { supabase } from './supabase-client.js';
import { state, clearScreenDataCache } from './state.js';
import { canAddActivityDirect, canEditDirect } from './permissions.js';
import { showToast } from './screens/shared/toast.js';
import { escapeHtml } from './screens/shared/html.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ELIGIBLE_STATUSES = new Set(['approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח']);
const TEST_HOURS_RE = /(שעות\s*)?בדיק(ה|ות)?/i;
const CREATOR_ATTR = 'data-proposal-activity-creator';
const TABLE_COLUMN_ATTR = 'data-activity-gefen-column';
const ENHANCEMENT_DEBOUNCE_MS = 120;

let enhancementTimer = null;
let activityTableEnhancementRunning = false;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function role() {
  return clean(state?.user?.display_role || state?.user?.role);
}

function canCreateActivitiesFromProposal() {
  return canAddActivityDirect(state?.user)
    || ['admin', 'operation_manager', 'domain_manager'].includes(role());
}

function canEditGefenFields() {
  return canEditDirect(state?.user);
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
  if (['summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו'].includes(lower) || ['קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו'].includes(raw)) return 'summer';
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
    .proposal-activity-creator__approval {
      font-size: .78rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .proposal-activity-creator__approval.is-ready { color: #047857; }
    .proposal-activity-creator__approval.is-missing { color: #64748b; }
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
      min-width: 122px;
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
    th[${TABLE_COLUMN_ATTR}],
    td[${TABLE_COLUMN_ATTR}] {
      min-width: 178px;
      vertical-align: middle;
    }
    .activity-gefen-cell {
      display: grid;
      gap: 5px;
      font-size: .76rem;
      line-height: 1.25;
    }
    .activity-gefen-cell__checks {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
    }
    .activity-gefen-cell label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      cursor: pointer;
    }
    .activity-gefen-cell input[type="checkbox"] {
      margin: 0;
    }
    .activity-gefen-cell__order {
      width: 100%;
      min-width: 125px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 4px 6px;
      font: inherit;
      font-size: .75rem;
    }
    .activity-gefen-cell__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 5px 8px;
      color: #64748b;
      font-size: .7rem;
    }
    .activity-gefen-cell__approval.is-ready { color: #047857; font-weight: 700; }
    .activity-gefen-cell__readonly { color: #475569; }
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
  const [{ data: items, error: itemsError }, { data: activities, error: activitiesError }, { data: approval, error: approvalError }] = await Promise.all([
    supabase
      .from('proposal_agreement_items')
      .select('id,proposal_agreement_id,item_name,item_type,gefen_number,meetings_count,hours_count,total_price,proposal_group,sort_order')
      .eq('proposal_agreement_id', proposalId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('activities')
      .select('row_id,proposal_agreement_id,proposal_item_id,is_gefen_funded,exists_in_gefen,gefen_order_number')
      .eq('proposal_agreement_id', proposalId),
    supabase
      .from('proposal_linked_documents')
      .select('id,status')
      .eq('proposal_agreement_id', proposalId)
      .eq('document_type', 'gefen_approval')
      .limit(1)
      .maybeSingle()
  ]);
  if (itemsError) throw itemsError;
  if (activitiesError) throw activitiesError;
  if (approvalError && approvalError.code !== 'PGRST116') throw approvalError;
  return {
    items: Array.isArray(items) ? items : [],
    activities: Array.isArray(activities) ? activities : [],
    hasGefenApproval: clean(approval?.status) === 'generated'
  };
}

function proposalCreatorHost(root) {
  const items = root.querySelector('[data-pa-drawer-items]');
  if (items) return items.closest('.ds-pa-info-card') || items.parentElement || root;
  return root.querySelector('.ds-pa-activities-wide') || root;
}

function proposalItemMeta(item) {
  const parts = [];
  if (clean(item.gefen_number)) parts.push(`מס׳ גפ״ן ${clean(item.gefen_number)}`);
  if (item.meetings_count != null) parts.push(`${clean(item.meetings_count)} מפגשים`);
  return parts.join(' · ');
}

function renderProposalCreator(root, proposal, data) {
  root.querySelector(`[${CREATOR_ATTR}]`)?.remove();

  const eligibleItems = data.items.filter((item) => isEligibleProposalItem(item, proposal));
  if (!eligibleItems.length) return;

  const byItemId = new Map(data.activities.map((activity) => [clean(activity.proposal_item_id), activity]));
  const card = document.createElement('section');
  card.className = 'proposal-activity-creator';
  card.setAttribute(CREATOR_ATTR, proposal.id);
  const approvalClass = data.hasGefenApproval ? 'is-ready' : 'is-missing';
  const approvalText = data.hasGefenApproval ? 'אישור גפ״ן קיים' : 'אישור גפ״ן טרם הופק';

  card.innerHTML = `
    <div class="proposal-activity-creator__head">
      <h3 class="proposal-activity-creator__title">פעילויות 2027</h3>
      <span class="proposal-activity-creator__approval ${approvalClass}">${approvalText}</span>
    </div>
    ${eligibleItems.map((item) => {
      const activity = byItemId.get(clean(item.id));
      const meta = proposalItemMeta(item);
      const gefenState = activity?.is_gefen_funded
        ? (activity?.exists_in_gefen ? 'קיים בגפ״ן' : 'מימון גפ״ן · טרם הוזן')
        : '';
      const createdMeta = activity
        ? [clean(activity.row_id), gefenState].filter(Boolean).join(' · ')
        : meta;
      return `
        <div class="proposal-activity-creator__item" data-proposal-item-id="${clean(item.id)}">
          <div class="proposal-activity-creator__name">
            ${escapeHtml(clean(item.item_name))}
            ${createdMeta ? `<span class="proposal-activity-creator__meta">${escapeHtml(createdMeta)}</span>` : ''}
          </div>
          <button type="button"
            class="proposal-activity-creator__button"
            data-create-activity-from-proposal-item="${clean(item.id)}"
            ${activity || !canCreateActivitiesFromProposal() ? 'disabled' : ''}>
            ${activity ? 'הפעילות נוצרה' : 'יצירת פעילות'}
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
    button.textContent = 'יוצר פעילות…';
    const { data: result, error } = await supabase.rpc('create_activity_from_proposal_item', {
      p_proposal_item_id: proposalItemId
    });
    if (error) {
      console.error('[proposal-activity-create]', error);
      button.disabled = false;
      button.textContent = 'יצירת פעילות';
      toast(error.message || 'יצירת הפעילות נכשלה.', 'error');
      return;
    }

    clearScreenDataCache();
    const activity = result?.activity || result?.[0]?.activity || null;
    toast(result?.created === false ? 'הפעילות כבר קיימת.' : 'שורת הפעילות נוצרה בהצלחה.');
    button.textContent = 'הפעילות נוצרה';
    button.disabled = true;
    if (activity?.row_id) {
      const meta = button.closest('.proposal-activity-creator__item')?.querySelector('.proposal-activity-creator__meta');
      if (meta) meta.textContent = clean(activity.row_id);
    }
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

function activityRowId(tableRow) {
  const direct = clean(tableRow.dataset?.rowId || tableRow.getAttribute('data-row-id'));
  if (direct) return direct;
  const nested = tableRow.querySelector('[data-row-id]');
  return clean(nested?.getAttribute('data-row-id'));
}

function activityCellMeta(activity, quoteByProposalId, approvalProposalIds) {
  const proposalId = clean(activity.proposal_agreement_id);
  const quote = proposalId ? clean(quoteByProposalId.get(proposalId)) : '';
  const hasApproval = proposalId && approvalProposalIds.has(proposalId);
  return { quote, hasApproval };
}

async function updateActivityGefen(activity, patch) {
  const rowId = clean(activity.row_id);
  if (!rowId) return null;
  const normalizedPatch = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('activities')
    .update(normalizedPatch)
    .eq('row_id', rowId)
    .select('row_id,proposal_agreement_id,proposal_item_id,is_gefen_funded,exists_in_gefen,gefen_order_number,funding,activity_season')
    .single();
  if (error) throw error;
  clearScreenDataCache();
  return data;
}

function renderActivityGefenCell(cell, activity, meta) {
  const editable = canEditGefenFields();
  const isFunded = activity.is_gefen_funded === true;
  const exists = activity.exists_in_gefen === true;
  const orderNumber = clean(activity.gefen_order_number);

  cell.innerHTML = `
    <div class="activity-gefen-cell" data-gefen-row-id="${clean(activity.row_id)}">
      <div class="activity-gefen-cell__checks">
        <label title="הפעילות ממומנת באמצעות גפ״ן">
          <input type="checkbox" data-gefen-field="is_gefen_funded" ${isFunded ? 'checked' : ''} ${editable ? '' : 'disabled'}>
          מימון גפ״ן
        </label>
        <label title="הפעילות או ההזמנה קיימת בפועל במערכת גפ״ן">
          <input type="checkbox" data-gefen-field="exists_in_gefen" ${exists ? 'checked' : ''} ${editable ? '' : 'disabled'}>
          קיים בגפ״ן
        </label>
      </div>
      <input class="activity-gefen-cell__order"
        type="text"
        data-gefen-field="gefen_order_number"
        value="${escapeHtml(orderNumber)}"
        placeholder="מספר הזמנת גפ״ן"
        ${editable && exists ? '' : 'disabled'}>
      <div class="activity-gefen-cell__meta">
        ${meta.quote ? `<span>הצעה ${escapeHtml(meta.quote)}</span>` : ''}
        ${meta.hasApproval ? '<span class="activity-gefen-cell__approval is-ready">אישור גפ״ן קיים</span>' : ''}
        ${editable ? '' : '<span class="activity-gefen-cell__readonly">לצפייה בלבד</span>'}
      </div>
    </div>
  `;

  cell.querySelectorAll('input').forEach((input) => {
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => event.stopPropagation());
  });

  const fundedInput = cell.querySelector('[data-gefen-field="is_gefen_funded"]');
  const existsInput = cell.querySelector('[data-gefen-field="exists_in_gefen"]');
  const orderInput = cell.querySelector('[data-gefen-field="gefen_order_number"]');

  fundedInput?.addEventListener('change', async () => {
    try {
      const checked = fundedInput.checked;
      const patch = checked
        ? { is_gefen_funded: true, funding: 'גפן' }
        : {
            is_gefen_funded: false,
            exists_in_gefen: false,
            gefen_order_number: null,
            funding: clean(activity.funding) === 'גפן' ? null : activity.funding
          };
      const saved = await updateActivityGefen(activity, patch);
      Object.assign(activity, saved || patch);
      renderActivityGefenCell(cell, activity, meta);
      toast('נתוני גפ״ן נשמרו.');
    } catch (error) {
      console.error('[activity-gefen-update]', error);
      fundedInput.checked = !fundedInput.checked;
      toast(error.message || 'שמירת נתוני גפ״ן נכשלה.', 'error');
    }
  });

  existsInput?.addEventListener('change', async () => {
    try {
      const checked = existsInput.checked;
      const patch = checked
        ? { is_gefen_funded: true, exists_in_gefen: true, funding: 'גפן' }
        : { exists_in_gefen: false };
      const saved = await updateActivityGefen(activity, patch);
      Object.assign(activity, saved || patch);
      renderActivityGefenCell(cell, activity, meta);
      toast('נתוני גפ״ן נשמרו.');
    } catch (error) {
      console.error('[activity-gefen-update]', error);
      existsInput.checked = !existsInput.checked;
      toast(error.message || 'שמירת נתוני גפ״ן נכשלה.', 'error');
    }
  });

  const saveOrderNumber = async () => {
    const nextValue = clean(orderInput?.value);
    if (nextValue === clean(activity.gefen_order_number)) return;
    try {
      const saved = await updateActivityGefen(activity, {
        is_gefen_funded: true,
        exists_in_gefen: true,
        funding: 'גפן',
        gefen_order_number: nextValue || null
      });
      Object.assign(activity, saved || { gefen_order_number: nextValue });
      renderActivityGefenCell(cell, activity, meta);
      toast('מספר הזמנת גפ״ן נשמר.');
    } catch (error) {
      console.error('[activity-gefen-order-update]', error);
      if (orderInput) orderInput.value = clean(activity.gefen_order_number);
      toast(error.message || 'שמירת מספר ההזמנה נכשלה.', 'error');
    }
  };

  orderInput?.addEventListener('blur', saveOrderNumber);
  orderInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      orderInput.blur();
    }
  });
}

async function enhanceActivityTable(table) {
  const tableRows = [...table.querySelectorAll('tbody tr')];
  const rowIds = tableRows.map(activityRowId).filter(Boolean);
  if (!rowIds.length) return;

  const signature = rowIds.join('|');
  if (table.getAttribute('data-gefen-enhanced-signature') === signature) return;
  table.setAttribute('data-gefen-enhanced-signature', `loading:${signature}`);

  const { data: activities, error } = await supabase
    .from('activities')
    .select('row_id,proposal_agreement_id,proposal_item_id,is_gefen_funded,exists_in_gefen,gefen_order_number,funding,activity_season')
    .in('row_id', rowIds);
  if (error) {
    table.removeAttribute('data-gefen-enhanced-signature');
    throw error;
  }

  const school2027 = (Array.isArray(activities) ? activities : [])
    .filter((activity) => clean(activity.activity_season) === 'school_2027');
  if (!school2027.length) {
    table.setAttribute('data-gefen-enhanced-signature', signature);
    return;
  }

  const proposalIds = [...new Set(school2027.map((activity) => clean(activity.proposal_agreement_id)).filter(Boolean))];
  const quoteByProposalId = new Map();
  const approvalProposalIds = new Set();

  if (proposalIds.length) {
    const [{ data: proposals, error: proposalsError }, { data: approvals, error: approvalsError }] = await Promise.all([
      supabase.from('proposals_agreements').select('id,quote_number').in('id', proposalIds),
      supabase
        .from('proposal_linked_documents')
        .select('proposal_agreement_id,status')
        .in('proposal_agreement_id', proposalIds)
        .eq('document_type', 'gefen_approval')
        .eq('status', 'generated')
    ]);
    if (proposalsError) throw proposalsError;
    if (approvalsError) throw approvalsError;
    (proposals || []).forEach((proposal) => quoteByProposalId.set(clean(proposal.id), clean(proposal.quote_number)));
    (approvals || []).forEach((approval) => approvalProposalIds.add(clean(approval.proposal_agreement_id)));
  }

  const headRow = table.querySelector('thead tr:last-child');
  let headCell = headRow?.querySelector(`th[${TABLE_COLUMN_ATTR}]`);
  if (headRow && !headCell) {
    headCell = document.createElement('th');
    headCell.setAttribute(TABLE_COLUMN_ATTR, 'true');
    headCell.scope = 'col';
    headCell.textContent = 'גפ״ן';
    headRow.appendChild(headCell);
  }

  const byRowId = new Map(school2027.map((activity) => [clean(activity.row_id), activity]));
  tableRows.forEach((tableRow) => {
    const rowId = activityRowId(tableRow);
    let cell = tableRow.querySelector(`td[${TABLE_COLUMN_ATTR}]`);
    if (!cell) {
      cell = document.createElement('td');
      cell.setAttribute(TABLE_COLUMN_ATTR, 'true');
      tableRow.appendChild(cell);
    }
    const activity = byRowId.get(rowId);
    if (!activity) {
      cell.textContent = '—';
      return;
    }
    renderActivityGefenCell(cell, activity, activityCellMeta(activity, quoteByProposalId, approvalProposalIds));
  });

  table.setAttribute('data-gefen-enhanced-signature', signature);
}

async function enhanceActivityTables() {
  if (!supabase || activityTableEnhancementRunning) return;
  activityTableEnhancementRunning = true;
  try {
    const tables = [...document.querySelectorAll('#app table')];
    for (const table of tables) {
      try {
        await enhanceActivityTable(table);
      } catch (error) {
        console.error('[activity-gefen-table-enhancement]', error);
      }
    }
  } finally {
    activityTableEnhancementRunning = false;
  }
}

async function runEnhancements() {
  injectStyles();
  const proposalDetails = [...document.querySelectorAll('#app [data-pa-proposal-detail]')];
  await Promise.all(proposalDetails.map(enhanceProposalDetail));
  await enhanceActivityTables();
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
