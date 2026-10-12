/**
 * Staff-feedback contact readiness for open school_2027 activities.
 * Crucially, activity text fields and inferred school contacts are NOT delivery recipients.
 * The authoritative path is activities.school_contact_id -> contacts_schools.id -> email.
 */
export const CONTACT_READINESS_ISSUES = Object.freeze({
  missing_selection: 'לא נבחר איש קשר',
  broken_selection: 'איש הקשר שנבחר לא נמצא',
  missing_email: 'חסרה כתובת מייל',
  invalid_email: 'כתובת מייל לא תקינה',
  wrong_school: 'איש הקשר משויך לבית ספר אחר',
  inactive_contact: 'איש הקשר אינו פעיל'
});

export const CONTACT_READINESS_ISSUE_ORDER = Object.keys(CONTACT_READINESS_ISSUES);
const VALID_EMAIL = /^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i;

export function selectedContactIssue(activity, contact) {
  if (!activity?.school_contact_id) return 'missing_selection';
  if (!contact) return 'broken_selection';
  if (String(contact.active || '').trim() === 'לא פעיל') return 'inactive_contact';
  const email = String(contact.email || '').trim();
  if (!email) return 'missing_email';
  if (!VALID_EMAIL.test(email)) return 'invalid_email';
  if (activity.school_id != null && contact.school_id != null
      && String(activity.school_id) !== String(contact.school_id)) return 'wrong_school';
  return null;
}

export function buildContactReadinessAudit(activities = [], contacts = []) {
  const byId = new Map(contacts.map(contact => [String(contact.id), contact]));
  const rows = [];
  let total = 0;
  for (const activity of activities) {
    if (activity.activity_season !== 'school_2027' || activity.status !== 'פתוח'
        || !['course', 'tour'].includes(activity.activity_type)) continue;
    total += 1;
    const contact = byId.get(String(activity.school_contact_id)) || null;
    const issue = selectedContactIssue(activity, contact);
    if (!issue) continue;
    rows.push({
      row_id: String(activity.row_id || ''),
      activity_name: String(activity.activity_name || activity.program_name || ''),
      activity_type: activity.activity_type,
      authority: String(activity.authority || ''),
      school: String(activity.school || ''),
      district: String(activity.district || ''),
      activity_manager: String(activity.activity_manager || ''),
      school_contact_id: activity.school_contact_id ?? null,
      contact_name: contact ? String(contact.contact_name || '') : '',
      contact_email: contact ? String(contact.email || '') : '',
      contact_school: contact ? String(contact.school || '') : '',
      issue
    });
  }
  rows.sort((a,b)=> (CONTACT_READINESS_ISSUE_ORDER.indexOf(a.issue)-CONTACT_READINESS_ISSUE_ORDER.indexOf(b.issue))
    || a.authority.localeCompare(b.authority,'he') || a.school.localeCompare(b.school,'he')
    || a.activity_name.localeCompare(b.activity_name,'he') || a.row_id.localeCompare(b.row_id));
  const byIssue = Object.fromEntries(CONTACT_READINESS_ISSUE_ORDER.map(key=>[key,rows.filter(r=>r.issue===key).length]));
  return { total, ready: total-rows.length, problems: rows.length, byIssue, rows };
}

export async function loadContactReadinessAudit() {
  const { supabase } = await import('../supabase-client.js');
  if (!supabase) throw new Error('Supabase אינו זמין');
  const activities = [];
  const pageSize = 500;
  for (let from=0;;from+=pageSize) {
    const { data, error } = await supabase.from('activities')
      .select('row_id,activity_name,program_name,activity_season,activity_type,status,authority,school,district,activity_manager,school_id,school_contact_id')
      .eq('activity_season','school_2027').eq('status','פתוח')
      .in('activity_type',['course','tour'])
      .order('row_id',{ascending:true}).range(from,from+pageSize-1);
    if (error) throw error;
    activities.push(...(data||[]));
    if (!data || data.length<pageSize) break;
  }
  const ids=[...new Set(activities.map(a=>a.school_contact_id).filter(id=>id!=null).map(String))];
  const contacts=[];
  for (let start=0;start<ids.length;start+=100) {
    const {data,error}=await supabase.from('contacts_schools')
      .select('id,school_id,school,contact_name,email,active')
      .in('id',ids.slice(start,start+100));
    if (error) throw error;
    contacts.push(...(data||[]));
  }
  return buildContactReadinessAudit(activities,contacts);
}
