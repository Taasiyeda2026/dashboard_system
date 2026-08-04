import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
import { normalizeInstructorSeniority } from './instructor-seniority.js';

function requireClient() {
  if (!supabase) throw new Error('שירות הנתונים אינו זמין כרגע.');
}

function normalizeEmpId(value) {
  const numeric = Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error('מזהה המדריך אינו תקין.');
  return numeric;
}

function nullableText(value) {
  return String(value ?? '').trim() || null;
}

export async function loadInstructorSeniorityData() {
  if (!supabase) return [];
  await waitForSupabaseAuthSession({ timeoutMs: 6000 });
  const { data, error } = await supabase
    .from('contacts_instructors')
    .select('emp_id,seniority_years')
    .order('emp_id');
  if (error) {
    console.warn('[instructor-seniority] read failed', error);
    throw new Error(error.message || 'טעינת הוותק של המדריכים נכשלה.');
  }
  return Array.isArray(data) ? data : [];
}

export async function saveInstructorContactDetails(row = {}) {
  requireClient();
  await waitForSupabaseAuthSession({ timeoutMs: 6000 });
  const empId = normalizeEmpId(row.emp_id);
  const payload = {
    full_name: nullableText(row.full_name),
    mobile: nullableText(row.mobile),
    email: nullableText(row.email),
    address: nullableText(row.address),
    employment_type: nullableText(row.employment_type),
    direct_manager: nullableText(row.direct_manager),
    active: String(row.active || 'yes').trim() || 'yes',
    seniority_years: normalizeInstructorSeniority(row.seniority_years)
  };
  const { data, error } = await supabase
    .from('contacts_instructors')
    .update(payload)
    .eq('emp_id', empId)
    .select('emp_id,full_name,mobile,email,address,employment_type,direct_manager,active,seniority_years')
    .single();
  if (error) throw new Error(error.message || 'שמירת פרטי המדריך נכשלה.');
  return data;
}
