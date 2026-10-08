/**
 * Impact feedback — pure domain logic (no DOM, no network).
 * Shared by the admin screen, the public form and node tests.
 */

export const AGE_BANDS = Object.freeze([
  { key: 'a_c', label: 'א׳–ג׳' },
  { key: 'd_f', label: 'ד׳–ו׳' },
  { key: 'g_i', label: 'ז׳–ט׳' },
  { key: 'j_l', label: 'י׳–י״ב' }
]);

export const AUDIENCE_LABELS = Object.freeze({
  student: 'תלמידים',
  educational_staff: 'צוות חינוכי',
  instructor: 'מדריך'
});

export const STAGE_LABELS = Object.freeze({ pre: 'פתיחה', post: 'סיום', final: 'סיום' });

export const SLOTS = Object.freeze([
  { key: 'student:pre', audience: 'student', stage: 'pre', label: 'תלמידים – פתיחה', short: 'פתיחה' },
  { key: 'student:post', audience: 'student', stage: 'post', label: 'תלמידים – סיום', short: 'סיום' },
  { key: 'educational_staff:final', audience: 'educational_staff', stage: 'final', label: 'צוות חינוכי', short: 'צוות' },
  { key: 'instructor:final', audience: 'instructor', stage: 'final', label: 'מדריך', short: 'מדריך' }
]);

// Activity/group feedback only. Instructor feedback is intentionally NOT group-scoped:
// one instructor fills once per program and academic year, based on confirmed assignments.
export const GROUP_SLOTS = Object.freeze(SLOTS.filter((slot) => slot.audience !== 'instructor'));

export const QUESTION_TYPES = Object.freeze([
  { key: 'rating_1_5', label: 'דירוג 1–5' },
  { key: 'yes_no', label: 'כן / לא' },
  { key: 'single_select', label: 'בחירה יחידה' },
  { key: 'multi_select', label: 'בחירה מרובה' },
  { key: 'free_text', label: 'טקסט חופשי' }
]);

export const RATING_LABELS = Object.freeze(['בכלל לא', 'במידה מועטה', 'במידה בינונית', 'במידה רבה', 'במידה רבה מאוד']);
export const RATING_EMOJI = Object.freeze(['😞', '🙁', '😐', '🙂', '😄']);

export const ACADEMIC_YEAR_LABELS = Object.freeze({
  school_2027: 'תשפ״ז (2027)',
  regular: 'תשפ״ו (2026)',
  summer_2026: 'קיץ 2026'
});

const HEBREW_GRADES = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, יא: 11, יב: 12 };

/** Mirrors private.feedback_age_band(): lowest grade found in the text wins. */
export function ageBandFromGrade(grade) {
  const clean = String(grade ?? '').replace(/['"׳״`]/g, '');
  let min = null;
  for (const token of clean.split(/[^א-תA-Za-z0-9]+/)) {
    let value = null;
    if (/^\d{1,2}$/.test(token)) value = Number(token);
    else if (Object.prototype.hasOwnProperty.call(HEBREW_GRADES, token)) value = HEBREW_GRADES[token];
    if (value >= 1 && value <= 12 && (min === null || value < min)) min = value;
  }
  if (min === null) return null;
  if (min <= 3) return 'a_c';
  if (min <= 6) return 'd_f';
  if (min <= 9) return 'g_i';
  return 'j_l';
}

export function ageBandLabel(key) {
  return AGE_BANDS.find((band) => band.key === key)?.label || '';
}

export function academicYearLabel(key) {
  return ACADEMIC_YEAR_LABELS[key] || key || '';
}

export function slotCampaign(group, slot) {
  const campaigns = Array.isArray(group?.campaigns) ? group.campaigns : [];
  return campaigns.find((c) => c.audience === slot.audience && c.stage === slot.stage) || null;
}

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * UI status for one campaign slot.
 * keys: not_opened | scheduled | active | collecting | completed | expired | closed
 *
 * Keep the label itself short and stable. Student response counts are rendered
 * separately in the overview table/card so the status remains scannable.
 */
export function campaignUiStatus(campaign, now = Date.now()) {
  if (!campaign) return { key: 'not_opened', label: 'טרם נפתח', tone: 'muted', responses: 0 };
  const responses = Number(campaign.responses) || 0;
  const personal = campaign.audience !== 'student';
  const completed = personal && campaign.recipient?.status === 'completed';
  if (completed) return { key: 'completed', label: 'הושלם', tone: 'success', responses };
  if (campaign.status === 'closed') return { key: 'closed', label: 'נסגר', tone: 'closed', responses };
  const opens = toTime(campaign.opens_at);
  const expires = toTime(campaign.expires_at);
  if (opens !== null && opens > now) return { key: 'scheduled', label: 'מתוזמן', tone: 'scheduled', responses };
  if (expires !== null && expires <= now) return { key: 'expired', label: 'פג תוקף', tone: 'warning', responses };
  if (!personal && responses > 0) {
    return { key: 'collecting', label: 'פעיל', tone: 'active', responses };
  }
  if (personal) return { key: 'active', label: 'ממתין למילוי', tone: 'pending', responses };
  return { key: 'active', label: 'פעיל', tone: 'active', responses };
}

export function isCampaignLive(campaign, now = Date.now()) {
  const status = campaignUiStatus(campaign, now).key;
  return status === 'active' || status === 'collecting';
}

export function groupHasFeedback(group) {
  return Array.isArray(group?.campaigns) && group.campaigns.length > 0;
}

export function dashboardKpis(groups = [], now = Date.now()) {
  let withFeedback = 0;
  let activePre = 0;
  let activePost = 0;
  let pendingInstructor = 0;
  let pendingContact = 0;
  let personalTotal = 0;
  let personalCompleted = 0;
  let studentResponses = 0;
  let unresolved = 0;
  for (const group of groups) {
    if (isProgramUnresolved(group)) unresolved += 1;
    if (groupHasFeedback(group)) withFeedback += 1;
    for (const campaign of group.campaigns || []) {
      const live = isCampaignLive(campaign, now);
      if (campaign.audience === 'student') {
        studentResponses += Number(campaign.responses) || 0;
        if (live && campaign.stage === 'pre') activePre += 1;
        if (live && campaign.stage === 'post') activePost += 1;
        continue;
      }
      personalTotal += 1;
      const done = campaign.recipient?.status === 'completed';
      if (done) personalCompleted += 1;
      else if (live && campaign.audience === 'instructor') pendingInstructor += 1;
      else if (live && campaign.audience === 'educational_staff') pendingContact += 1;
    }
  }
  return {
    withFeedback,
    activePre,
    activePost,
    pendingInstructor,
    pendingContact,
    studentResponses,
    unresolved,
    personalTotal,
    personalCompleted,
    responseRate: personalTotal ? Math.round((personalCompleted / personalTotal) * 100) : null
  };
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** status filter keys: any_live | pending_instructor | pending_contact | no_feedback | has_feedback | completed_all */
export const PROGRAM_SOURCE_LABELS = Object.freeze({
  campaign: 'נקבעה בפתיחת המשוב',
  manual: 'נבחרה ידנית',
  manual_name: 'נבחרה ידנית לפי שם הפעילות',
  gefen: 'זוהתה לפי מספר גפ״ן',
  name: 'זוהתה לפי שם הפעילות'
});

export function isProgramUnresolved(group) {
  return !group?.program_key && !group?.feedback_excluded;
}

export function groupMatchesStatus(group, statusKey, now = Date.now()) {
  if (statusKey === 'excluded') return Boolean(group.feedback_excluded);
  if (group.feedback_excluded) return false;
  if (statusKey === 'unresolved') return isProgramUnresolved(group);
  if (!statusKey) return true;
  const campaigns = group.campaigns || [];
  const statuses = campaigns.map((c) => ({ c, s: campaignUiStatus(c, now).key }));
  switch (statusKey) {
    case 'no_feedback': return campaigns.length === 0;
    case 'has_feedback': return campaigns.length > 0;
    case 'any_live': return statuses.some(({ s }) => s === 'active' || s === 'collecting');
    case 'pending_contact': return statuses.some(({ c, s }) => c.audience === 'educational_staff' && s === 'active');
    case 'expired': return statuses.some(({ s }) => s === 'expired');
    case 'completed_all': return GROUP_SLOTS.every((slot) => {
      const campaign = slotCampaign(group, slot);
      if (!campaign) return false;
      const s = campaignUiStatus(campaign, now).key;
      return s === 'completed' || s === 'closed' || (campaign.audience === 'student' && Number(campaign.responses) > 0);
    });
    default: return true;
  }
}

export function filterGroups(groups = [], filters = {}, now = Date.now()) {
  const search = normalizeText(filters.search);
  return groups.filter((group) => {
    if (filters.program && group.program_key !== filters.program) return false;
    if (filters.authority && group.authority !== filters.authority) return false;
    if (filters.school && group.school !== filters.school) return false;
    if (filters.instructor && group.instructor_name !== filters.instructor) return false;
    if (filters.ageBand && group.age_band !== filters.ageBand) return false;
    if (filters.from && group.start_date && group.start_date < filters.from) return false;
    if (filters.to && group.start_date && group.start_date > filters.to) return false;
    if (!groupMatchesStatus(group, filters.status, now)) return false;
    if (search) {
      const hay = [group.school, group.authority, group.activity_name, group.instructor_name, group.grade, group.contact_name, group.row_id]
        .map(normalizeText).join(' ');
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function uniqueSorted(values) {
  return [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}

// ---------------------------------------------------------------------------
// Links & sharing
// ---------------------------------------------------------------------------

export function publicFeedbackUrl(token, baseHref) {
  const base = String(baseHref || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const url = new URL('feedback.html', base || 'https://localhost/');
  url.searchParams.set('t', token);
  return url.href;
}

export function normalizeWhatsappPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

export function whatsappUrl(phone, text) {
  const number = normalizeWhatsappPhone(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(email, subject, body) {
  return `mailto:${encodeURIComponent(String(email || '').trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function shareMessage({ audience, stage = '', recipientName = '', programTitle = '', schoolName = '', url }) {
  const greeting = recipientName ? `שלום ${recipientName},` : 'שלום,';
  if (audience === 'instructor') {
    if (stage === 'pre') {
      return `${greeting}\nאחרי ההכשרה לתוכנית "${programTitle}", נשמח לשמוע עד כמה את/ה מרגיש/ה מוכן/ה להתחיל להדריך ומה עדיין חסר לך. זהו משוב פתיחה קצר ופנימי:\n${url}\nתודה רבה, צוות תעשיידע`;
    }
    return `${greeting}\nלאחר סיום ההדרכה בתוכנית "${programTitle}", נשמח לשמוע מה עבד בפועל, מה דורש שיפור ומה דעתך על התוכן והתפעול. זהו משוב סיום קצר ופנימי:\n${url}\nתודה רבה, צוות תעשיידע`;
  }
  if (audience === 'educational_staff') {
    return `${greeting}\nהתוכנית "${programTitle}"${schoolName ? ` ב${schoolName}` : ''} מתקרבת לסיומה.\nנשמח מאוד לשמוע את הערכתכם – המשוב קצר ועוזר לנו להשתפר:\n${url}\nתודה רבה, צוות תעשיידע`;
  }
  return `משוב התוכנית "${programTitle}" – ממלאים כאן:\n${url}`;
}

export function shareSubject(audience, programTitle, stage = '') {
  if (audience === 'instructor') return `משוב מדריך – ${stage === 'pre' ? 'פתיחה' : 'סיום'} – ${programTitle}`;
  if (audience === 'educational_staff') return `משוב צוות חינוכי – ${programTitle}`;
  return `משוב – ${programTitle}`;
}

// ---------------------------------------------------------------------------
// Scoring & aggregation
// ---------------------------------------------------------------------------

export function ratingToScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(((n - 1) / 4) * 100);
}

/** Numeric 1–5 value of an answer fact for averages, or null when not scorable. */
export function factNumericValue(fact) {
  const scoring = fact?.scoring && typeof fact.scoring === 'object' ? fact.scoring : {};
  if (scoring.include_in_score === false) return null;
  if (fact.question_type === 'rating_1_5') {
    const n = Number(fact.value_number);
    return n >= 1 && n <= 5 ? n : null;
  }
  if (fact.question_type === 'yes_no' && typeof fact.value_bool === 'boolean' && scoring.include_in_score) {
    const n = Number(fact.value_bool ? (scoring.yes ?? 5) : (scoring.no ?? 1));
    return n >= 1 && n <= 5 ? n : null;
  }
  return null;
}

function round1(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function blankStats() {
  return { values: [], responses: new Set() };
}

function finishStats(stats) {
  const avg = mean(stats.values);
  return { avg: round1(avg), n: stats.responses.size, answers: stats.values.length, score: avg === null ? null : ratingToScore(avg) };
}

/** Per metric and per question averages for one population of facts. */
export function summarizePopulation(facts = []) {
  const responses = new Set();
  const metricStats = new Map();
  const questionStats = new Map();
  for (const fact of facts) {
    responses.add(fact.response_id);
    const value = factNumericValue(fact);
    if (value === null) continue;
    if (!metricStats.has(fact.metric_key)) metricStats.set(fact.metric_key, blankStats());
    const m = metricStats.get(fact.metric_key);
    m.values.push(value);
    m.responses.add(fact.response_id);
    if (!questionStats.has(fact.question_id)) {
      questionStats.set(fact.question_id, { ...blankStats(), question_id: fact.question_id, text: fact.question_text, metric_key: fact.metric_key, sort_order: fact.sort_order });
    }
    const q = questionStats.get(fact.question_id);
    q.values.push(value);
    q.responses.add(fact.response_id);
  }
  const byMetric = {};
  for (const [key, stats] of metricStats) byMetric[key] = finishStats(stats);
  const byQuestion = [...questionStats.values()]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((q) => ({ question_id: q.question_id, text: q.text, metric_key: q.metric_key, ...finishStats(q) }));
  return { n: responses.size, byMetric, byQuestion };
}

/**
 * Group-vs-group PRE/POST comparison. Uses only comparison questions (same concept asked
 * in both stages). There is no student matching: these are two independent samples.
 */
export function comparePrePost(preFacts = [], postFacts = [], metrics = []) {
  const preComparable = preFacts.filter((f) => f.is_comparison);
  const postComparable = postFacts.filter((f) => f.is_comparison);
  const pre = summarizePopulation(preComparable);
  const post = summarizePopulation(postComparable);
  const nPre = new Set(preFacts.map((f) => f.response_id)).size;
  const nPost = new Set(postFacts.map((f) => f.response_id)).size;
  const metricKeys = metrics.length
    ? metrics.map((m) => m.key)
    : [...new Set([...Object.keys(pre.byMetric), ...Object.keys(post.byMetric)])];
  const rows = metricKeys
    .filter((key) => pre.byMetric[key] || post.byMetric[key])
    .map((key) => {
      const preAvg = pre.byMetric[key]?.avg ?? null;
      const postAvg = post.byMetric[key]?.avg ?? null;
      const delta = preAvg !== null && postAvg !== null ? round1(postAvg - preAvg) : null;
      const deltaPct = delta !== null && preAvg ? Math.round(((postAvg - preAvg) / preAvg) * 100) : null;
      return {
        metric_key: key,
        label: metrics.find((m) => m.key === key)?.label || key,
        preAvg,
        postAvg,
        delta,
        deltaPct,
        nPre: pre.byMetric[key]?.n ?? 0,
        nPost: post.byMetric[key]?.n ?? 0
      };
    });
  const questionIds = [...new Set([...pre.byQuestion, ...post.byQuestion].map((q) => q.question_id))];
  const questions = questionIds.map((id) => {
    const a = pre.byQuestion.find((q) => q.question_id === id);
    const b = post.byQuestion.find((q) => q.question_id === id);
    const delta = a && b && a.avg !== null && b.avg !== null ? round1(b.avg - a.avg) : null;
    return { question_id: id, text: (b || a).text, metric_key: (b || a).metric_key, preAvg: a?.avg ?? null, postAvg: b?.avg ?? null, delta, nPre: a?.n ?? 0, nPost: b?.n ?? 0 };
  });
  return { nPre, nPost, rows, questions };
}

function fmt(value) {
  return value === null || value === undefined ? '' : Number(value).toFixed(1);
}

/** Group-level sentence; never phrased as an individual student's progress. */
export function describeGroupChange(preAvg, postAvg) {
  if (preAvg === null && postAvg === null) return 'אין עדיין נתונים';
  if (preAvg === null) return `ממוצע הקבוצה בסיום: ${fmt(postAvg)} (אין נתוני פתיחה להשוואה)`;
  if (postAvg === null) return `ממוצע הקבוצה בפתיחה: ${fmt(preAvg)} (טרם התקבלו נתוני סיום)`;
  const diff = Math.round((postAvg - preAvg) * 10) / 10;
  if (diff > 0) return `ממוצע הקבוצה עלה מ-${fmt(preAvg)} ל-${fmt(postAvg)}`;
  if (diff < 0) return `ממוצע הקבוצה ירד מ-${fmt(preAvg)} ל-${fmt(postAvg)}`;
  return `ממוצע הקבוצה נשאר ${fmt(postAvg)}`;
}

/** Facts filtered for one audience/stage. */
export function factsFor(facts, audience, stage) {
  return facts.filter((f) => f.audience === audience && (!stage || f.stage === stage));
}

/** The three perspectives, kept separate (never blended into one average). */
export function threePerspectives(facts = [], metrics = []) {
  const studentsPre = factsFor(facts, 'student', 'pre');
  const studentsPost = factsFor(facts, 'student', 'post');
  return {
    students: {
      comparison: comparePrePost(studentsPre, studentsPost, metrics.filter((m) => m.kind === 'impact')),
      post: summarizePopulation(studentsPost),
      pre: summarizePopulation(studentsPre)
    },
    staff: summarizePopulation(factsFor(facts, 'educational_staff')),
    instructor: summarizePopulation(factsFor(facts, 'instructor', 'final'))
  };
}

/** Rough agreement indicator between perspectives on a metric (score 0–100). */
export function perspectiveGap(scores = []) {
  const valid = scores.filter((s) => Number.isFinite(s));
  if (valid.length < 2) return null;
  const gap = Math.max(...valid) - Math.min(...valid);
  if (gap <= 10) return { gap, key: 'aligned', label: 'מגמה דומה' };
  if (gap <= 20) return { gap, key: 'partial', label: 'פער מתון' };
  return { gap, key: 'gap', label: 'פער משמעותי' };
}

export function multiSelectDistribution(facts = []) {
  const counts = new Map();
  let responses = 0;
  for (const fact of facts) {
    if (fact.question_type !== 'multi_select') continue;
    responses += 1;
    for (const option of fact.value_options || []) counts.set(option, (counts.get(option) || 0) + 1);
  }
  return { responses, counts };
}

export function openAnswers(facts = []) {
  return facts
    .filter((f) => f.question_type === 'free_text' && String(f.value_text || '').trim())
    .map((f) => ({
      answer_id: f.answer_id,
      text: String(f.value_text).trim(),
      question_id: f.question_id,
      question_text: f.question_text,
      audience: f.audience,
      stage: f.stage,
      program_key: f.program_key,
      school_name: f.school_name,
      authority_name: f.authority_name,
      activity_row_id: f.activity_row_id,
      activity_name: f.activity_name,
      grade: f.grade,
      respondent_name: f.audience === 'student' ? '' : (f.respondent_name || ''),
      submitted_at: f.submitted_at
    }));
}

export function filterFacts(facts = [], filters = {}) {
  return facts.filter((f) => {
    if (filters.program && f.program_key !== filters.program) return false;
    if (filters.authority && f.authority_name !== filters.authority) return false;
    if (filters.school && f.school_name !== filters.school) return false;
    if (filters.ageBand && f.age_band !== filters.ageBand) return false;
    if (filters.group && f.activity_row_id !== filters.group) return false;
    if (filters.instructor && f.instructor_name !== filters.instructor) return false;
    const day = String(f.submitted_at || '').slice(0, 10);
    if (filters.from && day && day < filters.from) return false;
    if (filters.to && day && day > filters.to) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function answerDisplayValue(fact, optionLabels = {}) {
  const labels = { ...optionLabels };
  for (const option of Array.isArray(fact.question_options) ? fact.question_options : []) {
    if (option?.value) labels[option.value] = option.label || option.value;
  }
  if (fact.question_type === 'rating_1_5') return fact.value_number ?? '';
  if (fact.question_type === 'yes_no') return fact.value_bool === true ? 'כן' : fact.value_bool === false ? 'לא' : '';
  if (fact.question_type === 'single_select' || fact.question_type === 'multi_select') {
    return (fact.value_options || []).map((v) => labels[v] || v).join(', ');
  }
  return fact.value_text ?? '';
}

export const RAW_EXPORT_HEADERS = [
  'מזהה תשובה', 'תאריך מילוי', 'קהל', 'שלב', 'תוכנית', 'שנת פעילות', 'רשות', 'בית ספר', 'שכבה', 'שכבת גיל',
  'מזהה קבוצה', 'שם הפעילות', 'מדריך', 'שם הממלא/ת', 'גרסת שאלון', 'מדד', 'סוג שאלה', 'שאלת השוואה', 'שאלה', 'ערך'
];

/** One row per answer. Student rows never carry a respondent name. */
export function rawExportRows(facts = [], { programs = [], metrics = [], optionLabels = {} } = {}) {
  const programTitle = (key) => programs.find((p) => p.key === key)?.title || key;
  const metricLabel = (key) => metrics.find((m) => m.key === key)?.label || key;
  return facts.map((f) => [
    f.response_id,
    String(f.submitted_at || '').slice(0, 16).replace('T', ' '),
    AUDIENCE_LABELS[f.audience] || f.audience,
    STAGE_LABELS[f.stage] || f.stage,
    programTitle(f.program_key),
    academicYearLabel(f.academic_year),
    f.authority_name || '',
    f.school_name || '',
    f.grade || '',
    ageBandLabel(f.age_band),
    f.activity_row_id || '',
    f.activity_name || '',
    f.instructor_name || '',
    f.audience === 'student' ? '' : (f.respondent_name || ''),
    f.version_no ?? '',
    metricLabel(f.metric_key),
    QUESTION_TYPES.find((t) => t.key === f.question_type)?.label || f.question_type,
    f.is_comparison ? 'כן' : '',
    f.question_text || '',
    answerDisplayValue(f, optionLabels)
  ]);
}

export const SUMMARY_EXPORT_HEADERS = [
  'קהל', 'מדד', 'ממוצע פתיחה (PRE)', 'ממוצע סיום (POST)', 'שינוי מוחלט', 'שינוי באחוזים', 'N פתיחה', 'N סיום', 'ציון 0–100', 'תיאור'
];

export function summaryExportRows(perspectives, metrics = []) {
  const rows = [];
  for (const row of perspectives.students.comparison.rows) {
    rows.push([
      'תלמידים (השוואת פתיחה–סיום)', row.label, row.preAvg ?? '', row.postAvg ?? '', row.delta ?? '',
      row.deltaPct === null ? '' : `${row.deltaPct}%`, row.nPre, row.nPost,
      ratingToScore(row.postAvg) ?? '', describeGroupChange(row.preAvg, row.postAvg)
    ]);
  }
  const pushPopulation = (label, population) => {
    for (const metric of metrics) {
      const stats = population.byMetric[metric.key];
      if (!stats) continue;
      rows.push([label, metric.label, '', stats.avg ?? '', '', '', '', stats.n, stats.score ?? '', '']);
    }
  };
  pushPopulation('תלמידים – סיום (כל השאלות)', perspectives.students.post);
  pushPopulation('צוות חינוכי', perspectives.staff);
  pushPopulation('מדריך', perspectives.instructor);
  return rows;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with BOM so Excel opens Hebrew correctly. */
export function buildCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}`;
}

// ---------------------------------------------------------------------------
// Public form helpers
// ---------------------------------------------------------------------------

export function isAnswered(question, value) {
  if (value === undefined || value === null) return false;
  if (question.type === 'free_text') return String(value).trim() !== '';
  if (question.type === 'multi_select') return Array.isArray(value) && value.length > 0;
  return true;
}

export function missingRequired(questions = [], answers = {}) {
  return questions.filter((q) => q.required && !isAnswered(q, answers[q.id])).map((q) => q.id);
}

export function formProgress(questions = [], answers = {}) {
  if (!questions.length) return 0;
  const answered = questions.filter((q) => isAnswered(q, answers[q.id])).length;
  return Math.round((answered / questions.length) * 100);
}

export const PUBLIC_STATE_MESSAGES = Object.freeze({
  invalid: { title: 'הקישור אינו תקין', body: 'ייתכן שהקישור הועתק באופן חלקי. כדאי לבקש קישור חדש ממי ששלח אותו.' },
  not_open: { title: 'המשוב עוד לא נפתח', body: 'המשוב ייפתח בקרוב. אפשר לחזור לקישור הזה מאוחר יותר.' },
  expired: { title: 'תוקף המשוב הסתיים', body: 'תודה על הרצון לשתף! המשוב הזה כבר אינו פעיל.' },
  closed: { title: 'המשוב נסגר', body: 'המשוב הזה כבר אינו מקבל תשובות. תודה רבה!' },
  completed: { title: 'המשוב כבר מולא', body: 'קיבלנו את המשוב שלך – תודה רבה! אין צורך למלא שוב.' },
  full: { title: 'המשוב התמלא', body: 'המשוב הזה הגיע למספר התשובות המרבי. תודה רבה!' },
  error: { title: 'משהו השתבש', body: 'לא הצלחנו לטעון את המשוב. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.' }
});

export const THANK_YOU = Object.freeze({
  title: 'תודה רבה ששיתפת אותנו 💙',
  body: 'המשוב שלך עוזר לנו ללמוד, להשתפר וליצור תוכניות טובות ומשמעותיות יותר.'
});
