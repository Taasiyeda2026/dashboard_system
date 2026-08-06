const COURSE_GROUP = 'next_year_courses';
const WORKSHOP_GROUP = 'next_year_workshops';
const INSTALL_KEY = Symbol.for('taasiyeda.nextYearMixedProposalTables.v4');
let refreshTimer = null;
let refreshRunning = false;

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

function field(row, name) {
  return text(row?.querySelector?.(`[name="${name}"]`)?.value);
}

function rowGroup(row) {
  return text(
    row?.closest?.('[data-pa-items-group]')?.dataset?.paItemsGroup
    || row?.dataset?.paRowGroup
    || row?.querySelector?.('[name="proposal_group"]')?.value
  ).toLowerCase();
}

function selectedOptionText(row) {
  return text(row?.querySelector?.('[data-pa-pricing-select]')?.selectedOptions?.[0]?.textContent);
}

function rowKind(row) {
  const itemType = field(row, 'item_type').toLowerCase();
  const optionText = selectedOptionText(row).toLowerCase();
  const group = rowGroup(row);

  if (/סדנ|workshop/.test(itemType) || /(?:—|-|\s)סדנ/.test(optionText)) return 'workshop';
  if (/קורס|תוכנית|תכנית|course/.test(itemType)) return 'course';
  if (group === WORKSHOP_GROUP || /workshop|סדנ/.test(group)) return 'workshop';
  if (group === COURSE_GROUP || /course|קורס/.test(group)) return 'course';
  return 'course';
}

function selectedLabel(row) {
  return selectedOptionText(row).split('—')[0].trim();
}

function rowData(row) {
  const name = field(row, 'item_name') || selectedLabel(row);
  if (!name) return null;
  const quantity = Math.max(numberValue(row?.querySelector?.('[data-pa-item-qty]')?.value) || 1, 1);
  const price = Math.max(
    numberValue(row?.querySelector?.('[data-pa-item-price]')?.value || field(row, 'unit_price')),
    0
  );
  return {
    kind: rowKind(row),
    name,
    activityNo: field(row, 'gefen_number') || field(row, 'activity_no'),
    meetings: field(row, 'meetings_count'),
    hours: field(row, 'hours_count'),
    duration: field(row, 'unit_duration') || '45 דקות',
    quantity,
    price,
    total: quantity * price
  };
}

function currentNextYearForm(documentRef = document) {
  const forms = Array.from(documentRef.querySelectorAll('[data-pa-form]')).reverse();
  return forms.find((form) => {
    if (!form.isConnected || form.closest('[hidden]')) return false;
    const type = text(form.querySelector('[name="activity_type_group"]')?.value);
    return type === 'next_year'
      || /תשפ/.test(type)
      || Boolean(form.querySelector(`[data-pa-items-group="${COURSE_GROUP}"], [data-pa-items-group="${WORKSHOP_GROUP}"]`));
  }) || null;
}

function selectedRows(form) {
  const rows = Array.from(form?.querySelectorAll?.('[data-pa-item-row]') || [])
    .map(rowData)
    .filter(Boolean);
  return {
    courses: rows.filter((row) => row.kind === 'course'),
    workshops: rows.filter((row) => row.kind === 'workshop')
  };
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
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.duration)}</td><td>${row.quantity}</td><td>${money(row.price)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">סה״כ סדנאות</td><td>${money(total)}</td></tr></tfoot>
  </table>`;
}

function replacementRegion(documentRoot) {
  const previous = documentRoot.querySelector('.pa-next-year-approved-tables');
  if (previous) return previous;

  const existingTable = documentRoot.querySelector(
    '.pa-next-year-course-table, .pa-next-year-workshop-table, '
    + '.pa-item-details-table:not(.pa-gefen-approval-table), .pa-cost-table-block table'
  );
  if (!existingTable) return null;
  return existingTable.closest('.pa-next-year-cost-group') || existingTable;
}

function normalizeDocument(documentRoot) {
  if (!documentRoot?.isConnected || documentRoot.dataset.approvedNextYearNormalizing === 'yes') return;
  const form = currentNextYearForm(documentRoot.ownerDocument);
  if (!form) return;

  const { courses, workshops } = selectedRows(form);
  if (!courses.length || !workshops.length) return;

  const signature = JSON.stringify([courses, workshops]);
  const previous = documentRoot.querySelector('.pa-next-year-approved-tables');
  if (documentRoot.dataset.approvedNextYearSignature === signature && previous) return;

  const region = replacementRegion(documentRoot);
  if (!region) return;

  const total = [...courses, ...workshops].reduce((sum, row) => sum + row.total, 0);
  const wrapper = documentRoot.ownerDocument.createElement('div');
  wrapper.className = 'pa-next-year-cost-group pa-next-year-approved-tables';
  wrapper.style.cssText = 'width:100%;max-width:100%;margin-inline:0;';
  wrapper.innerHTML = courseTableHtml(courses)
    + workshopTableHtml(workshops)
    + `<table class="pa-cost-table pa-activities-table pa-next-year-combined-total"><tbody><tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${money(total)}</strong></td></tr></tbody></table>`;

  documentRoot.dataset.approvedNextYearSignature = signature;
  documentRoot.dataset.approvedNextYearNormalizing = 'yes';
  try {
    region.replaceWith(wrapper);
  } finally {
    delete documentRoot.dataset.approvedNextYearNormalizing;
  }
}

function runRefresh() {
  if (refreshRunning) return;
  refreshRunning = true;
  const run = () => {
    try {
      document.querySelectorAll('.proposal-document').forEach(normalizeDocument);
    } finally {
      refreshRunning = false;
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

function refreshDocuments(delay = 160) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(runRefresh, delay);
}

function isRelevantEditorEvent(target) {
  if (!target?.closest?.('[data-pa-form]') || target.closest('.proposal-document')) return false;
  return Boolean(target.matches?.(
    '[data-pa-pricing-select], [data-pa-item-qty], [data-pa-item-price], '
    + '[data-pa-discount-value], [data-pa-discount-type], [name="activity_type_group"]'
  ));
}

function install() {
  if (document[INSTALL_KEY]) return;
  Object.defineProperty(document, INSTALL_KEY, { value: true, configurable: false });

  document.addEventListener('change', (event) => {
    if (isRelevantEditorEvent(event.target)) refreshDocuments(180);
  }, true);
  document.addEventListener('input', (event) => {
    if (isRelevantEditorEvent(event.target)) refreshDocuments(220);
  }, true);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-pa-add-item], [data-pa-remove-item], [data-pa-preview], [data-pa-print]')) {
      refreshDocuments(220);
    }
  }, true);

  const root = document.getElementById('app') || document.documentElement;
  if (typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      const addedDocument = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => {
        if (node.nodeType !== 1) return false;
        return node.matches?.('.proposal-document') || Boolean(node.querySelector?.('.proposal-document'));
      }));
      if (addedDocument) refreshDocuments(100);
    }).observe(root, { childList: true, subtree: true });
  }

  refreshDocuments(100);
}

if (typeof document !== 'undefined') install();
