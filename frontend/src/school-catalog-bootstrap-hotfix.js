import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const PATCH_KEY = Symbol.for('taasiyeda.schoolCatalogBootstrapHotfix');
const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const SCHOOL_COLUMNS = 'id,semel_mosad,school_name,authority,authority_id,active';
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
      semel_mosad: text(row.semel_mosad)
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
    console.info('[school-catalog-bootstrap]', {
      schools_count_loaded: catalogCache.school_records.length,
      authorities_count_loaded: catalogCache.authority_records.length
    });
    return catalogCache;
  })().finally(() => {
    catalogInflight = null;
  });

  return catalogInflight;
}

function preferCatalog(catalogValues, fallbackValues) {
  return Array.isArray(catalogValues) && catalogValues.length
    ? catalogValues
    : (Array.isArray(fallbackValues) ? fallbackValues : []);
}

function mergeCatalogIntoPayload(payload, catalog) {
  if (!payload || typeof payload !== 'object' || !catalog) return payload;
  const clientSettings = payload.client_settings && typeof payload.client_settings === 'object'
    ? payload.client_settings
    : {};
  const dropdown = clientSettings.dropdown_options && typeof clientSettings.dropdown_options === 'object'
    ? clientSettings.dropdown_options
    : {};

  return {
    ...payload,
    client_settings: {
      ...clientSettings,
      dropdown_options: {
        ...dropdown,
        school: preferCatalog(catalog.schools, dropdown.school),
        schools: preferCatalog(catalog.schools, dropdown.schools),
        school_records: preferCatalog(catalog.school_records, dropdown.school_records),
        authority: preferCatalog(catalog.authorities, dropdown.authority),
        authorities: preferCatalog(catalog.authorities, dropdown.authorities),
        authority_records: preferCatalog(catalog.authority_records, dropdown.authority_records)
      }
    }
  };
}

async function enrichBootstrapResult(resultPromise) {
  const payload = await resultPromise;
  try {
    return mergeCatalogIntoPayload(payload, await readFullCatalog());
  } catch (error) {
    console.warn('[school-catalog-bootstrap] full catalog load failed; keeping existing options', error);
    return payload;
  }
}

export function installSchoolCatalogBootstrapHotfix(targetApi = api) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  if (typeof targetApi.login === 'function') {
    const originalLogin = targetApi.login.bind(targetApi);
    targetApi.login = (...args) => enrichBootstrapResult(originalLogin(...args));
  }

  if (typeof targetApi.bootstrap === 'function') {
    const originalBootstrap = targetApi.bootstrap.bind(targetApi);
    targetApi.bootstrap = (...args) => enrichBootstrapResult(originalBootstrap(...args));
  }

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installSchoolCatalogBootstrapHotfix(api);
