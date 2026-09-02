import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearTableAlignment');
const COMPACT_TABLE_WIDTH = '72%';
const GROUP_SELECTOR = '.proposal-document .pa-next-year-cost-group';
const TABLE_SELECTOR = [
  '.proposal-document .pa-next-year-course-table',
  '.proposal-document .pa-next-year-activities-table',
  '.proposal-document .pa-next-year-workshop-table',
  '.proposal-document .pa-next-year-combined-total'
].join(', ');
const HEADING_SELECTOR = '.proposal-document .pa-next-year-course-heading, .proposal-document .pa-next-year-workshop-heading, .proposal-document .pa-next-year-activities-heading';

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function elementsMatching(root, selector) {
  const elements = [];
  if (root?.matches?.(selector)) elements.push(root);
  root?.querySelectorAll?.(selector).forEach((element) => elements.push(element));
  return elements;
}

function setImportantStyle(element, property, value) {
  element?.style?.setProperty?.(property, value, 'important');
}

function normalizeGroupWidth(group) {
  setImportantStyle(group, 'width', '100%');
  setImportantStyle(group, 'max-width', '100%');
  setImportantStyle(group, 'margin-inline', '0');
}

function ensureCombinedTotalColumns(table) {
  if (!table?.classList?.contains('pa-next-year-combined-total')) return;
  let colgroup = Array.from(table.children || []).find((child) => child.tagName === 'COLGROUP');
  if (!colgroup) {
    colgroup = table.ownerDocument.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }
  colgroup.innerHTML = '<col style="width:84%"><col style="width:16%">';
}

function normalizeTable(table) {
  if (!table) return;
  setImportantStyle(table, 'width', COMPACT_TABLE_WIDTH);
  setImportantStyle(table, 'max-width', COMPACT_TABLE_WIDTH);
  setImportantStyle(table, 'margin-left', 'auto');
  setImportantStyle(table, 'margin-right', 'auto');
  setImportantStyle(table, 'margin-inline', 'auto');
  setImportantStyle(table, 'table-layout', 'fixed');
  ensureCombinedTotalColumns(table);
}

function normalizeHeading(heading) {
  if (!heading) return;
  // Keep distinct course/workshop titles; only compact the layout width.
  setImportantStyle(heading, 'width', COMPACT_TABLE_WIDTH);
  setImportantStyle(heading, 'max-width', COMPACT_TABLE_WIDTH);
  setImportantStyle(heading, 'margin-left', 'auto');
  setImportantStyle(heading, 'margin-right', 'auto');
  setImportantStyle(heading, 'margin-inline', 'auto');
  setImportantStyle(heading, 'text-align', 'right');
}

export function normalizeNextYearTableAlignment(root = globalThis.document) {
  elementsMatching(root, GROUP_SELECTOR).forEach(normalizeGroupWidth);
  elementsMatching(root, TABLE_SELECTOR).forEach(normalizeTable);
  elementsMatching(root, HEADING_SELECTOR).forEach(normalizeHeading);

  elementsMatching(root, '.proposal-document .pa-section-heading').forEach((heading) => {
    if (/^(?:קורסים ותוכניות|קורסים|סדנאות)$/.test(text(heading.textContent))) {
      normalizeHeading(heading);
    }
  });
  return root;
}

export function normalizeNextYearTableAlignmentHtml(html, documentRef = globalThis.document) {
  const source = String(html == null ? '' : html);
  if (!source || !documentRef?.createElement) return source;
  const template = documentRef.createElement('template');
  template.innerHTML = source;
  normalizeNextYearTableAlignment(template.content);
  return template.innerHTML;
}

function wrapSnapshotMethod(targetApi, methodName, documentRef) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function alignedNextYearSnapshot(...args) {
    const payload = args[1];
    if (payload && typeof payload === 'object' && typeof payload.documentHtmlSnapshot === 'string') {
      args[1] = {
        ...payload,
        documentHtmlSnapshot: normalizeNextYearTableAlignmentHtml(payload.documentHtmlSnapshot, documentRef)
      };
    }
    return original.apply(this, args);
  };
}

export function installProposalNextYearTableAlignment(targetApi = api, scope = globalThis) {
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
