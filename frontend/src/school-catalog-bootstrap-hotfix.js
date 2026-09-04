import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const SCHOOL_COLUMNS = 'id,semel_mosad,school_name,authority,authority_id,sector,active';
const AUTHORITY_COLUMNS = 'id,authority_name,authority_code,active';

let catalogCache = null;
let catalogCacheAt = 0;
let catalogInflight = null;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function isActive(value) {
  if (value === false || value === 0) return false;
  const normalized = text(value).toLowerCase();
  return !['no', '0', 'false', 'inactive', 'לא', 'לא פעיל'].includes(normalized);
}

function uniqueSorted(values = []) {
  const collator = new Intl.Collator('he', { sensitivity: 'base', numeric: true });
  return [...new Set(values.map(text).filter(Boolean))].sort(collator.compare);
}

async function readAllPages({ table, columns, order = [] }) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(columns);
    order.forEach(([column, options]) => {
      query = query.order(column, options);
    });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildCatalog(schoolRows = [], authorityRows = []) {
  const collator = new Intl.Collator('he', { sensitivity: 'base', numeric: true });
  const schoolRecords = (Array.isArray(schoolRows) ? schoolRows : [])
    .filter((row) => isActive(row?.active) && text(row?.school_name))
    .map((row) => ({
      name: text(row.school_name),
      value: text(row.school_name),
      school_id: text(row.id),
      authority_id: text(row.authority_id),
      authority: text(row.authority),
      semel_mosad: text(row.semel_mosad),
      sector: text(row.sector)
    }))
    .sort((a, b) => collator.compare(a.authority, b.authority) || collator.compare(a.name, b.name));

  const authorityRecords = (Array.isArray(authorityRows) ? authorityRows : [])
    .filter((row) => isActive(row?.active) && text(row?.authority_name))
    .map((row) => ({
      id: text(row.id),
      name: text(row.authority_name),
      value: text(row.authority_name),
      authority_code: text(row.authority_code)
    }))
    .sort((a, b) => collator.compare(a.name, b.name));

  return {
    schools: uniqueSorted(schoolRecords.map((row) => row.name)),
    school_records: schoolRecords,
    authorities: uniqueSorted(authorityRecords.map((row) => row.name)),
    authority_records: authorityRecords
  };
}

async function readFullCatalog() {
  const now = Date.now();
  if (catalogCache && now - catalogCacheAt < CACHE_TTL_MS) return catalogCache;
  if (catalogInflight) return catalogInflight;
  if (!supabase) throw new Error('school_catalog_supabase_unavailable');

  catalogInflight = (async () => {
    await waitForSupabaseAuthSession();
    const [schools, authorities] = await Promise.all([
      readAllPages({
        table: 'schools',
        columns: SCHOOL_COLUMNS,
        order: [
          ['authority', { ascending: true }],
          ['school_name', { ascending: true }],
          ['id', { ascending: true }]
        ]
      }),
      readAllPages({
        table: 'authorities',
        columns: AUTHORITY_COLUMNS,
        order: [
          ['authority_name', { ascending: true }],
          ['id', { ascending: true }]
        ]
      })
    ]);
    catalogCache = buildCatalog(schools, authorities);
    catalogCacheAt = Date.now();
    // eslint-disable-next-line no-console
    console.info('[school-catalog]', {
      schools_count_loaded: catalogCache.school_records.length,
      authorities_count_loaded: catalogCache.authority_records.length
    });
    return catalogCache;
  })().finally(() => {
    catalogInflight = null;
  });

  return catalogInflight;
}

/**
 * Ensures the school/authority catalog is loaded and patches state.clientSettings.dropdown_options.
 *
 * - Deduplicates concurrent calls via catalogInflight — a second call while the first is in-flight
 *   returns the same Promise, so no duplicate Supabase requests are made.
 * - Caches the result for 15 minutes; subsequent calls resolve instantly.
 * - Updates state.clientSettings.dropdown_options in place so any open form immediately sees
 *   the full lists after the first load.
 *
 * @param {object} state — screen state object whose .clientSettings will be patched.
 * @returns {Promise<object|null>} — the catalog, or null if loading failed.
 */
export async function ensureSchoolAuthorityCatalogInState(state) {
  try {
    const catalog = await readFullCatalog();
    if (!catalog) return null;
    if (state && typeof state === 'object') {
      if (!state.clientSettings || typeof state.clientSettings !== 'object') {
        state.clientSettings = {};
      }
      if (!state.clientSettings.dropdown_options || typeof state.clientSettings.dropdown_options !== 'object') {
        state.clientSettings.dropdown_options = {};
      }
      const d = state.clientSettings.dropdown_options;
      // Never erase a usable bootstrap catalog when a transient/unauthenticated
      // read returns an empty result. Non-empty DB catalogs remain authoritative.
      if (catalog.school_records.length) {
        d.school = catalog.schools;
        d.schools = catalog.schools;
        d.school_records = catalog.school_records;
      }
      if (catalog.authority_records.length) {
        d.authority = catalog.authorities;
        d.authorities = catalog.authorities;
        d.authority_records = catalog.authority_records;
      }
    }
    return catalog;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[school-catalog] catalog load failed; school/authority lists may be empty', err);
    return null;
  }
}
