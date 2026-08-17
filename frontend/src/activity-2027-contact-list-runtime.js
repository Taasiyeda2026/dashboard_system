import { api } from './api.js';
import { supabase } from './supabase-client.js';
import { withResolvedSchool2027Contact } from './screens/shared/school-2027-contact.js';

const PATCH_KEY = Symbol.for('taasiyeda.activity2027ContactList');
const CONTACT_ENRICHMENT_METHODS = ['activities', 'allActivities'];

function text(value) {
  return String(value ?? '').trim();
}

function isSchool2027(row = {}) {
  return text(row.activity_season ?? row.activitySeason) === 'school_2027';
}

function mergeActivityContactMeta(row = {}, metaByRowId = new Map()) {
  const rowId = text(row.RowID || row.row_id);
  const meta = metaByRowId.get(rowId) || {};
  return {
    ...row,
    school_contact_id: meta.school_contact_id ?? row.school_contact_id ?? null,
    contact_name: text(meta.contact_name) || text(row.contact_name),
    contact_phone: text(meta.contact_phone) || text(row.contact_phone),
    contact_email: text(meta.contact_email) || text(row.contact_email)
  };
}

async function readActivityContactMetadata(rows = []) {
  const rowIds = [...new Set(rows.map((row) => text(row.RowID || row.row_id)).filter(Boolean))];
  if (!rowIds.length) return new Map();
  const { data, error } = await supabase
    .from('activities')
    .select('row_id,school_contact_id,contact_name,contact_phone,contact_email')
    .in('row_id', rowIds);
  if (error) throw error;
  return new Map((Array.isArray(data) ? data : []).map((row) => [text(row.row_id), row]));
}

async function readRelevantSchoolContacts(rows = []) {
  const contactIds = [...new Set(rows.map((row) => text(row.school_contact_id)).filter(Boolean))];
  const schoolIds = [...new Set(rows.map((row) => text(row.school_id)).filter(Boolean))];
  const columns = 'id,school_id,authority,school,contact_name,contact_role,phone,mobile,email,active';
  const requests = [];
  if (contactIds.length) {
    requests.push(
      supabase.from('contacts_schools').select(columns).in('id', contactIds).neq('active', 'לא פעיל').limit(1000)
    );
  }
  if (schoolIds.length) {
    requests.push(
      supabase.from('contacts_schools').select(columns).in('school_id', schoolIds).neq('active', 'לא פעיל').limit(1000)
    );
  }
  if (!requests.length) return [];
  const results = await Promise.all(requests);
  const byId = new Map();
  for (const result of results) {
    if (result?.error) throw result.error;
    for (const contact of (Array.isArray(result?.data) ? result.data : [])) {
      byId.set(text(contact.id), contact);
    }
  }
  return [...byId.values()];
}

export async function enrichSchool2027ActivityContacts(payload = {}) {
  if (!supabase || !Array.isArray(payload?.rows)) return payload;
  const school2027Rows = payload.rows.filter(isSchool2027);
  if (!school2027Rows.length) return payload;

  const metaByRowId = await readActivityContactMetadata(school2027Rows);
  const rowsWithMeta = payload.rows.map((row) => (
    isSchool2027(row) ? mergeActivityContactMeta(row, metaByRowId) : row
  ));
  const contactRows = await readRelevantSchoolContacts(rowsWithMeta.filter(isSchool2027));
  return {
    ...payload,
    rows: rowsWithMeta.map((row) => (
      isSchool2027(row) ? withResolvedSchool2027Contact(row, contactRows) : row
    ))
  };
}

function installContactEnrichmentMethod(targetApi, methodName) {
  if (typeof targetApi?.[methodName] !== 'function') return false;
  const original = targetApi[methodName].bind(targetApi);
  targetApi[methodName] = async (...args) => {
    const payload = await original(...args);
    try {
      return await enrichSchool2027ActivityContacts(payload);
    } catch (error) {
      console.warn(`[activities-2027-contact-list] ${methodName} enrichment failed`, error?.message || error);
      return payload;
    }
  };
  return true;
}

export function installActivity2027ContactListRuntime(targetApi = api) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  const installed = CONTACT_ENRICHMENT_METHODS
    .map((methodName) => installContactEnrichmentMethod(targetApi, methodName))
    .some(Boolean);
  if (!installed) return false;
  Object.defineProperty(targetApi, PATCH_KEY, { value: true });
  return true;
}

installActivity2027ContactListRuntime(api);
