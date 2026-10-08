/**
 * Impact feedback — admin data access. Every call is enforced server-side
 * (RLS admin policies / admin-checked SECURITY DEFINER RPCs).
 */
import { supabase } from '../supabase-client.js';

const ERROR_MESSAGES = {
  feedback_forbidden: 'אין הרשאה – רק אדמין מנהל את מודול המשובים',
  feedback_activity_not_found: 'הפעילות לא נמצאה',
  feedback_program_unresolved: 'לא זוהתה תוכנית משובים עבור הפעילות. בחרו תוכנית ידנית.',
  feedback_program_locked: 'לא ניתן לשנות תוכנית לאחר שנפתח משוב לקבוצה',
  feedback_activity_excluded: 'הפעילות סומנה כלא רלוונטית למשובים',
  feedback_invalid_program: 'תוכנית לא תקינה',
  feedback_activity_name_missing: 'לפעילות אין שם – לא ניתן להחיל לפי שם',
  feedback_template_not_published: 'אין גרסה מפורסמת לתבנית הזו',
  feedback_contact_missing: 'לא מוגדר איש קשר לקבוצה. יש להגדיר איש קשר בפעילות.',
  feedback_instructor_missing: 'לא משובץ מדריך לקבוצה.',
  feedback_invalid_window: 'מועד התפוגה חייב להיות אחרי מועד הפתיחה ובעתיד',
  feedback_invalid_stage: 'שלב מדידה לא תקין',
  feedback_version_locked: 'גרסה שפורסמה נעולה לעריכה – יש ליצור טיוטה',
  feedback_version_empty: 'לא ניתן לפרסם גרסה ללא שאלות',
  feedback_version_not_draft: 'ניתן לפרסם רק טיוטה',
  feedback_instructor_scope_program: 'משוב מדריך נפתח לפי מדריך ותוכנית, לא לפי קבוצה',
  feedback_instructor_not_assigned: 'לא נמצא שיבוץ פעיל של המדריך לתוכנית הזו',
  feedback_invalid_academic_year: 'שנת הפעילות אינה תקינה'
};

export function translateFeedbackError(error) {
  const raw = String(error?.message || error || '');
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return raw || 'שגיאה לא צפויה';
}

function client() {
  if (!supabase) throw new Error('Supabase אינו זמין');
  return supabase;
}

async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(translateFeedbackError(error));
  return data;
}

export async function fetchMetrics() {
  return unwrap(client().from('feedback_metrics').select('key,label,kind,description,sort_order').order('sort_order'));
}

export async function fetchPrograms() {
  return unwrap(client().from('feedback_programs').select('key,title,topic,catalog_program_ids,gefen_numbers,education_level,default_age_band,sort_order,is_active').order('sort_order'));
}

export async function fetchGroups(academicYear = null, activityRowId = null) {
  const rows = await unwrap(client().rpc('feedback_admin_groups', {
    p_academic_year: academicYear || null,
    p_activity_row_id: activityRowId || null
  }));
  return Array.isArray(rows) ? rows : [];
}

export async function fetchInstructorAssignments(academicYear = null) {
  const rows = await unwrap(client().rpc('feedback_admin_instructor_assignments', {
    p_academic_year: academicYear || null
  }));
  return Array.isArray(rows) ? rows : [];
}

export async function openInstructorCampaign(instructorEmpId, programKey, academicYear, stage, { opensAt = null, expiresAt = null } = {}) {
  return unwrap(client().rpc('feedback_admin_open_instructor_campaign', {
    p_instructor_emp_id: String(instructorEmpId || ''),
    p_program_key: programKey,
    p_academic_year: academicYear,
    p_stage: stage,
    p_opens_at: opensAt,
    p_expires_at: expiresAt
  }));
}

export async function openCampaign(activityRowId, audience, stage, { opensAt = null, expiresAt = null, ageBand = null } = {}) {
  return unwrap(client().rpc('feedback_admin_open_campaign', {
    p_activity_row_id: activityRowId,
    p_audience: audience,
    p_stage: stage,
    p_opens_at: opensAt,
    p_expires_at: expiresAt,
    p_age_band: ageBand
  }));
}

/** Manual program choice for an activity (feedback mapping only; activities are not modified). */
export async function setActivityProgram(activityRowId, programKey, { applyToName = false, excluded = false } = {}) {
  return unwrap(client().rpc('feedback_admin_set_program', {
    p_activity_row_id: activityRowId,
    p_program_key: programKey || null,
    p_apply_to_name: Boolean(applyToName),
    p_excluded: Boolean(excluded)
  }));
}

export async function updateCampaign(campaignId, action, { opensAt = null, expiresAt = null, channel = null } = {}) {
  return unwrap(client().rpc('feedback_admin_update_campaign', {
    p_campaign_id: campaignId,
    p_action: action,
    p_opens_at: opensAt,
    p_expires_at: expiresAt,
    p_channel: channel
  }));
}

export async function fetchAnswerFacts(filters = {}) {
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const rows = await unwrap(client().rpc('feedback_admin_answer_facts', { p_filters: clean }));
  return Array.isArray(rows) ? rows : [];
}

// --- Templates --------------------------------------------------------------

export async function fetchTemplates() {
  return unwrap(client()
    .from('feedback_templates')
    .select('id,program_key,audience,stage,title,current_version_id,feedback_template_versions!feedback_template_versions_template_id_fkey(id,version_no,status,published_at,created_at)')
    .order('program_key'));
}

export async function fetchVersionQuestions(versionId) {
  return unwrap(client()
    .from('feedback_template_questions')
    .select('id,version_id,question_id,section,sort_order,required,metric_key,question_type,is_comparison,wording,options,scoring')
    .eq('version_id', versionId)
    .order('sort_order'));
}

export async function fetchVersion(versionId) {
  return unwrap(client().from('feedback_template_versions').select('id,template_id,version_no,status,intro_text,notes,published_at,created_at').eq('id', versionId).single());
}

export async function fetchBankQuestions(programKey, audience, stage) {
  const rows = await unwrap(client()
    .from('feedback_questions')
    .select('id,question_key,program_key,metric_key,question_type,audiences,stages,is_comparison,wording,options,scoring,default_required,sort_order,is_active')
    .eq('is_active', true)
    .contains('audiences', [audience])
    .contains('stages', [stage])
    .order('sort_order'));
  return (rows || []).filter((q) => !q.program_key || q.program_key === programKey);
}

export async function getDraft(templateId) {
  return unwrap(client().rpc('feedback_admin_get_draft', { p_template_id: templateId }));
}

export async function publishDraft(versionId) {
  return unwrap(client().rpc('feedback_admin_publish_draft', { p_version_id: versionId }));
}

export async function discardDraft(versionId) {
  return unwrap(client().rpc('feedback_admin_discard_draft', { p_version_id: versionId }));
}

export async function updateVersionIntro(versionId, introText) {
  return unwrap(client().from('feedback_template_versions').update({ intro_text: introText }).eq('id', versionId));
}

export async function updateTemplateQuestion(id, patch) {
  return unwrap(client().from('feedback_template_questions').update(patch).eq('id', id));
}

export async function deleteTemplateQuestion(id) {
  return unwrap(client().from('feedback_template_questions').delete().eq('id', id));
}

export async function addBankQuestionToDraft(versionId, bankQuestion, sortOrder) {
  return unwrap(client().from('feedback_template_questions').insert({
    version_id: versionId,
    question_id: bankQuestion.id,
    section: bankQuestion.program_key ? 'course' : 'core',
    sort_order: sortOrder,
    required: bankQuestion.default_required,
    metric_key: bankQuestion.metric_key,
    question_type: bankQuestion.question_type,
    is_comparison: bankQuestion.is_comparison,
    wording: bankQuestion.wording,
    options: bankQuestion.options,
    scoring: bankQuestion.scoring
  }));
}

/** New question concept in the bank (course-specific), then attach it to the draft. */
export async function createQuestionInDraft(versionId, { programKey, audience, stage, metricKey, questionType, text, options = [], required = true, isComparison = false }, sortOrder) {
  const key = `custom_${programKey}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const stages = isComparison && audience === 'student' ? ['pre', 'post'] : [stage];
  const scoring = questionType === 'rating_1_5' ? { include_in_score: true } : { include_in_score: false };
  const bank = await unwrap(client().from('feedback_questions').insert({
    question_key: key,
    program_key: programKey,
    metric_key: metricKey,
    question_type: questionType,
    audiences: [audience],
    stages,
    is_comparison: Boolean(isComparison && audience === 'student'),
    wording: { default: text },
    options,
    scoring,
    default_required: required,
    sort_order: sortOrder
  }).select().single());
  await addBankQuestionToDraft(versionId, bank, sortOrder);
  return bank;
}
