import { COURSE_SCHEDULING_PERIODS } from '../screens/course-scheduling-periods.js';
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
  { key: 'instructor:pre', audience: 'instructor', stage: 'pre', label: 'מדריך – פתיחה', short: 'מדריך פתיחה' },
  { key: 'instructor:final', audience: 'instructor', stage: 'final', label: 'מדריך – סיום', short: 'מדריך סיום' }
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

/**
 * A student group is eligible for feedback tracking only after a real course start
 * was scheduled in the canonical activities table.
 * Missing/cleared dates keep prior responses but remove the row from the student list.
 */
export function hasCourseStartDate(group) {
  const value = String(group?.start_date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

/**
 * Staff surveys are eligible only after their actual activity has an end date.
 * Reuse the date validator already used for students; do not infer one from the
 * program duration, scheduled start, or existing survey campaign.
 */
export function hasCourseEndDate(group) {
  return hasCourseStartDate({ start_date: group?.end_date });
}

/**
 * Keep student-feedback semesters identical to the scheduling board.
 * Assign each course to exactly one semester by its first activity date,
 * not by its end date (a first-half course may continue into February).
 * Feedback reporting uses a January 1 cutoff, independent of the scheduling
 * board's January 31 semester start.
 */
export function studentFeedbackPeriodForGroup(group) {
  if (!hasCourseStartDate(group)) return null;
  const day = group.start_date;
  const { first, second } = COURSE_SCHEDULING_PERIODS;
  if (day < first.start || day > second.end) return null;
  return day >= '2027-01-01' ? 'second' : 'first';
}

/**
 * Match each submitted answer to exactly one scheduling semester.
 * Groups are mapped by the course's start (staff also need a known end date).
 * An instructor's single yearly campaign is mapped by the earliest start of
 * its instructor/program/year assignment. Never duplicate yearly responses
 * across halves, and never derive cohort from submission date.
 */
export function filterFeedbackFactsForHalf(facts = [], groups = [], instructorAssignments = [], half = 'first') {
  if (!['first', 'second'].includes(half)) return [];
  const groupHalf = new Map((groups || []).filter((g) => g.row_id)
    .map((g) => [String(g.row_id), studentFeedbackPeriodForGroup(g)]));
  const staffEligible = new Set((groups || []).filter((g) => g.row_id && hasCourseEndDate(g))
    .map((g) => String(g.row_id)));
  const instructorCampaignHalf = new Map();
  for (const assignment of instructorAssignments || []) {
    const cohort = studentFeedbackPeriodForGroup({ start_date: assignment.first_start_date });
    for (const campaign of [assignment.pre_campaign, assignment.final_campaign]) {
      if (campaign?.id && cohort) instructorCampaignHalf.set(String(campaign.id), cohort);
    }
    if (assignment.final_b_campaign?.id) instructorCampaignHalf.set(String(assignment.final_b_campaign.id), 'second');
  }
  return (facts || []).filter((fact) => {
    if (fact.audience === 'instructor') {
      return instructorCampaignHalf.get(String(fact.campaign_id || '')) === half;
    }
    const key = String(fact.activity_row_id || '');
    return groupHalf.get(key) === half &&
      (fact.audience !== 'educational_staff' || staffEligible.has(key));
  });
}

/** Staff groups are ordered by their actual course end: nearest first, regardless of survey status. */
export function sortEducationalStaffFeedbackGroups(groups = []) {
  return [...groups].sort((a, b) =>
    String(a.end_date || '9999-12-31').slice(0, 10).localeCompare(String(b.end_date || '9999-12-31').slice(0, 10)) ||
    String(a.school || '').localeCompare(String(b.school || ''), 'he') ||
    String(a.row_id || '').localeCompare(String(b.row_id || '')));
}

/** Submitted student answers are evidence that feedback has already been performed. */
export function studentFeedbackHasResponses(group) {
  return (group?.campaigns || []).some((campaign) =>
    campaign.audience === 'student' && Number(campaign.responses || 0) > 0);
}

/** Upcoming work is listed by earliest course start; answered feedback goes last. */
export function sortStudentFeedbackGroups(groups = []) {
  return [...groups].sort((a, b) =>
    Number(studentFeedbackHasResponses(a)) - Number(studentFeedbackHasResponses(b)) ||
    String(a.start_date).localeCompare(String(b.start_date)) ||
    String(a.school || '').localeCompare(String(b.school || ''), 'he') ||
    String(a.row_id || '').localeCompare(String(b.row_id || '')));
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
  activity_no: 'זוהתה לפי מספר תוכנית',
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
    if (filters.manager && group.activity_manager !== filters.manager) return false;
    if (filters.ageBand && group.age_band !== filters.ageBand) return false;
    if (filters.from && group.start_date && group.start_date < filters.from) return false;
    if (filters.to && group.start_date && group.start_date > filters.to) return false;
    if (!groupMatchesStatus(group, filters.status, now)) return false;
    if (search) {
      const hay = [group.school, group.authority, group.activity_name, group.instructor_name, group.activity_manager, group.grade, group.contact_name, group.row_id]
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
    // The link is already individual; do not repeat the recipient's school or technical details.
    return `${greeting}\nנשמח לקבל ממך משוב קצר על התוכנית "${programTitle}".\nהמשוב חשוב לנו כדי ללמוד מהניסיון שלך, לדייק ולשפר את התוכניות שלנו.\nלמילוי המשוב:\n${url}\nתודה רבה,\nצוות תעשיידע`;
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

/** "לא רלוונטי / לא הייתה אפשרות להעריך" answer (rating question with the N/A option). */
export function isNaFact(fact) {
  return fact?.question_type === 'rating_1_5' && fact.value_number === null && Array.isArray(fact.value_options) && fact.value_options.includes('na');
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
  let preComparable = preFacts.filter((f) => f.is_comparison);
  let postComparable = postFacts.filter((f) => f.is_comparison);
  // When both stages exist, a metric is compared only over question concepts asked in both,
  // so the PRE and POST averages are built from the same questions.
  if (preComparable.length && postComparable.length) {
    const shared = new Set(preComparable.map((f) => f.question_id).filter((id) => postComparable.some((f) => f.question_id === id)));
    preComparable = preComparable.filter((f) => shared.has(f.question_id));
    postComparable = postComparable.filter((f) => shared.has(f.question_id));
  }
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
  const instructorPre = summarizePopulation(factsFor(facts, 'instructor', 'pre'));
  const instructorFinal = summarizePopulation(factsFor(facts, 'instructor', 'final'));
  return {
    students: {
      comparison: comparePrePost(studentsPre, studentsPost, metrics.filter((m) => m.kind === 'impact')),
      post: summarizePopulation(studentsPost),
      pre: summarizePopulation(studentsPre)
    },
    staff: summarizePopulation(factsFor(facts, 'educational_staff')),
    instructor: instructorFinal,
    instructorPre,
    instructorFinal
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
// Course-level analysis (unit = course + respondent population, never a single group)
// ---------------------------------------------------------------------------

export const AUDIENCE_STAGES = Object.freeze({
  student: ['pre', 'post'],
  instructor: ['pre', 'final', 'final_b'],
  educational_staff: ['final']
});

export const AUDIENCE_ORDER = Object.freeze(['student', 'instructor', 'educational_staff']);

/** Measurement phase used by the overview: opening (student pre, instructor pre) vs end (the rest). */
export function stagePhase(audience, stage) {
  return stage === 'pre' ? 'pre' : 'end';
}

export const PHASE_LABELS = Object.freeze({ pre: 'פתיחה', end: 'סיום' });

export function stageLabelFor(audience, stage) {
  if (audience === 'instructor') return stage === 'pre' ? 'פתיחה (אחרי הכשרה)' : stage === 'final_b' ? 'סיום מחצית ב׳' : 'סיום מחצית א׳';
  if (audience === 'educational_staff') return 'סיום';
  return stage === 'pre' ? 'פתיחה' : 'סיום';
}

/**
 * Display label that never lets two catalog courses share a name (e.g. the elementary 6089 and
 * the secondary 53828 Biomimicry): when titles collide, the school level and Gefen number are added.
 */
export function courseLabel(program, programs = []) {
  if (!program) return '';
  const twins = programs.filter((p) => p.title === program.title);
  if (twins.length < 2) return program.title;
  const level = program.education_level === 'elementary' ? 'יסודי' : program.education_level === 'secondary' ? 'חטיבה' : '';
  const gefen = Array.isArray(program.gefen_numbers) && program.gefen_numbers.length ? program.gefen_numbers.join('/') : '';
  return `${program.title} (${[level, gefen].filter(Boolean).join(' · ')})`;
}

function summaryRow(rows, programKey, audience, stage) {
  return rows.find((r) => r.program_key === programKey && r.audience === audience && r.stage === stage) || null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * Collection figures for one course and audience, read from feedback_admin_course_summary rows.
 * Questionnaires come from feedback_responses; unique respondents only where identity is reliable
 * (instructor / staff); students are anonymous so no unique count is ever reported for them.
 */
export function courseCollection(rows = [], programKey, audience) {
  const stages = AUDIENCE_STAGES[audience] || [];
  const byStage = {};
  for (const stage of stages) {
    const r = summaryRow(rows, programKey, audience, stage);
    const responses = num(r?.responses);
    const base = { stage, campaigns: num(r?.campaigns), groups: num(r?.groups), responses };
    if (audience === 'student') {
      const participants = num(r?.participants_total);
      const covered = num(r?.participants_campaigns);
      base.participants = participants;
      base.participantsCampaigns = covered;
      base.responseRate = participants > 0 ? pct(num(r?.responses_with_participants), participants) : null;
      base.rateCoverage = base.campaigns ? `${covered}/${base.campaigns}` : '';
    } else {
      base.invited = num(r?.invited);
      base.completed = num(r?.completed);
      base.responseRate = pct(base.completed, base.invited);
    }
    byStage[stage] = base;
  }
  const all = summaryRow(rows, programKey, audience, 'all');
  return {
    audience,
    byStage,
    campaigns: num(all?.campaigns),
    responses: num(all?.responses),
    uniqueRespondents: audience === 'student' || all?.unique_respondents === null || all?.unique_respondents === undefined
      ? null : num(all.unique_respondents),
    unidentified: audience === 'student' ? null : num(all?.unidentified_responses),
    anonymous: audience === 'student'
  };
}

/** Totals across courses for the overview, without double counting a course or a response. */
export function overviewTotals(rows = [], { programKey = '', audience = '', phase = '' } = {}) {
  const stageRows = rows.filter((r) => r.stage !== 'all'
    && (!programKey || r.program_key === programKey)
    && (!audience || r.audience === audience)
    && (!phase || stagePhase(r.audience, r.stage) === phase));
  const courses = new Set(stageRows.filter((r) => num(r.campaigns) > 0).map((r) => r.program_key));
  const byAudience = Object.fromEntries(AUDIENCE_ORDER.map((a) => [a, 0]));
  const byPhase = { pre: 0, end: 0 };
  let responses = 0;
  for (const r of stageRows) {
    const n = num(r.responses);
    responses += n;
    byAudience[r.audience] = (byAudience[r.audience] || 0) + n;
    byPhase[stagePhase(r.audience, r.stage)] += n;
  }
  // Unique people: per course+audience "all" rows (PRE and FINAL by the same instructor = one person).
  // A phase filter would split the same person across rows, so it is reported per stage instead.
  let identified = 0;
  if (!phase) {
    for (const r of rows) {
      if (r.stage !== 'all' || r.audience === 'student') continue;
      if (programKey && r.program_key !== programKey) continue;
      if (audience && r.audience !== audience) continue;
      identified += num(r.unique_respondents);
    }
  } else {
    identified = null;
  }
  return { courses: courses.size, responses, byAudience, byPhase, identifiedRespondents: identified };
}

function normalizeWording(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Per-question statistics computed directly from every valid answer (never an average of
 * group averages). N/A answers are counted separately and excluded from the mean.
 */
export function questionStats(facts = []) {
  const map = new Map();
  for (const f of facts) {
    if (!map.has(f.question_id)) {
      map.set(f.question_id, {
        question_id: f.question_id,
        question_key: f.question_key,
        text: f.question_text,
        wordings: new Set(),
        metric_key: f.metric_key,
        section: f.section,
        question_type: f.question_type,
        sort_order: f.sort_order ?? 0,
        options: Array.isArray(f.question_options) ? f.question_options : [],
        values: [],
        responses: new Set(),
        na: 0,
        dist: [0, 0, 0, 0, 0],
        optionCounts: new Map(),
        yes: 0,
        no: 0,
        texts: 0
      });
    }
    const q = map.get(f.question_id);
    q.wordings.add(normalizeWording(f.question_text));
    if (isNaFact(f)) { q.na += 1; continue; }
    if (f.question_type === 'rating_1_5') {
      const n = Number(f.value_number);
      if (n >= 1 && n <= 5) {
        q.values.push(n);
        q.responses.add(f.response_id);
        q.dist[Math.round(n) - 1] += 1;
      }
    } else if (f.question_type === 'yes_no') {
      if (f.value_bool === true) q.yes += 1;
      if (f.value_bool === false) q.no += 1;
      if (typeof f.value_bool === 'boolean') q.responses.add(f.response_id);
    } else if (f.question_type === 'single_select' || f.question_type === 'multi_select') {
      if ((f.value_options || []).length) q.responses.add(f.response_id);
      for (const v of f.value_options || []) q.optionCounts.set(v, (q.optionCounts.get(v) || 0) + 1);
    } else if (f.question_type === 'free_text') {
      if (String(f.value_text || '').trim()) { q.texts += 1; q.responses.add(f.response_id); }
    }
  }
  return [...map.values()]
    .sort((a, b) => (a.sort_order - b.sort_order) || String(a.text).localeCompare(String(b.text), 'he'))
    .map((q) => {
      const avg = mean(q.values);
      return {
        question_id: q.question_id,
        question_key: q.question_key,
        text: q.text,
        wordingChanged: q.wordings.size > 1,
        metric_key: q.metric_key,
        section: q.section,
        question_type: q.question_type,
        options: q.options,
        n: q.responses.size,
        valid: q.values.length,
        na: q.na,
        avg: round1(avg),
        score: avg === null ? null : ratingToScore(avg),
        dist: q.dist,
        yes: q.yes,
        no: q.no,
        optionCounts: Object.fromEntries(q.optionCounts),
        texts: q.texts
      };
    });
}

/**
 * PRE vs POST (students) or PRE vs FINAL (instructors) on identical question concepts only.
 * These are population averages, not matched individual change: respondents are not linked.
 * A question whose wording differs between the two stages is listed but not compared.
 */
export function comparePrePostByQuestion(preFacts = [], postFacts = []) {
  const pre = new Map(questionStats(preFacts).map((q) => [q.question_id, q]));
  const post = new Map(questionStats(postFacts).map((q) => [q.question_id, q]));
  const rows = [];
  for (const [id, a] of pre) {
    const b = post.get(id);
    if (!b || a.question_type !== 'rating_1_5') continue;
    const sameWording = normalizeWording(a.text) === normalizeWording(b.text) && !a.wordingChanged && !b.wordingChanged;
    const delta = sameWording && a.avg !== null && b.avg !== null ? round1(b.avg - a.avg) : null;
    rows.push({
      question_id: id,
      text: b.text,
      metric_key: b.metric_key,
      section: b.section,
      preAvg: a.avg,
      postAvg: b.avg,
      nPre: a.valid,
      nPost: b.valid,
      delta,
      comparable: sameWording
    });
  }
  return {
    nPre: new Set(preFacts.map((f) => f.response_id)).size,
    nPost: new Set(postFacts.map((f) => f.response_id)).size,
    rows
  };
}

/** Each population is scored separately per metric; nothing is merged into one cross-audience score. */
export function audienceMetricScores(facts = [], metrics = [], { minN = 3 } = {}) {
  const populations = {
    student: summarizePopulation(factsFor(facts, 'student', 'post')),
    instructor: summarizePopulation(factsFor(facts, 'instructor', 'final')),
    educational_staff: summarizePopulation(factsFor(facts, 'educational_staff'))
  };
  return metrics.map((m) => {
    const cells = Object.fromEntries(AUDIENCE_ORDER.map((a) => {
      const s = populations[a].byMetric[m.key];
      return [a, s ? { avg: s.avg, score: s.score, n: s.n } : null];
    }));
    const eligible = AUDIENCE_ORDER.map((a) => cells[a]).filter((c) => c && c.n >= minN).map((c) => c.score);
    return { metric_key: m.key, label: m.label, kind: m.kind, cells, gap: perspectiveGap(eligible) };
  }).filter((row) => AUDIENCE_ORDER.some((a) => row.cells[a]));
}

/** Core (shared) questions across courses: same question concept, per course, per population. */
export function crossCourseCore(facts = [], { audience = 'student', stage = '' } = {}) {
  const core = facts.filter((f) => f.section === 'core' && f.audience === audience && (!stage || f.stage === stage) && f.question_type === 'rating_1_5');
  const questions = new Map();
  for (const f of core) {
    if (!questions.has(f.question_id)) questions.set(f.question_id, { question_id: f.question_id, text: f.question_text, metric_key: f.metric_key, sort_order: f.sort_order ?? 0, facts: [] });
    questions.get(f.question_id).facts.push(f);
  }
  // A question contributes to a cross-course comparison only when the same question ID
  // was answered in at least two different courses. Course-specific ratings remain local.
  const comparableQuestions = [...questions.values()].filter((q) =>
    new Set(q.facts.map((f) => f.program_key)).size >= 2);
  const programKeys = uniqueSorted(comparableQuestions.flatMap((q) => q.facts.map((f) => f.program_key)));
  const rows = comparableQuestions.sort((a, b) => a.sort_order - b.sort_order).map((q) => {
    const byProgram = {};
    for (const key of programKeys) {
      const stats = questionStats(q.facts.filter((f) => f.program_key === key))[0];
      byProgram[key] = stats ? { avg: stats.avg, n: stats.valid } : null;
    }
    // Wording may embed the course topic ({topic}); show the generic concept once.
    return { question_id: q.question_id, text: q.text, metric_key: q.metric_key, byProgram };
  });
  return { programKeys, rows };
}

/** Strengths / improvement areas: rating questions with enough valid answers, by pooled mean. */
export function strengthsAndGaps(stats = [], { minN = 5, count = 3 } = {}) {
  const eligible = stats.filter((q) => q.question_type === 'rating_1_5' && q.valid >= minN && q.avg !== null);
  const values = eligible.map((q) => q.avg);
  // Identical means do not distinguish anything; report no strengths or gaps rather than an arbitrary pick.
  if (!eligible.length || Math.max(...values) === Math.min(...values)) {
    return { strengths: [], gaps: [], eligible: eligible.length, minN, flat: eligible.length > 1 };
  }
  const strengths = [...eligible].sort((a, b) => b.avg - a.avg || b.valid - a.valid).slice(0, count);
  const floor = Math.min(...strengths.map((q) => q.avg));
  const gaps = [...eligible].sort((a, b) => a.avg - b.avg || b.valid - a.valid)
    .filter((q) => q.avg < floor).slice(0, count);
  return { strengths, gaps, eligible: eligible.length, minN, flat: false };
}

export const QUESTION_EXPORT_HEADERS = [
  'קורס', 'קהל', 'שלב', 'סעיף', 'מדד', 'שאלה', 'סוג', 'N תשובות תקפות', 'לא רלוונטי', 'ממוצע (1–5)',
  '1', '2', '3', '4', '5', 'ניסוח השתנה בין גרסאות'
];

export function questionExportRows(facts = [], { programs = [], metrics = [] } = {}) {
  const rows = [];
  const metricLabel = (key) => metrics.find((m) => m.key === key)?.label || key;
  const keys = uniqueSorted(facts.map((f) => `${f.program_key}|${f.audience}|${f.stage}`));
  for (const key of keys) {
    const [programKey, audience, stage] = key.split('|');
    const program = programs.find((p) => p.key === programKey);
    const subset = facts.filter((f) => f.program_key === programKey && f.audience === audience && f.stage === stage);
    for (const q of questionStats(subset)) {
      rows.push([
        courseLabel(program, programs) || programKey,
        AUDIENCE_LABELS[audience] || audience,
        stageLabelFor(audience, stage),
        q.section === 'course' ? 'ייחודית לקורס' : 'ליבה',
        metricLabel(q.metric_key),
        q.text || '',
        QUESTION_TYPES.find((t) => t.key === q.question_type)?.label || q.question_type,
        q.question_type === 'rating_1_5' ? q.valid : q.n,
        q.na || '',
        q.avg ?? '',
        ...(q.question_type === 'rating_1_5' ? q.dist : ['', '', '', '', '']),
        q.wordingChanged ? 'כן' : ''
      ]);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function answerDisplayValue(fact, optionLabels = {}) {
  const labels = { ...optionLabels };
  for (const option of Array.isArray(fact.question_options) ? fact.question_options : []) {
    if (option?.value) labels[option.value] = option.label || option.value;
  }
  if (fact.question_type === 'rating_1_5') return isNaFact(fact) ? 'לא רלוונטי' : (fact.value_number ?? '');
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
  pushPopulation('מדריך – פתיחה לאחר הכשרה', perspectives.instructorPre || { byMetric: {} });
  pushPopulation('מדריך – סיום הקורס', perspectives.instructorFinal || perspectives.instructor);
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
