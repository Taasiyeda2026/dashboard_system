import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';

export const INSTRUCTOR_WEEKDAYS = [
  { value: 0, label: 'יום ראשון' },
  { value: 1, label: 'יום שני' },
  { value: 2, label: 'יום שלישי' },
  { value: 3, label: 'יום רביעי' },
  { value: 4, label: 'יום חמישי' },
  { value: 5, label: 'יום שישי' },
  { value: 6, label: 'שבת' }
];

function emptySchedulingData(error = '') {
  return { profiles: [], rules: [], exceptions: [], loaded: false, error };
}

function requireClient() {
  if (!supabase) throw new Error('שירות הנתונים אינו זמין כרגע.');
}

function normalizeTime(value, fallback = null) {
  const text = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeEmpId(value) {
  const numeric = Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error('מזהה המדריך אינו תקין.');
  return numeric;
}

export async function loadInstructorSchedulingData() {
  if (!supabase) return emptySchedulingData('no_supabase_client');
  await waitForSupabaseAuthSession({ timeoutMs: 6000 });
  const [profilesResult, rulesResult, exceptionsResult] = await Promise.all([
    supabase.from('instructor_scheduling_profiles').select('*').order('emp_id'),
    supabase.from('instructor_availability_rules').select('*').order('emp_id').order('weekday'),
    supabase.from('instructor_availability_exceptions').select('*').order('exception_date')
  ]);
  const error = profilesResult.error || rulesResult.error || exceptionsResult.error;
  if (error) {
    console.warn('[instructor-scheduling] read failed', error);
    return emptySchedulingData(String(error.message || error));
  }
  return {
    profiles: Array.isArray(profilesResult.data) ? profilesResult.data : [],
    rules: Array.isArray(rulesResult.data) ? rulesResult.data : [],
    exceptions: Array.isArray(exceptionsResult.data) ? exceptionsResult.data : [],
    loaded: true,
    error: ''
  };
}

export async function saveInstructorSchedulingProfile(row) {
  requireClient();
  const empId = normalizeEmpId(row?.emp_id);
  const payload = {
    emp_id: empId,
    default_start_time: normalizeTime(row?.default_start_time, '08:00'),
    default_end_time: normalizeTime(row?.default_end_time, '15:00'),
    friday_allowed: !!row?.friday_allowed,
    notes: String(row?.notes || '').trim() || null,
    gender: ['female', 'male'].includes(row?.gender) ? row.gender : null,
    instruction_languages: Array.isArray(row?.instruction_languages) ? row.instruction_languages.filter(v => ['he', 'ar'].includes(v)) : ['he'],
    matching_note: String(row?.matching_note || '').trim() || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('instructor_scheduling_profiles')
    .upsert(payload, { onConflict: 'emp_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message || 'שמירת הגדרות המדריך נכשלה.');
  return data;
}

export async function saveInstructorWeeklyRules(empId, rules) {
  requireClient();
  const safeEmpId = normalizeEmpId(empId);
  const rows = (Array.isArray(rules) ? rules : []).map((rule) => {
    const weekday = Number(rule?.weekday);
    const available = weekday === 6 ? false : !!rule?.available;
    return {
      emp_id: safeEmpId,
      weekday,
      available,
      start_time: available ? normalizeTime(rule?.start_time, '08:00') : null,
      end_time: available ? normalizeTime(rule?.end_time, '15:00') : null,
      notes: String(rule?.notes || '').trim() || null,
      updated_at: new Date().toISOString()
    };
  }).filter((row) => Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6);
  const { data, error } = await supabase
    .from('instructor_availability_rules')
    .upsert(rows, { onConflict: 'emp_id,weekday' })
    .select('*');
  if (error) throw new Error(error.message || 'שמירת הזמינות השבועית נכשלה.');
  return Array.isArray(data) ? data : [];
}

export async function saveInstructorAvailabilityException(row) {
  requireClient();
  const empId = normalizeEmpId(row?.emp_id);
  const exceptionDate = String(row?.exception_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exceptionDate)) throw new Error('יש לבחור תאריך תקין.');
  const available = !!row?.available;
  const payload = {
    emp_id: empId,
    exception_date: exceptionDate,
    available,
    start_time: available ? normalizeTime(row?.start_time, '08:00') : null,
    end_time: available ? normalizeTime(row?.end_time, '15:00') : null,
    notes: String(row?.notes || '').trim() || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('instructor_availability_exceptions')
    .upsert(payload, { onConflict: 'emp_id,exception_date' })
    .select('*')
    .single();
  if (error) throw new Error(error.message || 'שמירת החריג נכשלה.');
  return data;
}

export async function deleteInstructorAvailabilityException(id) {
  requireClient();
  const safeId = String(id || '').trim();
  if (!safeId) throw new Error('חסר מזהה חריג.');
  const { error } = await supabase.from('instructor_availability_exceptions').delete().eq('id', safeId);
  if (error) throw new Error(error.message || 'מחיקת החריג נכשלה.');
  return { ok: true };
}
