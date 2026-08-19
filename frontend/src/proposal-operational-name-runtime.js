import { supabase } from './supabase-client.js';

const CATALOG_ROOT_SELECTOR = '[data-pa-screen], [data-pa-proposal-detail], [data-pa-form]';
const MANUAL_ROW_SELECTOR = '[data-pa-item-row][data-pa-manual-course="yes"]';
const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);

let catalogPromise = null;
let catalogIndex = { byNumber: new Map(), aliases: new Map() };
let observer = null;
let scheduled = false;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function registerNumber(map, value, name, { overwrite = false } = {}) {
  const key = clean(value);
  const label = clean(name);
  if (!key || !label) return;
  if (overwrite || !map.has(key)) map.set(key, label);
}

function registerAlias(map, alias, operationalName) {
  const from = clean(alias);
  const to = clean(operationalName);
  if (!from || !to || from === to) return;
  map.set(from, to);
}

export function buildProposalOperationalNameIndex(listRows = [], courseRows = []) {
  const byNumber = new Map();
  const aliases = new Map();
  const listsByStableId = new Map();

  for (const row of Array.isArray(listRows) ? listRows : []) {
    const name = clean(row?.activity_name || row?.label_he || row?.label);
    const stableIds = [row?.activity_no, row?.gefen_number, row?.value].map(clean).filter(Boolean);
    for (const stableId of stableIds) {
      registerNumber(byNumber, stableId, name);
      if (!listsByStableId.has(stableId)) listsByStableId.set(stableId, row);
    }
  }

  for (const row of Array.isArray(courseRows) ? courseRows : []) {
    if (row?.is_active === false) continue;
    const stableId = clean(row?.gefen_number);
    const shortName = clean(row?.short_name);
    if (!stableId || !shortName) continue;

    registerNumber(byNumber, stableId, shortName, { overwrite: true });
    registerAlias(aliases, row?.full_name, shortName);

    const listRow = listsByStableId.get(stableId);
    if (listRow) {
      registerAlias(aliases, listRow.activity_name, shortName);
      registerAlias(aliases, listRow.label_he, shortName);
      registerAlias(aliases, listRow.label, shortName);
      registerNumber(byNumber, listRow.activity_no, shortName, { overwrite: true });
      registerNumber(byNumber, listRow.gefen_number, shortName, { overwrite: true });
      registerNumber(byNumber, listRow.value, shortName, { overwrite: true });
    }
  }

  return { byNumber, aliases };
}

export function operationalProposalName(item = {}, index = catalogIndex) {
  const stableIds = [item?.activity_no, item?.activityNo, item?.gefen_number, item?.gefenNumber]
    .map(clean)
    .filter(Boolean);
  for (const stableId of stableIds) {
    const name = index?.byNumber?.get(stableId);
    if (name) return name;
  }
  return clean(item?.item_name || item?.itemName || item?.activity_name || item?.activityName);
}

async function loadCatalogIndex() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = Promise.all([
    supabase
      .from('lists')
      .select('list_id,value,label,label_he,activity_no,gefen_number,activity_name,activity_type,active,is_active')
      .eq('category', 'activity_names'),
    supabase
      .from('proposal_gefen_courses')
      .select('gefen_number,short_name,full_name,is_active')
      .eq('is_active', true)
  ]).then(([listsResult, coursesResult]) => {
    if (listsResult?.error) throw listsResult.error;
    if (coursesResult?.error) throw coursesResult.error;
    const listRows = (Array.isArray(listsResult?.data) ? listsResult.data : [])
      .filter((row) => row?.is_active !== false && row?.active !== false);
    catalogIndex = buildProposalOperationalNameIndex(listRows, coursesResult?.data || []);
    return catalogIndex;
  }).catch((error) => {
    console.warn('[proposal-operational-name] catalog load failed', error);
    return catalogIndex;
  });
  return catalogPromise;
}

function rowStableId(row) {
  return clean(
    row.querySelector('input[name="activity_no"]')?.value
    || row.querySelector('input[name="gefen_number"]')?.value
  );
}

function syncProposalEditorRows(root = document) {
  const rows = root.querySelectorAll?.('[data-pa-item-row]') || [];
  for (const row of rows) {
    if (row.matches(MANUAL_ROW_SELECTOR)) continue;
    const stableId = rowStableId(row);
    const name = stableId ? catalogIndex.byNumber.get(stableId) : '';
    if (!name) continue;

    const nameInputs = row.querySelectorAll('input[name="item_name"], [data-pa-details-item-name-input]');
    for (const input of nameInputs) {
      if ('value' in input && input.value !== name) input.value = name;
    }
  }
}

function alignVisibleProposalNames(root = document) {
  const aliases = catalogIndex.aliases;
  if (!aliases.size || typeof document === 'undefined') return;

  const hosts = root.matches?.(CATALOG_ROOT_SELECTOR)
    ? [root]
    : [...(root.querySelectorAll?.(CATALOG_ROOT_SELECTOR) || [])];

  for (const host of hosts) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parentTag = node.parentElement?.tagName;
      if (parentTag && SKIP_TEXT_TAGS.has(parentTag)) continue;
      let nextText = node.nodeValue || '';
      for (const [formalName, operationalName] of aliases) {
        if (nextText.includes(formalName)) nextText = nextText.replaceAll(formalName, operationalName);
      }
      if (nextText !== node.nodeValue) node.nodeValue = nextText;
    }
  }
}

function applyAlignment(root = document) {
  syncProposalEditorRows(root);
  alignVisibleProposalNames(root);
}

function scheduleAlignment(root = document) {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    applyAlignment(root);
  });
}

function bindRuntime() {
  if (typeof document === 'undefined' || !supabase) return;

  document.addEventListener('change', (event) => {
    if (!event.target?.closest?.('[data-pa-item-row]')) return;
    scheduleAlignment(document);
    setTimeout(() => applyAlignment(document), 0);
  });

  document.addEventListener('submit', (event) => {
    if (!event.target?.matches?.('[data-pa-form]')) return;
    syncProposalEditorRows(event.target);
  }, true);

  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes?.length)) scheduleAlignment(document);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  loadCatalogIndex().then(() => applyAlignment(document));
}

bindRuntime();
