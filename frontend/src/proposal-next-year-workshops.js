import { api } from './api.js';
import { setProposalPdfDocumentNormalizer } from './screens/proposals-agreements.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearWorkshops');
const NEXT_YEAR_GROUP = 'next_year';
const NEXT_YEAR_COURSES_GROUP = 'next_year_courses';
const NEXT_YEAR_WORKSHOPS_GROUP = 'next_year_workshops';
const NEXT_YEAR_GROUP_LABELS = Object.freeze({
  [NEXT_YEAR_COURSES_GROUP]: 'תשפ״ז (קורסים)',
  [NEXT_YEAR_WORKSHOPS_GROUP]: 'תשפ״ז (סדנאות)'
});
/**
 * Displayed titles of the two internal areas. The proposal type itself always reads
 * תשפ״ז, so the areas are named by their own content in the editor, the preview and
 * the produced document.
 */
const NEXT_YEAR_SECTION_TITLES = Object.freeze({
  [NEXT_YEAR_COURSES_GROUP]: 'קורסים ותוכניות',
  [NEXT_YEAR_WORKSHOPS_GROUP]: 'סדנאות'
});
const AMBIGUOUS_NEXT_YEAR_LABELS = new Set(['תשפ״ז', 'תשפ"ז']);
const SUMMER_GROUP_ALIASES = new Set(['summer', 'פעילויות קיץ', 'קיץ תשפ״ו']);
const NEXT_YEAR_GROUP_ALIASES = new Set(['next_year', 'שנה הבאה', 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז', 'תשפ״ז']);
const WORKSHOP_PARENT_KEYS = new Set(['maker_workshop', 'space_workshop']);
const TABLE_SELECTOR = '.proposal-document .pa-next-year-course-table';
const workshopNames = new Set(['סדנאות STEM', 'סדנאות חלל']);

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizedGroup(row = {}) {
  return text(row.group_key || row.proposal_group || row.activity_type_group);
}

function isNextYearSourceRow(row = {}) {
  return NEXT_YEAR_GROUP_ALIASES.has(normalizedGroup(row));
}

function isSummerSourceRow(row = {}) {
  return SUMMER_GROUP_ALIASES.has(normalizedGroup(row));
}

function isEligibleWorkshopRow(row = {}) {
  if (!isSummerSourceRow(row)) return false;
  if (row.is_active_for_proposals === false) return false;
  const pricingKey = text(row.pricing_key);
  const parentKey = text(row.parent_pricing_key);
  return WORKSHOP_PARENT_KEYS.has(pricingKey) || WORKSHOP_PARENT_KEYS.has(parentKey);
}

function groupKey(row = {}) {
  return text(row.group_key || row.proposal_group);
}

function pricingIdentity(row = {}) {
  return [groupKey(row), text(row.pricing_key), text(row.activity_no), text(row.activity_name)].join('|');
}

function internalGroups(groups = []) {
  const rows = Array.isArray(groups) ? groups.map((group) => ({ ...group })) : [];
  const byKey = new Map(rows.map((group) => [text(group.group_key), group]));
  const nextYear = byKey.get(NEXT_YEAR_GROUP);
  if (nextYear) nextYear.included_group_keys = [NEXT_YEAR_COURSES_GROUP, NEXT_YEAR_WORKSHOPS_GROUP];
  if (!byKey.has(NEXT_YEAR_COURSES_GROUP)) {
    rows.push({
      group_key: NEXT_YEAR_COURSES_GROUP,
      display_name: NEXT_YEAR_GROUP_LABELS[NEXT_YEAR_COURSES_GROUP],
      template_key: 'next_year',
      included_group_keys: [],
      sort_order: 201,
      is_active: true,
      show_gefen: true,
      is_internal: true
    });
  }
  if (!byKey.has(NEXT_YEAR_WORKSHOPS_GROUP)) {
    rows.push({
      group_key: NEXT_YEAR_WORKSHOPS_GROUP,
      display_name: NEXT_YEAR_GROUP_LABELS[NEXT_YEAR_WORKSHOPS_GROUP],
      template_key: 'next_year',
      included_group_keys: [],
      sort_order: 202,
      is_active: true,
      show_gefen: false,
      is_internal: true
    });
  }
  return rows.map((group) => {
    const key = text(group.group_key);
    if (key === NEXT_YEAR_COURSES_GROUP) {
      return { ...group, display_name: NEXT_YEAR_GROUP_LABELS[key], template_key: 'next_year', show_gefen: true, is_internal: true };
    }
    if (key === NEXT_YEAR_WORKSHOPS_GROUP) {
      return { ...group, display_name: NEXT_YEAR_GROUP_LABELS[key], template_key: 'next_year', show_gefen: false, is_internal: true };
    }
    return group;
  });
}

export function augmentNextYearPricingRows(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const aliases = [];
  source.forEach((row) => {
    if (isNextYearSourceRow(row)) {
      aliases.push({
        ...row,
        proposal_group: NEXT_YEAR_COURSES_GROUP,
        group_key: NEXT_YEAR_COURSES_GROUP,
        template_key: 'next_year'
      });
    }
    if (isEligibleWorkshopRow(row)) {
      const name = text(row.activity_name);
      if (name) workshopNames.add(name);
      const isBundleParent = WORKSHOP_PARENT_KEYS.has(text(row.pricing_key));
      aliases.push({
        ...row,
        proposal_group: NEXT_YEAR_WORKSHOPS_GROUP,
        group_key: NEXT_YEAR_WORKSHOPS_GROUP,
        template_key: 'next_year',
        item_type: 'סדנה',
        gefen_number: '',
        meetings_count: null,
        hours_count: null,
        unit_duration: text(row.unit_duration) || '45 דקות',
        hourly_price: row.hourly_price != null ? row.hourly_price : row.unit_price,
        proposal_display_mode: isBundleParent ? 'bundle_parent' : 'single',
        is_bundle_parent: isBundleParent
      });
    }
  });
  const seen = new Set(source.map(pricingIdentity));
  return [...source, ...aliases.filter((row) => {
    const identity = pricingIdentity(row);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  })];
}

export function augmentNextYearProposalPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    proposalActivityGroups: internalGroups(payload.proposalActivityGroups),
    proposalActivityPricing: augmentNextYearPricingRows(payload.proposalActivityPricing)
  };
}

function numericValue(value) {
  const cleaned = text(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[^0-9.,-]/g, '')
    .replace(/,/g, '');
  if (!cleaned || cleaned === '-' || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
}

function currencyHtml(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `<span class="pa-currency-amount money-amount" dir="ltr">₪&nbsp;${Math.round(number).toLocaleString('he-IL')}</span>`;
}

function workshopRowData(row) {
  const cells = Array.from(row?.cells || []);
  if (cells.length < 7) return null;
  const name = text(cells[0]?.textContent);
  if (!workshopNames.has(name)) return null;
  const quantity = numericValue(cells[3]?.textContent) ?? 1;
  const total = numericValue(cells[6]?.textContent);
  let unitPrice = numericValue(cells[5]?.textContent);
  if (unitPrice == null && total != null && quantity > 0) unitPrice = total / quantity;
  return { nameHtml: cells[0]?.innerHTML || name, quantity, unitPrice, total, sourceRow: row };
}

function sumRows(rows = []) {
  return rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
}

function workshopTableHtml(rows, totalLabel, totalValue) {
  const body = rows.map((row) => `<tr>
    <td>${row.nameHtml}</td><td>45 דקות</td><td>${row.quantity.toLocaleString('he-IL')}</td>
    <td>${currencyHtml(row.unitPrice)}</td><td>${currencyHtml(row.total)}</td>
  </tr>`).join('');
  return `<table class="pa-item-details-table pa-activities-table pa-next-year-workshop-table" style="width:85%;margin-inline:auto;table-layout:fixed;">
    <colgroup><col style="width:32%"><col style="width:17%"><col style="width:14%"><col style="width:18%"><col style="width:19%"></colgroup>
    <thead><tr><th>סדנה</th><th>משך פעילות</th><th>כמות</th><th>מחיר להפעלה</th><th>סה״כ</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="pa-course-total-row"><td colspan="4">${totalLabel}</td><td>${currencyHtml(totalValue)}</td></tr></tfoot>
  </table>`;
}

function heading(documentRef, label, className) {
  const element = documentRef.createElement('h4');
  element.className = `pa-section-heading ${className}`;
  element.textContent = label;
  element.style.cssText = 'width:85%;margin:10px auto 5px;text-align:right;';
  return element;
}

function tableGrandTotal(table) {
  const amounts = Array.from(table.querySelectorAll('tfoot .pa-currency-amount, tfoot .money-amount'));
  for (let index = amounts.length - 1; index >= 0; index -= 1) {
    const value = numericValue(amounts[index].textContent);
    if (value != null) return value;
  }
  const footerCells = Array.from(table.querySelectorAll('tfoot td')).reverse();
  for (const cell of footerCells) {
    const value = numericValue(cell.textContent);
    if (value != null) return value;
  }
  return null;
}

function courseRowsTotal(table) {
  return Array.from(table.querySelectorAll('tbody > tr')).reduce((sum, row) => {
    const cells = Array.from(row.cells || []);
    return sum + (numericValue(cells[6]?.textContent) || 0);
  }, 0);
}

function replaceCourseFooter(table, label, total) {
  const footer = table.tFoot || table.createTFoot();
  footer.innerHTML = `<tr class="pa-course-total-row"><td colspan="6">${label}</td><td>${currencyHtml(total)}</td></tr>`;
}

function elementsMatching(root, selector) {
  const elements = [];
  if (root?.matches?.(selector)) elements.push(root);
  root?.querySelectorAll?.(selector).forEach((element) => elements.push(element));
  return elements;
}

function normalizeNextYearTableLayout(table) {
  if (!table?.style) return;
  table.style.width = '85%';
  table.style.marginInline = 'auto';
  table.style.tableLayout = 'fixed';
}

function setElementText(element, value) {
  if (element && text(element.textContent) !== value) element.textContent = value;
}

export function normalizeNextYearGroupLabels(root = globalThis.document) {
  Object.entries(NEXT_YEAR_SECTION_TITLES).forEach(([groupKey, title]) => {
    elementsMatching(root, `[data-pa-items-group="${groupKey}"] .ds-pa-items-section-label`)
      .forEach((element) => setElementText(element, title));
  });

  elementsMatching(root, '.proposal-document').forEach((documentElement) => {
    const ambiguousHeadings = Array.from(documentElement.querySelectorAll('.pa-section > .pa-section-heading'))
      .filter((element) => AMBIGUOUS_NEXT_YEAR_LABELS.has(text(element.textContent)));
    if (ambiguousHeadings.length < 2) return;
    setElementText(ambiguousHeadings[0], NEXT_YEAR_SECTION_TITLES[NEXT_YEAR_COURSES_GROUP]);
    setElementText(ambiguousHeadings[1], NEXT_YEAR_SECTION_TITLES[NEXT_YEAR_WORKSHOPS_GROUP]);
  });
  return root;
}

function splitNextYearTable(table) {
  if (!table) return false;
  normalizeNextYearTableLayout(table);
  if (table.dataset.nextYearWorkshopsSplit === 'yes') return false;
  const documentRef = table.ownerDocument;
  const workshopRows = Array.from(table.querySelectorAll('tbody > tr')).map(workshopRowData).filter(Boolean);
  if (!workshopRows.length) return false;

  const originalGrandTotal = tableGrandTotal(table);
  workshopRows.forEach((row) => row.sourceRow.remove());
  const hasCourseRows = Boolean(table.querySelector('tbody > tr'));
  const workshopTotal = sumRows(workshopRows);
  const effectiveGrandTotal = originalGrandTotal ?? (workshopTotal + courseRowsTotal(table));
  const template = documentRef.createElement('template');
  template.innerHTML = workshopTableHtml(
    workshopRows,
    hasCourseRows ? 'סה״כ סדנאות' : 'סה״כ לתשלום',
    hasCourseRows ? workshopTotal : effectiveGrandTotal
  );
  const workshopTable = template.content.firstElementChild;
  workshopTable.dataset.nextYearWorkshopsSplit = 'yes';

  if (!hasCourseRows) {
    table.replaceWith(heading(documentRef, 'סדנאות', 'pa-next-year-workshop-heading'), workshopTable);
    return true;
  }

  table.dataset.nextYearWorkshopsSplit = 'yes';
  replaceCourseFooter(table, 'סה״כ קורסים', courseRowsTotal(table));
  table.parentNode.insertBefore(heading(documentRef, 'קורסים ותוכניות', 'pa-next-year-course-heading'), table);
  const workshopHeading = heading(documentRef, 'סדנאות', 'pa-next-year-workshop-heading');
  table.after(workshopHeading, workshopTable);

  const summary = documentRef.createElement('table');
  summary.className = 'pa-cost-table pa-activities-table pa-next-year-combined-total';
  summary.style.cssText = 'width:85%;margin:8px auto 0;';
  summary.innerHTML = `<tbody><tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${currencyHtml(effectiveGrandTotal)}</strong></td></tr></tbody>`;
  workshopTable.after(summary);
  return true;
}

export function normalizeNextYearWorkshopTables(root = globalThis.document) {
  const tables = [];
  if (root?.matches?.(TABLE_SELECTOR)) tables.push(root);
  root?.querySelectorAll?.(TABLE_SELECTOR).forEach((table) => tables.push(table));
  tables
    .forEach(splitNextYearTable);
  normalizeNextYearGroupLabels(root);
  return root;
}

export function normalizeNextYearWorkshopHtml(html, documentRef = globalThis.document) {
  const source = String(html == null ? '' : html);
  if (!source || !documentRef?.createElement) return source;
  const template = documentRef.createElement('template');
  template.innerHTML = source;
  normalizeNextYearWorkshopTables(template.content);
  return template.innerHTML;
}

function wrapSnapshotMethod(targetApi, methodName, documentRef) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function nextYearWorkshopSnapshot(...args) {
    const payload = args[1];
    if (payload && typeof payload === 'object' && typeof payload.documentHtmlSnapshot === 'string') {
      args[1] = { ...payload, documentHtmlSnapshot: normalizeNextYearWorkshopHtml(payload.documentHtmlSnapshot, documentRef) };
    }
    return original.apply(this, args);
  };
}

export function installProposalNextYearWorkshops(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  const originalLoader = targetApi.proposalsAgreements;
  if (typeof originalLoader === 'function') {
    targetApi.proposalsAgreements = async function nextYearWorkshopsLoader(...args) {
      return augmentNextYearProposalPayload(await originalLoader.apply(this, args));
    };
  }
  // Editor opens through a deferred deps loader; it must receive the same
  // course/workshop aliases as the main proposalsAgreements payload.
  const originalEditorDeps = targetApi.proposalsAgreementsEditorDeps;
  if (typeof originalEditorDeps === 'function') {
    targetApi.proposalsAgreementsEditorDeps = async function nextYearWorkshopsEditorDeps(...args) {
      return augmentNextYearProposalPayload(await originalEditorDeps.apply(this, args));
    };
  }
  const originalPricing = targetApi.readProposalActivityPricing;
  if (typeof originalPricing === 'function') {
    targetApi.readProposalActivityPricing = async function nextYearWorkshopsPricing(...args) {
      return augmentNextYearPricingRows(await originalPricing.apply(this, args));
    };
  }
  const originalGroups = targetApi.readProposalActivityGroups;
  if (typeof originalGroups === 'function') {
    targetApi.readProposalActivityGroups = async function nextYearWorkshopGroups(...args) {
      return internalGroups(await originalGroups.apply(this, args));
    };
  }

  const documentRef = scope?.document;
  wrapSnapshotMethod(targetApi, 'uploadProposalFinalPdf', documentRef);
  wrapSnapshotMethod(targetApi, 'lockAndSendProposalAgreement', documentRef);
  setProposalPdfDocumentNormalizer((host) => normalizeNextYearWorkshopTables(host));

  Object.defineProperty(targetApi, PATCH_KEY, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}
