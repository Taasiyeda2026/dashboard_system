import { api } from './api.js';

const NEXT_YEAR_GROUPS = new Set(['next_year_courses', 'next_year_workshops']);
let pricingRows = [];
let refreshTimer = null;

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function numberValue(value) {
  const parsed = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `₪ ${Number(value || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function groupOf(row) {
  return text(row?.closest?.('[data-pa-items-group]')?.dataset?.paItemsGroup || row?.querySelector?.('[name="proposal_group"]')?.value);
}

function field(row, name) {
  return text(row?.querySelector?.(`[name="${name}"]`)?.value);
}

function setField(row, name, value) {
  const input = row?.querySelector?.(`[name="${name}"]`);
  if (!input) return;
  input.value = value == null ? '' : String(value);
}

function pricingKey(entry = {}) {
  return [
    entry.activity_no,
    entry.activity_name,
    entry.item_type,
    entry.proposal_group || entry.group_key,
    entry.unit_duration,
    entry.unit_price,
    entry.sort_order
  ].map(text).join('||');
}

function pricingIndex() {
  const byValue = new Map();
  const byActivityNo = new Map();
  const byPricingKey = new Map();
  const byName = new Map();
  pricingRows.forEach((entry) => {
    const value = pricingKey(entry);
    if (value && !byValue.has(value)) byValue.set(value, entry);
    const activityNo = text(entry.activity_no || entry.gefen_number);
    if (activityNo && !byActivityNo.has(activityNo)) byActivityNo.set(activityNo, entry);
    const key = text(entry.pricing_key);
    if (key && !byPricingKey.has(key)) byPricingKey.set(key, entry);
    const name = text(entry.activity_name).toLowerCase();
    if (name && !byName.has(name)) byName.set(name, entry);
  });
  return { byValue, byActivityNo, byPricingKey, byName };
}

function resolvePricing(row) {
  const select = row?.querySelector?.('[data-pa-pricing-select]');
  const selected = text(select?.value);
  if (!selected) return null;
  const index = pricingIndex();
  if (index.byValue.has(selected)) return index.byValue.get(selected);
  if (index.byActivityNo.has(selected)) return index.byActivityNo.get(selected);
  if (index.byPricingKey.has(selected)) return index.byPricingKey.get(selected);
  const parts = selected.split('||');
  const activityNo = text(parts[0]);
  const name = text(parts[1]).toLowerCase();
  if (activityNo && index.byActivityNo.has(activityNo)) return index.byActivityNo.get(activityNo);
  if (name && index.byName.has(name)) return index.byName.get(name);
  const selectedLabel = text(select?.selectedOptions?.[0]?.textContent).split('—')[0].trim().toLowerCase();
  if (selectedLabel && index.byName.has(selectedLabel)) return index.byName.get(selectedLabel);
  if (parts.length >= 6) {
    return {
      activity_no: parts[0],
      activity_name: parts[1],
      item_type: parts[2],
      proposal_group: parts[3],
      unit_duration: parts[4],
      unit_price: numberValue(parts[5])
    };
  }
  const priceFromLabel = numberValue(select?.selectedOptions?.[0]?.textContent?.match(/₪\s*([0-9,.]+)/)?.[1]);
  return {
    activity_name: text(select?.selectedOptions?.[0]?.textContent).split('—')[0].trim(),
    proposal_group: groupOf(row),
    unit_price: priceFromLabel
  };
}

function calculateRow(row) {
  const quantityInput = row?.querySelector?.('[data-pa-item-qty]');
  const priceInput = row?.querySelector?.('[data-pa-item-price]');
  const quantity = Math.max(numberValue(quantityInput?.value) || 1, 0);
  const price = Math.max(numberValue(priceInput?.value), 0);
  const total = quantity * price;
  const hidden = row?.querySelector?.('[data-pa-item-total]');
  const output = row?.querySelector?.('[data-pa-item-total-display]');
  if (hidden) hidden.value = total ? total.toFixed(2) : '';
  if (output) output.textContent = money(total);
  setField(row, 'total_price', total ? total.toFixed(2) : '');
  return total;
}

function calculateForm(form) {
  if (!form) return 0;
  let subtotal = 0;
  form.querySelectorAll('[data-pa-items-group]').forEach((section) => {
    let groupTotal = 0;
    section.querySelectorAll('[data-pa-item-row]').forEach((row) => { groupTotal += calculateRow(row); });
    subtotal += groupTotal;
    const key = text(section.dataset.paItemsGroup);
    const output = section.querySelector(`[data-pa-group-total="${key}"]`);
    if (output) output.textContent = money(groupTotal);
  });
  const discountType = text(form.querySelector('[data-pa-discount-type]')?.value) || 'amount';
  const discountValue = Math.max(numberValue(form.querySelector('[data-pa-discount-value]')?.value), 0);
  const discount = discountType === 'percent'
    ? subtotal * Math.min(discountValue, 100) / 100
    : Math.min(discountValue, subtotal);
  const total = Math.max(subtotal - discount, 0);
  const values = [
    ['[data-pa-grand-total]', money(total)],
    ['[data-pa-summary-total]', money(total)],
    ['[data-pa-summary-subtotal]', money(subtotal)],
    ['[data-pa-summary-discount]', discount ? `-${money(discount)}` : money(0)]
  ];
  values.forEach(([selector, value]) => {
    const target = form.querySelector(selector);
    if (target) target.textContent = value;
  });
  return total;
}

function hydrateRow(row) {
  const group = groupOf(row);
  if (!NEXT_YEAR_GROUPS.has(group)) return;
  const picked = resolvePricing(row);
  if (!picked) {
    calculateForm(row.closest('[data-pa-form]'));
    return;
  }
  setField(row, 'pricing_option_key', row.querySelector('[data-pa-pricing-select]')?.value || '');
  setField(row, 'activity_no', picked.activity_no || picked.gefen_number || '');
  setField(row, 'item_name', picked.activity_name || '');
  setField(row, 'item_type', picked.item_type || (group === 'next_year_workshops' ? 'סדנה' : 'קורס'));
  setField(row, 'gefen_number', group === 'next_year_workshops' ? '' : (picked.gefen_number || picked.activity_no || ''));
  setField(row, 'gefen_number_display', group === 'next_year_workshops' ? '' : (picked.gefen_number || picked.activity_no || ''));
  setField(row, 'meetings_count', picked.meetings_count || '');
  setField(row, 'hours_count', picked.hours_count || '');
  setField(row, 'unit_duration', picked.unit_duration || '');
  setField(row, 'unit_price', numberValue(picked.unit_price));
  setField(row, 'hourly_price', picked.hourly_price || '');
  setField(row, 'proposal_group', group);
  setField(row, 'item_source_pricing_key', picked.pricing_key || '');
  const priceInput = row.querySelector('[data-pa-item-price]');
  if (priceInput) priceInput.value = String(numberValue(picked.unit_price));
  calculateForm(row.closest('[data-pa-form]'));
}

function selectedRows(form, group) {
  return Array.from(form?.querySelectorAll?.(`[data-pa-items-group="${group}"] [data-pa-item-row]`) || [])
    .map((row) => {
      const name = field(row, 'item_name') || text(row.querySelector('[data-pa-pricing-select]')?.selectedOptions?.[0]?.textContent).split('—')[0].trim();
      const quantity = Math.max(numberValue(row.querySelector('[data-pa-item-qty]')?.value) || 1, 1);
      const price = Math.max(numberValue(row.querySelector('[data-pa-item-price]')?.value || field(row, 'unit_price')), 0);
      return {
        name,
        activityNo: field(row, 'gefen_number') || field(row, 'activity_no'),
        meetings: field(row, 'meetings_count'),
        hours: field(row, 'hours_count'),
        duration: field(row, 'unit_duration'),
        quantity,
        price,
        total: quantity * price
      };
    })
    .filter((row) => row.name && row.price > 0);
}

function courseTableHtml(rows) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return `<h4 class="pa-section-heading pa-next-year-course-heading">קורסים ותוכניות</h4>
  <table class="pa-item-details-table pa-activities-table pa-next-year-course-table">
    <thead><tr><th>תוכנית</th><th>מספר גפ״ן</th><th>מפגשים</th><th>שעות</th><th>כמות</th><th>מחיר</th><th>סה״כ</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.activityNo || '—')}</td><td>${escapeHtml(row.meetings || '—')}</td><td>${escapeHtml(row.hours || '—')}</td><td>${row.quantity}</td><td>${money(row.price)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="6">סה״כ קורסים</td><td>${money(total)}</td></tr></tfoot>
  </table>`;
}

function workshopTableHtml(rows) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return `<h4 class="pa-section-heading pa-next-year-workshop-heading">סדנאות</h4>
  <table class="pa-item-details-table pa-activities-table pa-next-year-workshop-table">
    <thead><tr><th>סדנה</th><th>משך פעילות</th><th>כמות</th><th>מחיר להפעלה</th><th>סה״כ</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.duration || '45 דקות')}</td><td>${row.quantity}</td><td>${money(row.price)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">סה״כ סדנאות</td><td>${money(total)}</td></tr></tfoot>
  </table>`;
}

function visibleNextYearForm() {
  const forms = Array.from(document.querySelectorAll('[data-pa-form]'));
  return forms.reverse().find((form) => {
    const type = text(form.querySelector('[name="activity_type_group"]')?.value);
    return (type === 'next_year' || /תשפ/.test(type)) && !form.hidden && form.closest('[hidden]') == null;
  }) || null;
}

function normalizeDocument(documentRoot) {
  const form = visibleNextYearForm();
  if (!form || !documentRoot) return;
  const courses = selectedRows(form, 'next_year_courses');
  const workshops = selectedRows(form, 'next_year_workshops');
  if (!courses.length && !workshops.length) return;
  const signature = JSON.stringify([courses, workshops]);
  if (documentRoot.dataset.approvedNextYearSignature === signature) return;
  const existingTable = documentRoot.querySelector('.pa-next-year-course-table, .pa-next-year-workshop-table, .pa-item-details-table, .pa-activities-table');
  const block = existingTable?.closest('.pa-cost-table-block') || documentRoot.querySelector('.pa-cost-table-block') || existingTable?.parentElement || documentRoot;
  block.querySelectorAll('.pa-next-year-course-heading, .pa-next-year-workshop-heading, .pa-next-year-course-table, .pa-next-year-workshop-table, .pa-next-year-combined-total').forEach((node) => node.remove());
  if (existingTable && existingTable.isConnected) existingTable.remove();
  const total = [...courses, ...workshops].reduce((sum, row) => sum + row.total, 0);
  const wrapper = documentRoot.ownerDocument.createElement('div');
  wrapper.className = 'pa-next-year-approved-tables';
  wrapper.innerHTML = `${courses.length ? courseTableHtml(courses) : ''}${workshops.length ? workshopTableHtml(workshops) : ''}${courses.length && workshops.length ? `<table class="pa-cost-table pa-activities-table pa-next-year-combined-total"><tbody><tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${money(total)}</strong></td></tr></tbody></table>` : ''}`;
  block.appendChild(wrapper);
  documentRoot.dataset.approvedNextYearSignature = signature;
}

function refreshDocuments() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    document.querySelectorAll('.proposal-document').forEach(normalizeDocument);
  }, 50);
}

async function loadPricing() {
  try {
    const rows = await api.readProposalActivityPricing?.();
    if (Array.isArray(rows)) pricingRows = rows;
  } catch {
    pricingRows = [];
  }
}

function install() {
  void loadPricing();
  document.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-pa-pricing-select]');
    const row = select?.closest?.('[data-pa-item-row]');
    if (!row || !NEXT_YEAR_GROUPS.has(groupOf(row))) return;
    queueMicrotask(() => {
      hydrateRow(row);
      refreshDocuments();
    });
  }, true);
  document.addEventListener('input', (event) => {
    const row = event.target?.closest?.('[data-pa-item-row]');
    if (!row || !NEXT_YEAR_GROUPS.has(groupOf(row))) return;
    calculateForm(row.closest('[data-pa-form]'));
    refreshDocuments();
  }, true);
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 && (node.matches?.('.proposal-document') || node.querySelector?.('.proposal-document'))))) refreshDocuments();
  }).observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
  refreshDocuments();
}

if (typeof document !== 'undefined') install();
