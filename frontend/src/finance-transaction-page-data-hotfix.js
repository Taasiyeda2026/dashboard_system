import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const PAGE_SIZE = 1000;
const SCHOOL_CACHE_TTL_MS = 15 * 60 * 1000;

let schoolsCache = null;
let schoolsCacheAt = 0;
let schoolsInflight = null;

function text(value) {
  return String(value ?? '').trim();
}

async function readAllPages(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

async function readAllFinanceSchools() {
  const now = Date.now();
  if (schoolsCache && now - schoolsCacheAt < SCHOOL_CACHE_TTL_MS) return schoolsCache;
  if (schoolsInflight) return schoolsInflight;
  if (!supabase) throw new Error('finance_school_catalog_unavailable');

  schoolsInflight = (async () => {
    await waitForSupabaseAuthSession();
    const rows = await readAllPages((from, to) => supabase
      .from('schools')
      .select('id,semel_mosad,school_name')
      .order('id', { ascending: true })
      .range(from, to));
    schoolsCache = rows;
    schoolsCacheAt = Date.now();
    return rows;
  })().finally(() => {
    schoolsInflight = null;
  });

  return schoolsInflight;
}

async function readFinanceTransactionContext() {
  if (!supabase) throw new Error('finance_transaction_context_unavailable');
  await waitForSupabaseAuthSession();
  const [cancelled, accounts, schools] = await Promise.all([
    readAllPages((from, to) => supabase
      .from('course_meeting_cancellations')
      .select('activity_id,meeting_date')
      .order('activity_id', { ascending: true })
      .order('meeting_date', { ascending: true })
      .range(from, to)),
    readAllPages((from, to) => supabase
      .from('finance_transaction_accounts')
      .select('*,finance_transaction_account_lines(*,finance_transaction_account_meetings(*))')
      .order('issue_date', { ascending: false })
      .range(from, to)),
    readAllFinanceSchools()
  ]);
  return { cancelled, accounts, schools };
}

function isFinanceActivityRequest(filters = {}) {
  const select = text(filters.select);
  return text(filters.activity_period) === 'school_2027'
    && select.includes('price')
    && select.includes('sessions')
    && select.includes('contact_email')
    && select.includes('school_id');
}

function financeActivitySelect(select) {
  const value = text(select);
  if (!value || value.includes('school_contact_id')) return value;
  return `${value},school_contact_id`;
}

function applyResolvedActivityContact(row = {}) {
  const resolvedEmail = text(row.resolved_contact_email);
  const resolvedName = text(row.resolved_contact_name);
  const resolvedPhone = text(row.resolved_contact_phone);
  return {
    ...row,
    contact_email: resolvedEmail || text(row.contact_email),
    contact_name: resolvedName || text(row.contact_name),
    contact_phone: resolvedPhone || text(row.contact_phone)
  };
}

function patchFinanceApi(api) {
  if (!api || api.__financeTransactionPageDataPatched) return;
  const originalAllActivities = api.allActivities?.bind(api);

  if (originalAllActivities) {
    api.allActivities = async (filters = {}) => {
      const financeRequest = isFinanceActivityRequest(filters);
      const patchedFilters = financeRequest
        ? { ...filters, select: financeActivitySelect(filters.select) }
        : filters;
      const result = await originalAllActivities(patchedFilters);
      if (!financeRequest || !Array.isArray(result?.rows)) return result;
      return { ...result, rows: result.rows.map(applyResolvedActivityContact) };
    };
  }

  api.financeTransactionContext = readFinanceTransactionContext;
  Object.defineProperty(api, '__financeTransactionPageDataPatched', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

if (typeof window !== 'undefined') {
  const apiModule = await import('./api.js');
  patchFinanceApi(apiModule?.api);
}

export { applyResolvedActivityContact, financeActivitySelect, isFinanceActivityRequest, patchFinanceApi, readAllPages };
