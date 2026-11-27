/**
 * Structured working records for Gefen 2027 program workspace.
 * Legacy free-text fields are preserved; these arrays are the operational store.
 */

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function normalizeExperienceRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map((r) => ({
    id: r.id || uid('exp'),
    organization: String(r.organization || '').trim(),
    period: String(r.period || '').trim(),
    audience: String(r.audience || '').trim(),
    activity: String(r.activity || '').trim(),
    contact: String(r.contact || '').trim(),
    evidence_url: String(r.evidence_url || '').trim(),
    notes: String(r.notes || '').trim()
  }));
}

export function emptyExperienceRecord() {
  return {
    id: uid('exp'),
    organization: '',
    period: '',
    audience: '',
    activity: '',
    contact: '',
    evidence_url: '',
    notes: ''
  };
}

export function normalizeRecommendationRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map((r) => ({
    id: r.id || uid('rec'),
    organization: String(r.organization || '').trim(),
    recommender: String(r.recommender || '').trim(),
    role: String(r.role || '').trim(),
    contact: String(r.contact || '').trim(),
    date: String(r.date || '').trim(),
    document_url: String(r.document_url || '').trim(),
    status: String(r.status || 'טיוטה').trim() || 'טיוטה',
    notes: String(r.notes || '').trim()
  }));
}

export function emptyRecommendationRecord() {
  return {
    id: uid('rec'),
    organization: '',
    recommender: '',
    role: '',
    contact: '',
    date: '',
    document_url: '',
    status: 'טיוטה',
    notes: ''
  };
}

export const RECOMMENDATION_STATUSES = ['טיוטה', 'התקבל', 'אומת', 'חסר'];

export const SYLLABUS_AGE_STAGES = ['יסודי', 'חטיבה', 'תיכון', 'כללי'];

export function normalizeSyllabusSessions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((s) => s && typeof s === 'object').map((s, i) => {
    const meetingFrom = Number(s.meeting_from || s.meeting_number) || (i + 1);
    const meetingTo = Number(s.meeting_to || s.meeting_number || meetingFrom) || meetingFrom;
    const meetingNumber = Number(s.meeting_number) || meetingFrom;
    const label = String(s.meeting_label || '').trim()
      || (meetingFrom === meetingTo ? String(meetingNumber) : `${meetingFrom}–${meetingTo}`);
    return {
      id: s.id || uid('syl'),
      age_stage: String(s.age_stage || 'כללי').trim() || 'כללי',
      meeting_number: meetingNumber,
      meeting_from: meetingFrom,
      meeting_to: meetingTo,
      meeting_label: label,
      topic: String(s.topic || '').trim(),
      content: String(s.content || '').trim(),
      goals: String(s.goals || '').trim(),
      methods: String(s.methods || '').trim(),
      skills_values: String(s.skills_values || '').trim(),
      notes: String(s.notes || '').trim(),
      duration_minutes: Number(s.duration_minutes) || 0,
      source: String(s.source || '').trim(),
      source_page: Number(s.source_page) || 0,
      source_group_id: String(s.source_group_id || '').trim(),
      optional: Boolean(s.optional),
      catalog_only: s.catalog_only !== false
    };
  });
}

export function emptySyllabusSession(ageStage = 'כללי', meetingNumber = 1) {
  return {
    id: uid('syl'),
    age_stage: ageStage,
    meeting_number: meetingNumber,
    meeting_from: meetingNumber,
    meeting_to: meetingNumber,
    meeting_label: String(meetingNumber),
    topic: '',
    content: '',
    goals: '',
    methods: '',
    skills_values: '',
    notes: '',
    duration_minutes: 90,
    source: '',
    source_page: 0,
    source_group_id: '',
    optional: false,
    catalog_only: true
  };
}

/** Infer age stage from Hebrew grade ranges when known. */
export function inferAgeStageFromGrades(grades = '') {
  const g = String(grades || '');
  if (/ד['׳’]?\s*[–\-־]\s*ו/.test(g) || /יסודי/.test(g)) return 'יסודי';
  if (/ז['׳’]?\s*[–\-־]\s*[טח]/.test(g) || /חטיב/.test(g)) return 'חטיבה';
  if (/י['׳’]?\s*[–\-־]\s*י[בג]/.test(g) || /תיכון/.test(g)) return 'תיכון';
  if (/ז['׳’]?\s*[–\-־]\s*י['׳’]?/.test(g)) return 'חטיבה';
  return '';
}

export function reorderSyllabusSessions(sessions, fromId, direction) {
  const list = normalizeSyllabusSessions(sessions);
  const idx = list.findIndex((s) => s.id === fromId);
  if (idx < 0) return list;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= list.length) return list;
  const next = list.slice();
  [next[idx], next[swap]] = [next[swap], next[idx]];
  return next.map((s, i) => ({ ...s, meeting_number: i + 1 }));
}

/** Knowledge-panel projection of historical answers — no storage duplication. */
export function historicalAsKnowledgeItems(historicalAnswers = [], programId = '') {
  return (Array.isArray(historicalAnswers) ? historicalAnswers : [])
    .filter((h) => h && String(h.answer || '').trim())
    .map((h) => ({
      id: h.id || uid('hist'),
      title: h.original_question || h.question_id || 'תשובה היסטורית',
      original_question: h.original_question || h.question_id || '',
      topic: h.topic || 'תשובות ממכרזים קודמים',
      type: 'היסטורי',
      info_kind: 'היסטורי',
      content: h.answer,
      source: h.source || `מכרז ${h.tender_year || 'קודם'}`,
      source_url: h.source_url || '',
      verification_status: 'היסטורי — אינו מאושר ל־2027',
      related_questions: h.question_id ? [h.question_id] : [],
      program_id: programId,
      content_role: 'historical',
      _historical: true,
      tender_year: h.tender_year || ''
    }));
}

export function experienceFilled(payload = {}) {
  return normalizeExperienceRecords(payload.experience_records).some((r) => r.organization || r.activity)
    || Boolean(String(payload.experience || '').trim());
}

export function recommendationsFilled(payload = {}) {
  return normalizeRecommendationRecords(payload.recommendation_records).some((r) => r.organization || r.recommender || r.document_url)
    || Boolean(String(payload.recommendations || '').trim())
    || (Array.isArray(payload.recommendations_documents) && payload.recommendations_documents.length > 0);
}

export function syllabusFilled(payload = {}) {
  return normalizeSyllabusSessions(payload.syllabus_sessions).some((s) => s.topic || s.content)
    || Boolean(String(payload.syllabus || '').trim());
}

export function documentsFilled(payload = {}) {
  return (Array.isArray(payload.documents) && payload.documents.length > 0)
    || Boolean(String(payload.drive_folder_url || '').trim())
    || Boolean(String(payload.sharepoint_notes || '').trim());
}
