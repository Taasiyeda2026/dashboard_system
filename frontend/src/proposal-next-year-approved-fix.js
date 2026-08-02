const COURSE_GROUP = 'next_year_courses';
const WORKSHOP_GROUP = 'next_year_workshops';
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

function field(row, name) {
  return text(row?.querySelector?.(`[name="${name}"]`)?.value);
}

function rowGroup(row) {
  return text(
    row?.closest?.('[data-pa-items-group]')?.dataset?.paItemsGroup
    || row?.querySelector?.('[name="proposal_group"]')?.value
  );
}

function rowKind(row) {
  const group = rowGroup(row).toLowerCase();
  if (group === WORKSHOP_GROUP || /workshop|סדנ/.test(group)) return 'workshop';
  if (group === COURSE_GROUP || /course|קורס|next_year/.test(group)) return 'course';
  const itemType = text(field(row, 'item_type')).toLowerCase();
  return /סדנ|workshop/.test(itemType) ? 'workshop' : 'course';
}

function selectedLabel(row) {
  const option = row?.querySelector?.('[data-pa-pricing-select]')?.selectedOptions?.[0];
  return text(option?.textContent).split('—')[0].trim();
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

function documentTarget(documentRoot) {
  const previous = documentRoot.querySelector('.pa-next-year-approved-tables');
  if (previous) {
    const parent = previous.parentElement;
    previous.remove();
    return parent || documentRoot;
  }

  const existing = documentRoot.querySelector(
    '.pa-next-year-course-table, .pa-next-year-workshop-table, .pa-item-details-table, .pa-cost-table-block'
  );
  return existing?.closest?.('.pa-cost-table-block') || existing?.parentElement || documentRoot;
}

function clearNativeNextYearTables(target) {
  target.querySelectorAll(
    '.pa-next-year-course-heading, .pa-next-year-workshop-heading, '
    + '.pa-next-year-course-table, .pa-next-year-workshop-table, .pa-next-year-combined-total'
  ).forEach((node) => node.remove());

  const generic = target.querySelector('.pa-item-details-table, table.pa-activities-table');
  if (generic && !generic.classList.contains('pa-gefen-approval-table')) generic.remove();
}

function normalizeDocument(documentRoot) {
  if (!documentRoot?.isConnected) return;
  const form = currentNextYearForm(documentRoot.ownerDocument);
  if (!form) return;

  const { courses, workshops } = selectedRows(form);
  if (!courses.length && !workshops.length) return;

  const signature = JSON.stringify([courses, workshops]);
  if (documentRoot.dataset.approvedNextYearSignature === signature
    && documentRoot.querySelector('.pa-next-year-approved-tables')) return;

  const target = documentTarget(documentRoot);
  if (!target) return;
  clearNativeNextYearTables(target);

  const total = [...courses, ...workshops].reduce((sum, row) => sum + row.total, 0);
  const wrapper = documentRoot.ownerDocument.createElement('div');
  wrapper.className = 'pa-next-year-approved-tables';
  wrapper.innerHTML = `${courses.length ? courseTableHtml(courses) : ''}`
    + `${workshops.length ? workshopTableHtml(workshops) : ''}`
    + `${courses.length && workshops.length
      ? `<table class="pa-cost-table pa-activities-table pa-next-year-combined-total"><tbody><tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${money(total)}</strong></td></tr></tbody></table>`
      : ''}`;
  target.appendChild(wrapper);
  documentRoot.dataset.approvedNextYearSignature = signature;
}

function refreshDocuments(delay = 80) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    document.querySelectorAll('.proposal-document').forEach(normalizeDocument);
  }, delay);
}

function isRelevantEditorEvent(target) {
  return Boolean(target?.matches?.(
    '[data-pa-pricing-select], [data-pa-item-qty], [data-pa-item-price], '
    + '[data-pa-discount-value], [data-pa-discount-type], [name="activity_type_group"]'
  ));
}

function install() {
  document.addEventListener('change', (event) => {
    if (isRelevantEditorEvent(event.target)) refreshDocuments();
  }, true);
  document.addEventListener('input', (event) => {
    if (isRelevantEditorEvent(event.target)) refreshDocuments(120);
  }, true);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-pa-add-item], [data-pa-remove-item], [data-pa-preview], [data-pa-print]')) {
      refreshDocuments(120);
    }
  }, true);

  const root = document.getElementById('app') || document.documentElement;
  if (typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      const addedDocument = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => {
        if (node.nodeType !== 1) return false;
        return node.matches?.('.proposal-document') || Boolean(node.querySelector?.('.proposal-document'));
      }));
      if (addedDocument) {
        refreshDocuments(0);
        setTimeout(() => refreshDocuments(0), 180);
      }
    }).observe(root, { childList: true, subtree: true });
  }

  refreshDocuments(0);
}

if (typeof document !== 'undefined') install();
