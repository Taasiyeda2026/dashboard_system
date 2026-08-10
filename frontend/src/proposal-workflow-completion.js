import { api } from './api.js';
import { setProposalPdfDocumentNormalizer } from './screens/proposals-agreements.js';
import {
  augmentNextYearPricingRows,
  normalizeNextYearWorkshopTables
} from './proposal-next-year-workshops.js';
import { isCoreOwnedGefenPricingTarget } from './proposal-workflow-ui-integrity.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalWorkflowCompletion');
const NEXT_YEAR_ALIASES = new Set(['next_year', 'שנה הבאה', 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז', 'תשפ״ז']);
const SUMMER_ALIASES = new Set(['summer', 'פעילויות קיץ', 'קיץ תשפ״ו']);
const TYPE_OPTIONS = Object.freeze([
  ['next_year', 'תשפ״ז'],
  ['gefen', 'גפ״ן'],
  ['summer', 'קיץ'],
  ['tour', 'סיור'],
  ['combined', 'משולבת']
]);
const COURSE_SHORT_NAMES_BY_GEFEN = Object.freeze({
  '6089': 'ביומימיקרי',
  '57651': 'טכנולוגיות החלל',
  '67867': 'מנהיגות ירוקה',
  '27342': 'משחקי קופסה',
  '53828': 'ביומימיקרי לחטיבה',
  '9545': 'בינה מלאכותית',
  '57646': 'השמיים אינם הגבול',
  '53819': 'יישומי הבינה המלאכותית',
  '3604': 'פורצות דרך',
  '46091': 'רוקחים עולם',
  '52279': 'אופק יזמות פרימיום לתעשייה'
});

let cachedPricingRows = [];
let editorDepsPromise = null;
let editorDepsValue = null;

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return text(value).replace(/[״"׳'`]/g, '').toLowerCase();
}

function numberValue(value) {
  const number = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function currencyText(value) {
  return `₪ ${Number(value || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function normalizeGroup(value) {
  const raw = text(value);
  if (NEXT_YEAR_ALIASES.has(raw)) return 'next_year';
  if (SUMMER_ALIASES.has(raw)) return 'summer';
  if (/^גפ/.test(raw) || /^gefen$/i.test(raw)) return 'gefen';
  if (/סיור/.test(raw) || /^tour$/i.test(raw)) return 'tour';
  if (/משולב/.test(raw) || /^combined$/i.test(raw)) return 'combined';
  return raw;
}

function cachePricingPayload(payload = {}) {
  const rows = payload?.proposalActivityPricing || payload?.proposal_activity_pricing;
  if (Array.isArray(rows)) cachedPricingRows = augmentNextYearPricingRows(rows);
  return payload;
}

function wrapPayloadMethod(targetApi, methodName) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function proposalWorkflowPayload(...args) {
    return cachePricingPayload(await original.apply(this, args));
  };
}

function wrapPricingMethod(targetApi, methodName) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function proposalWorkflowPricing(...args) {
    const rows = await original.apply(this, args);
    if (Array.isArray(rows)) cachedPricingRows = augmentNextYearPricingRows(rows);
    return rows;
  };
}

function memoizeEditorDeps(targetApi) {
  const original = targetApi?.proposalsAgreementsEditorDeps;
  if (typeof original !== 'function') return;
  targetApi.proposalsAgreementsEditorDeps = async function proposalEditorDepsMemoized(...args) {
    if (editorDepsValue) return editorDepsValue;
    if (editorDepsPromise) return editorDepsPromise;
    editorDepsPromise = Promise.resolve(original.apply(this, args))
      .then((payload) => {
        editorDepsValue = cachePricingPayload(payload || {});
        return editorDepsValue;
      })
      .catch((error) => {
        editorDepsPromise = null;
        throw error;
      });
    return editorDepsPromise;
  };
}

function prewarmEditorDeps(targetApi, scope = globalThis) {
  const run = () => {
    if (typeof targetApi?.proposalsAgreementsEditorDeps !== 'function') return;
    targetApi.proposalsAgreementsEditorDeps().catch(() => {});
  };
  if (typeof scope.requestIdleCallback === 'function') scope.requestIdleCallback(run, { timeout: 1200 });
  else scope.setTimeout?.(run, 350);
}

export function calculateFormTotals(form) {
  if (!form) return 0;
  let subtotal = 0;
  form.querySelectorAll('[data-pa-items-group]').forEach((section) => {
    let groupTotal = 0;
    section.querySelectorAll('[data-pa-item-row]').forEach((row) => {
      const quantity = numberValue(row.querySelector('[data-pa-item-qty]')?.value);
      const price = numberValue(row.querySelector('[data-pa-item-price]')?.value);
      const total = quantity > 0 && price > 0 ? quantity * price : 0;
      const hidden = row.querySelector('[data-pa-item-total]');
      const output = row.querySelector('[data-pa-item-total-display]');
      if (hidden) hidden.value = total > 0 ? total.toFixed(2) : '';
      if (output && output.textContent !== currencyText(total)) output.textContent = currencyText(total);
      groupTotal += total;
    });
    subtotal += groupTotal;
    const groupKey = text(section.dataset.paItemsGroup);
    const groupOutput = section.querySelector(`[data-pa-group-total="${groupKey}"]`);
    if (groupOutput && groupOutput.textContent !== currencyText(groupTotal)) groupOutput.textContent = currencyText(groupTotal);
  });

  const discountType = text(form.querySelector('[data-pa-discount-type]')?.value) || 'amount';
  const discountValue = numberValue(form.querySelector('[data-pa-discount-value]')?.value);
  const discount = discountType === 'percent'
    ? subtotal * Math.min(Math.max(discountValue, 0), 100) / 100
    : Math.min(Math.max(discountValue, 0), subtotal);
  const total = Math.max(subtotal - discount, 0);
  [
    ['[data-pa-grand-total]', currencyText(total)],
    ['[data-pa-summary-total]', currencyText(total)],
    ['[data-pa-summary-subtotal]', currencyText(subtotal)],
    ['[data-pa-summary-discount]', discount > 0 ? `-₪ ${discount.toLocaleString('he-IL')}` : '₪ 0']
  ].forEach(([selector, value]) => {
    const element = form.querySelector(selector);
    if (element && element.textContent !== value) element.textContent = value;
  });
  return total;
}

function proposalFormEvent(event) {
  const target = event.target;
  if (!target?.matches?.('[data-pa-item-qty], [data-pa-item-price], [data-pa-discount-value], [data-pa-discount-type], [data-pa-pricing-select]')) return;
  // Gefen's native editor listener owns hydration/totals/preview. Running this
  // second calculator in the same event chain caused repeated DOM mutations.
  if (isCoreOwnedGefenPricingTarget(target)) return;
  const form = target.closest('[data-pa-form]');
  if (form) queueMicrotask(() => calculateFormTotals(form));
}

export function ensureTypeFilterOptions(root = document) {
  root.querySelectorAll?.('[data-pa-filter="activity_type_group"]').forEach((select) => {
    const current = text(select.value);
    const existing = new Set(Array.from(select.options).map((option) => text(option.value)));
    TYPE_OPTIONS.forEach(([value, label]) => {
      if (existing.has(value)) return;
      const option = select.ownerDocument.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    if (current) select.value = current;
  });
}

function proposalTypeFromRow(row) {
  const cells = Array.from(row?.cells || []);
  const explicit = text(row?.dataset?.paProposalType || row?.dataset?.proposalType);
  if (explicit) return normalizeGroup(explicit);
  const typeText = cells.map((cell) => text(cell.textContent)).find((value) => /תשפ|גפ|קיץ|סיור|משולב/.test(value));
  return normalizeGroup(typeText);
}

function applySummerView(screen) {
  const mode = text(screen?.dataset?.paProposalListMode) || 'regular';
  screen?.querySelectorAll?.('[data-pa-table] tbody tr[data-pa-row-id]').forEach((row) => {
    const isSummer = proposalTypeFromRow(row) === 'summer';
    row.hidden = mode === 'summer' ? !isSummer : isSummer;
  });
}

function setSummerTabActive(screen, active) {
  screen.dataset.paProposalListMode = active ? 'summer' : 'regular';
  screen.querySelector('[data-pa-summer-tab]')?.classList.toggle('is-active', active);
  applySummerView(screen);
}

export function ensureSummerTab(root = document) {
  root.querySelectorAll?.('.ds-pa-screen').forEach((screen) => {
    if (screen.querySelector('[data-pa-summer-tab]')) {
      applySummerView(screen);
      return;
    }
    const recordsTab = screen.querySelector('[data-pa-tab="records"]');
    if (!recordsTab) return;
    const button = recordsTab.cloneNode(true);
    button.removeAttribute('data-pa-tab');
    button.dataset.paSummerTab = 'true';
    button.classList.remove('is-active');
    button.innerHTML = 'הצעות מחיר קיץ <span class="ds-pa-tab-count" data-pa-summer-count>0</span>';
    recordsTab.after(button);

    button.addEventListener('click', () => {
      recordsTab.click();
      const filter = screen.querySelector('[data-pa-filter="activity_type_group"]');
      if (filter) {
        filter.value = 'summer';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setSummerTabActive(screen, true);
    });
    screen.querySelectorAll('[data-pa-tab]').forEach((tab) => tab.addEventListener('click', () => setSummerTabActive(screen, false)));
    applySummerView(screen);
  });
}

function updateSummerCounts(root = document) {
  root.querySelectorAll?.('.ds-pa-screen').forEach((screen) => {
    const count = Array.from(screen.querySelectorAll('[data-pa-table] tbody tr[data-pa-row-id]'))
      .filter((row) => proposalTypeFromRow(row) === 'summer').length;
    const output = screen.querySelector('[data-pa-summer-count]');
    const next = String(count);
    if (output && output.textContent !== next) output.textContent = next;
    applySummerView(screen);
  });
}

function pricingClassification() {
  const workshops = new Set();
  const courses = new Set();
  const courseShortNames = new Map();
  augmentNextYearPricingRows(cachedPricingRows).forEach((row) => {
    const name = normalized(row.activity_name);
    if (!name) return;
    const group = normalizeGroup(row.proposal_group || row.group_key);
    if (group === 'next_year_workshops') workshops.add(name);
    if (group === 'next_year' || group === 'next_year_courses') {
      courses.add(name);
      const gefen = text(row.gefen_number || row.activity_no).replace(/\D/g, '');
      courseShortNames.set(name, COURSE_SHORT_NAMES_BY_GEFEN[gefen] || text(row.activity_name));
    }
  });
  return { workshops, courses, courseShortNames };
}

function rowName(row) {
  return text(row?.cells?.[0]?.textContent || row?.querySelector?.('td')?.textContent);
}

function rowTotal(row) {
  const cells = Array.from(row?.cells || []);
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const value = numberValue(cells[index].textContent);
    if (value > 0) return value;
  }
  return 0;
}

function isWorkshopRow(row, classification) {
  const name = normalized(rowName(row));
  if (classification.workshops.has(name)) return true;
  if (classification.courses.has(name)) return false;
  return /סדנ|חדר בריחה|אסטרונאוט|חלל|מייקר|maker|workshop|stem/.test(name);
}

function replaceFooter(table, label, total) {
  const columns = Math.max(table.querySelector('thead tr')?.children?.length || 0, table.querySelector('tbody tr')?.children?.length || 1);
  const footer = table.tFoot || table.createTFoot();
  footer.innerHTML = `<tr><td colspan="${Math.max(columns - 1, 1)}"><strong>${label}</strong></td><td><strong>${currencyText(total)}</strong></td></tr>`;
}

function tableHeading(documentRef, value, className) {
  const heading = documentRef.createElement('h4');
  heading.className = `pa-section-heading ${className}`;
  heading.textContent = value;
  return heading;
}

function splitGenericNextYearTable(documentRoot) {
  if (documentRoot.querySelector('.pa-next-year-course-table tbody tr') && documentRoot.querySelector('.pa-next-year-workshop-table tbody tr')) return false;
  const classification = pricingClassification();
  const candidates = Array.from(documentRoot.querySelectorAll('.pa-cost-table-block table, table.pa-cost-table, table.pa-activities-table'))
    .filter((table) => !table.classList.contains('pa-gefen-approval-table')
      && !table.classList.contains('pa-next-year-combined-total'));
  for (const table of candidates) {
    const rows = Array.from(table.querySelectorAll('tbody > tr'));
    if (rows.length < 2) continue;
    const workshopRows = rows.filter((row) => isWorkshopRow(row, classification));
    const courseRows = rows.filter((row) => !isWorkshopRow(row, classification));
    if (!workshopRows.length || !courseRows.length) continue;

    const courseTable = table.cloneNode(true);
    const workshopTable = table.cloneNode(true);
    courseTable.classList.add('pa-next-year-course-table');
    workshopTable.classList.add('pa-next-year-workshop-table');
    Array.from(courseTable.querySelectorAll('tbody > tr')).forEach((row) => { if (isWorkshopRow(row, classification)) row.remove(); });
    Array.from(workshopTable.querySelectorAll('tbody > tr')).forEach((row) => { if (!isWorkshopRow(row, classification)) row.remove(); });
    const courseTotal = Array.from(courseTable.querySelectorAll('tbody > tr')).reduce((sum, row) => sum + rowTotal(row), 0);
    const workshopTotal = Array.from(workshopTable.querySelectorAll('tbody > tr')).reduce((sum, row) => sum + rowTotal(row), 0);
    replaceFooter(courseTable, 'סה״כ קורסים', courseTotal);
    replaceFooter(workshopTable, 'סה״כ סדנאות', workshopTotal);

    const fragment = documentRoot.ownerDocument.createDocumentFragment();
    fragment.appendChild(tableHeading(documentRoot.ownerDocument, 'קורסים ותוכניות', 'pa-next-year-course-heading'));
    fragment.appendChild(courseTable);
    fragment.appendChild(tableHeading(documentRoot.ownerDocument, 'סדנאות', 'pa-next-year-workshop-heading'));
    fragment.appendChild(workshopTable);
    const summary = documentRoot.ownerDocument.createElement('table');
    summary.className = 'pa-cost-table pa-activities-table pa-next-year-combined-total';
    summary.innerHTML = `<tbody><tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${currencyText(courseTotal + workshopTotal)}</strong></td></tr></tbody>`;
    fragment.appendChild(summary);
    table.replaceWith(fragment);
    return true;
  }
  return false;
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function selectedCourseNames(documentRoot) {
  const classification = pricingClassification();
  return [...new Set(Array.from(documentRoot.querySelectorAll('.pa-next-year-course-table tbody > tr'))
    .map(rowName)
    .filter(Boolean)
    .map((name) => classification.courseShortNames.get(normalized(name)) || name))];
}

function normalizeNextYearActivityIntro(documentRoot) {
  if (!documentRoot.querySelector('.pa-next-year-course-table, .pa-next-year-workshop-table')) return false;
  const heading = Array.from(documentRoot.querySelectorAll('.pa-section-heading'))
    .find((element) => /הפעילות המוצעת/.test(text(element.textContent)));
  if (!heading) return false;
  const section = heading.closest('.pa-section') || heading.parentElement;
  if (!section) return false;

  section.querySelectorAll('p').forEach((paragraph) => {
    const value = text(paragraph.textContent);
    if (/להלן הפעילויות המוצעות לשנת הלימודים תשפ/.test(value)
      || /להלן הקורסים המוצעים לשנת הלימודים תשפ/.test(value)
      || /ההצעה יכולה לכלול קורסים, סדנאות או שילוב ביניהם/.test(value)) paragraph.remove();
  });
  section.querySelector('.pa-next-year-selected-summary')?.remove();
  const courses = selectedCourseNames(documentRoot);
  const hasWorkshops = Boolean(documentRoot.querySelector('.pa-next-year-workshop-table tbody > tr'));
  const items = [...courses, ...(hasWorkshops ? ['סדנאות מייקרים STEM'] : [])];
  const summary = documentRoot.ownerDocument.createElement('div');
  summary.className = 'pa-next-year-selected-summary';
  summary.innerHTML = `<p>להלן הפעילויות המוצעות לשנת הלימודים תשפ״ז:</p>${items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`;
  heading.after(summary);
  return true;
}

export function normalizeProposalWorkflowDocument(root = document) {
  normalizeNextYearWorkshopTables(root);
  const documents = [];
  if (root?.matches?.('.proposal-document')) documents.push(root);
  root?.querySelectorAll?.('.proposal-document').forEach((documentRoot) => documents.push(documentRoot));
  documents.forEach((documentRoot) => {
    splitGenericNextYearTable(documentRoot);
    normalizeNextYearActivityIntro(documentRoot);
  });
  return root;
}

function normalizeSnapshotHtml(html, documentRef) {
  if (!html || !documentRef?.createElement) return html;
  const template = documentRef.createElement('template');
  template.innerHTML = String(html);
  normalizeProposalWorkflowDocument(template.content);
  return template.innerHTML;
}

function wrapSnapshotMethod(targetApi, methodName, documentRef) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function proposalWorkflowSnapshot(...args) {
    const payload = args[1];
    if (payload && typeof payload === 'object' && typeof payload.documentHtmlSnapshot === 'string') {
      args[1] = { ...payload, documentHtmlSnapshot: normalizeSnapshotHtml(payload.documentHtmlSnapshot, documentRef) };
    }
    return original.apply(this, args);
  };
}

function refreshProposalScreen(root = document) {
  ensureTypeFilterOptions(root);
  ensureSummerTab(root);
  updateSummerCounts(root);
}

function installObservers(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef?.documentElement || typeof scope.MutationObserver !== 'function') return;
  new scope.MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (!(node instanceof scope.Element)) return;
      if (node.matches?.('.proposal-document') || node.querySelector?.('.proposal-document')) normalizeProposalWorkflowDocument(node);
    }));
  }).observe(documentRef.documentElement, { childList: true, subtree: true });

  let queued = false;
  const queueRefresh = (mutations = []) => {
    const relevant = !mutations.length || mutations.some((mutation) => Array.from(mutation.addedNodes)
      .some((node) => node instanceof scope.Element && (node.matches?.('.ds-pa-screen, [data-pa-table], tr[data-pa-row-id]') || node.querySelector?.('.ds-pa-screen, [data-pa-table], tr[data-pa-row-id]'))));
    if (!relevant || queued) return;
    queued = true;
    const run = () => {
      queued = false;
      refreshProposalScreen(documentRef);
    };
    if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(run);
    else scope.setTimeout(run, 0);
  };
  new scope.MutationObserver(queueRefresh).observe(documentRef.getElementById('app') || documentRef.documentElement, { childList: true, subtree: true });
  queueRefresh();
}

export function installProposalWorkflowCompletion(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  wrapPayloadMethod(targetApi, 'proposalsAgreements');
  wrapPricingMethod(targetApi, 'readProposalActivityPricing');
  memoizeEditorDeps(targetApi);
  wrapSnapshotMethod(targetApi, 'uploadProposalFinalPdf', scope.document);
  wrapSnapshotMethod(targetApi, 'lockAndSendProposalAgreement', scope.document);
  wrapSnapshotMethod(targetApi, 'uploadGefenApprovalDocument', scope.document);
  setProposalPdfDocumentNormalizer(normalizeProposalWorkflowDocument);

  scope.document?.addEventListener('input', proposalFormEvent, true);
  scope.document?.addEventListener('change', proposalFormEvent, true);
  installObservers(scope);
  prewarmEditorDeps(targetApi, scope);

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installProposalWorkflowCompletion(api, globalThis);
