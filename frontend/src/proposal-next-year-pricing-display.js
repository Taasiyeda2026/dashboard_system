import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearPricingDisplay');
const TABLE_SELECTOR = '.pa-next-year-course-table, .pa-gefen-course-table, .pa-gefen-approval-table';

export const NEXT_YEAR_SHORT_NAMES_BY_GEFEN = Object.freeze({
  '6089': 'ביומימיקרי',
  '57651': 'טכנולוגיות החלל',
  '9545': 'בינה מלאכותית',
  '53828': 'ביומימיקרי לחטיבה',
  '53819': 'יישומי AI בשיתוף GOOGLE',
  '46091': 'רוקחים עולם',
  '3604': 'פורצות דרך',
  '52279': 'אופק פרימיום',
  '27342': 'משחקי קופסה',
  '67867': 'מנהיגות ירוקה',
  '57646': 'השמיים אינם הגבול'
});

function numericValue(value) {
  const cleaned = String(value == null ? '' : value)
    .replace(/\u00a0/g, ' ')
    .replace(/[^0-9.,-]/g, '')
    .replace(/,/g, '');
  if (!cleaned || cleaned === '-' || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
}

export function formatProposalHours(value) {
  const number = numericValue(value);
  if (number == null) return '';
  return number.toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
}

export function formatProposalHourlyPrice(value) {
  const number = numericValue(value);
  if (number == null) return '';
  return Math.round(number).toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function setTextIfChanged(element, value) {
  if (!element) return false;
  const next = String(value ?? '');
  if (element.textContent === next) return false;
  element.textContent = next;
  return true;
}

function normalizeCourseNameCell(cell, gefenNumber) {
  const shortName = NEXT_YEAR_SHORT_NAMES_BY_GEFEN[gefenNumber];
  if (!cell || !shortName) return;
  const namedElement = cell.querySelector?.('.pa-course-name');
  if (namedElement) {
    setTextIfChanged(namedElement, shortName);
    return;
  }
  setTextIfChanged(cell, shortName);
}

function normalizeHoursCell(cell) {
  if (!cell) return;
  const formatted = formatProposalHours(cell.textContent);
  if (formatted) setTextIfChanged(cell, formatted);
}

function normalizeHourlyPriceCell(cell) {
  if (!cell) return;
  const formatted = formatProposalHourlyPrice(cell.textContent);
  if (!formatted) return;
  const display = `₪\u00a0${formatted}`;
  const amount = cell.querySelector?.('.pa-currency-amount, .money-amount');
  if (amount) {
    setTextIfChanged(amount, display);
    return;
  }
  if (cell.textContent === display) return;
  cell.innerHTML = `<span class="pa-currency-amount money-amount" dir="ltr">${display}</span>`;
}

function tableColumnIndexes(table) {
  if (table.classList.contains('pa-gefen-approval-table')) {
    return { name: 1, gefen: 2, hours: 4, hourlyPrice: 5 };
  }
  return { name: 0, gefen: 1, hours: 4, hourlyPrice: 5 };
}

function tablesInRoot(root) {
  const tables = [];
  if (root?.matches?.(TABLE_SELECTOR)) tables.push(root);
  root?.querySelectorAll?.(TABLE_SELECTOR).forEach((table) => tables.push(table));
  return tables;
}

export function normalizeProposalPricingTables(root = globalThis.document) {
  tablesInRoot(root).forEach((table) => {
    const indexes = tableColumnIndexes(table);
    table.querySelectorAll('tbody > tr').forEach((row) => {
      const cells = Array.from(row.cells || []);
      const gefenNumber = String(cells[indexes.gefen]?.textContent || '').replace(/\D/g, '');
      normalizeCourseNameCell(cells[indexes.name], gefenNumber);
      normalizeHoursCell(cells[indexes.hours]);
      normalizeHourlyPriceCell(cells[indexes.hourlyPrice]);
    });
  });
  return root;
}

export function normalizeProposalPricingHtml(html, documentRef = globalThis.document) {
  const source = String(html == null ? '' : html);
  if (!source || !documentRef?.createElement) return source;
  const template = documentRef.createElement('template');
  template.innerHTML = source;
  normalizeProposalPricingTables(template.content);
  return template.innerHTML;
}

function wrapSnapshotMethod(targetApi, methodName, documentRef) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function normalizedProposalSnapshot(...args) {
    const payload = args[1];
    if (payload && typeof payload === 'object' && typeof payload.documentHtmlSnapshot === 'string') {
      args[1] = {
        ...payload,
        documentHtmlSnapshot: normalizeProposalPricingHtml(payload.documentHtmlSnapshot, documentRef)
      };
    }
    return original.apply(this, args);
  };
}

export function installProposalNextYearPricingDisplay(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  const documentRef = scope?.document;
  wrapSnapshotMethod(targetApi, 'uploadProposalFinalPdf', documentRef);
  wrapSnapshotMethod(targetApi, 'lockAndSendProposalAgreement', documentRef);
  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installProposalNextYearPricingDisplay(api, globalThis);
