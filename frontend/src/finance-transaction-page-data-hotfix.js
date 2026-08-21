import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const PAGE_SIZE = 1000;
const CONTACT_BATCH_SIZE = 200;
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

function contactIsActive(contact = {}) {
  return text(contact.active) !== 'לא פעיל';
}

async function readContactsBy(column, values = []) {
  if (!supabase || !values.length) return [];
  const rows = [];
  for (let index = 0; index < values.length; index += CONTACT_BATCH_SIZE) {
    const batch = values.slice(index, index + CONTACT_BATCH_SIZE);
    const { data, error } = await supabase
      .from('contacts_schools')
      .select('id,school_id,contact_name,contact_role,phone,mobile,email,active')
      .in(column, batch);
    if (error) throw error;
    rows.push(...(Array.isArray(data) ? data : []));
  }
  return rows;
}

async function readFinanceActivityContacts(rows = []) {
  const contactIds = [...new Set(rows.map((row) => text(row.school_contact_id)).filter(Boolean))];
  const schoolIds = [...new Set(rows.map((row) => text(row.school_id)).filter(Boolean))];
  const [linked, schoolContacts] = await Promise.all([
    readContactsBy('id', contactIds),
    readContactsBy('school_id', schoolIds)
  ]);
  return [...new Map([...linked, ...schoolContacts].map((row) => [String(row.id), row])).values()];
}

function applyResolvedActivityContact(row = {}, contacts = []) {
  const active = contacts.filter(contactIsActive);
  const savedId = text(row.school_contact_id);
  let selected = savedId
    ? active.find((contact) => text(contact.id) === savedId) || null
    : null;

  if (!selected) {
    const schoolId = text(row.school_id);
    const matches = schoolId
      ? active.filter((contact) => text(contact.school_id) === schoolId)
      : [];
    if (matches.length === 1) selected = matches[0];
  }

  const resolvedEmail = text(selected?.email) || text(row.contact_email);
  return {
    ...row,
    resolved_contact_email: resolvedEmail,
    resolved_contact_name: text(selected?.contact_name) || text(row.contact_name),
    resolved_contact_phone: text(selected?.mobile) || text(selected?.phone) || text(row.contact_phone),
    resolved_contact_role: text(selected?.contact_role) || text(row.contact_role),
    contact_email: resolvedEmail
  };
}

function patchFinanceApi(targetApi) {
  if (!targetApi || targetApi.__financeTransactionPageDataPatched) return;
  const originalAllActivities = targetApi.allActivities?.bind(targetApi);

  if (originalAllActivities) {
    targetApi.allActivities = async (filters = {}) => {
      const financeRequest = isFinanceActivityRequest(filters);
      const patchedFilters = financeRequest
        ? { ...filters, select: financeActivitySelect(filters.select) }
        : filters;
      const result = await originalAllActivities(patchedFilters);
      if (!financeRequest || !Array.isArray(result?.rows)) return result;
      const contacts = await readFinanceActivityContacts(result.rows);
      return { ...result, rows: result.rows.map((row) => applyResolvedActivityContact(row, contacts)) };
    };
  }

  targetApi.financeTransactionContext = readFinanceTransactionContext;
  Object.defineProperty(targetApi, '__financeTransactionPageDataPatched', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

if (typeof window !== 'undefined') {
  import('./api.js')
    .then((apiModule) => patchFinanceApi(apiModule?.api))
    .catch((error) => console.error('[finance] transaction page data patch failed', error));
}

export {
  applyResolvedActivityContact,
  financeActivitySelect,
  isFinanceActivityRequest,
  patchFinanceApi,
  readAllPages,
  readFinanceActivityContacts
};
