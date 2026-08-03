const COURSE_GROUP = 'next_year_courses';
const WORKSHOP_GROUP = 'next_year_workshops';
const INSTALL_KEY = Symbol.for('taasiyeda.nextYearMixedProposalTables.v3');
const pendingDocuments = new WeakSet();

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

  if (/סדנ|workshop|maker|stem/.test(itemType) || /סדנ|workshop|maker|stem/.test(optionText)) return 'workshop';
  if (/קורס|תוכנית|תכנית|course|program/.test(itemType)) return 'course';
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

function visibleNextYearForm(documentRef = document) {
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

function documentTarget(documentRoot) {
  const previous = documentRoot.querySelector('.pa-next-year-approved-tables');
  if (previous?.parentElement) return previous.parentElement;
  const existing = documentRoot.querySelector(
    '.pa-next-year-course-table, .pa-next-year-workshop-table, .pa-item-details-table, .pa-cost-table-block'
  );
  return existing?.closest?.('.pa-cost-table-block') || existing?.parentElement || documentRoot;
}

function nativeTables(documentRoot) {
  return Array.from(documentRoot.querySelectorAll(
    '.pa-next-year-course-table, .pa-next-year-workshop-table, '
    + '.pa-item-details-table:not(.pa-gefen-approval-table), table.pa-activities-table:not(.pa-gefen-approval-table)'
  )).filter((node) => !node.closest('.pa-next-year-approved-tables'));
}

function clearNativeNextYearTables(target) {
  target.querySelectorAll(
    '.pa-next-year-course-heading, .pa-next-year-workshop-heading, '
    + '.pa-next-year-course-table, .pa-next-year-workshop-table, .pa-next-year-combined-total, '
    + '.pa-item-details-table:not(.pa-gefen-approval-table), table.pa-activities-table:not(.pa-gefen-approval-table)'
  ).forEach((node) => {
    if (!node.closest('.pa-next-year-approved-tables')) node.remove();
  });
}

function normalizeDocument(documentRoot) {
  if (!documentRoot?.isConnected || documentRoot.querySelector('.pa-gefen-approval-table')) return;
  const form = visibleNextYearForm(documentRoot.ownerDocument);
  if (!form) return;

  const { courses, workshops } = selectedRows(form);
  const previous = documentRoot.querySelector('.pa-next-year-approved-tables');

  if (!courses.length || !workshops.length) {
    if (previous && nativeTables(documentRoot).length) previous.remove();
    delete documentRoot.dataset.approvedNextYearSignature;
    return;
  }

  const signature = JSON.stringify([courses, workshops]);
  if (documentRoot.dataset.approvedNextYearSignature === signature && previous) return;

  const target = documentTarget(documentRoot);
  if (!target) return;
  previous?.remove();
  clearNativeNextYearTables(target);

  const total = [...courses, ...workshops].reduce((sum, row) => sum + row.total, 0);
  const wrapper = documentRoot.ownerDocument.createElement('div');
  wrapper.className = 'pa-next-year-approved-tables';
  wrapper.innerHTML = courseTableHtml(courses)
    + workshopTableHtml(workshops)
    + `<table class="pa-cost-table pa-activities-table pa-next-year-combined-total"><tbody><tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${money(total)}</strong></td></tr></tbody></table>`;
  target.appendChild(wrapper);
  documentRoot.dataset.approvedNextYearSignature = signature;
}

function scheduleDocument(documentRoot) {
  if (!documentRoot || pendingDocuments.has(documentRoot)) return;
  pendingDocuments.add(documentRoot);
  const run = () => {
    pendingDocuments.delete(documentRoot);
    normalizeDocument(documentRoot);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function documentRootsFromNode(node) {
  if (!(node instanceof Element) || node.closest('.pa-next-year-approved-tables')) return [];
  const roots = new Set();
  if (node.matches('.proposal-document')) roots.add(node);
  const closest = node.closest('.proposal-document');
  if (closest) roots.add(closest);
  node.querySelectorAll?.('.proposal-document').forEach((root) => roots.add(root));
  return [...roots];
}

function install() {
  if (document[INSTALL_KEY]) return;
  Object.defineProperty(document, INSTALL_KEY, { value: true, configurable: false });

  const root = document.getElementById('app') || document.documentElement;
  if (typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      const documents = new Set();
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        documentRootsFromNode(node).forEach((documentRoot) => documents.add(documentRoot));
      }));
      documents.forEach(scheduleDocument);
    }).observe(root, { childList: true, subtree: true });
  }

  document.querySelectorAll('.proposal-document').forEach(scheduleDocument);
}

if (typeof document !== 'undefined') install();
