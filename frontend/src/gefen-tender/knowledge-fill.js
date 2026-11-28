/**
 * Propose program-detail field values from existing knowledge_items.
 * Never invents values; never overwrites non-empty fields unless force=true.
 * Academic research ("כן") is proposed only with explicit evidence.
 */

import { PROGRAM_DETAIL_FIELDS, TOPIC_CHOICES } from './constants.js';

function plain(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function isEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  return !plain(value);
}

function itemsOf(items, types) {
  const set = new Set(types);
  return (items || []).filter((i) => set.has(String(i?.type || '')));
}

function pickChoice(text, choices) {
  const t = plain(text);
  if (!t || !choices?.length) return '';
  const exact = choices.find((c) => t === c || t.includes(c));
  if (exact) return exact;
  return choices.find((c) => c.length >= 3 && t.includes(c.slice(0, Math.min(6, c.length)))) || '';
}

function pickMulti(text, choices) {
  const t = plain(text);
  if (!t) return [];
  return choices.filter((c) => t.includes(c));
}

function firstContent(list) {
  const hit = (list || []).find((i) => plain(i.content));
  return hit ? { value: plain(hit.content), source: hit.source || hit.type || 'מאגר ידע', item_id: hit.id } : null;
}

function researchEvidence(items) {
  const markers = /מחקר\s+אקדמי|מאמר\s+אקדמי|פרסום\s+מדעי|peer[\s-]?reviewed|academic\s+research/i;
  for (const i of items || []) {
    const blob = `${i.title || ''} ${i.content || ''} ${i.source || ''} ${i.notes || ''}`;
    if (markers.test(blob) && /מצורף|קיים|צורף|attached|document|מסמך/i.test(blob)) {
      return { value: 'כן', source: i.source || i.title || 'מאגר ידע', item_id: i.id };
    }
  }
  return null;
}

/**
 * Build proposals for PROGRAM_DETAIL_FIELDS from knowledge + syllabus hints.
 * @returns {Array<{ field, label, value, source, item_id, multi }>}
 */
export function proposeProgramDetailFills(payload = {}, { force = false } = {}) {
  const details = payload.details || {};
  const items = Array.isArray(payload.knowledge_items) ? payload.knowledge_items : [];
  const sessions = Array.isArray(payload.syllabus_sessions) ? payload.syllabus_sessions : [];
  const proposals = [];

  const push = (field, label, value, source, item_id, multi = false) => {
    if (value == null || (Array.isArray(value) ? !value.length : !plain(value))) return;
    const current = details[field];
    if (!force && !isEmpty(current)) return;
    proposals.push({ field, label, value, source: source || 'מאגר ידע', item_id: item_id || '', multi });
  };

  const fieldMeta = Object.fromEntries(PROGRAM_DETAIL_FIELDS.map(([k, l, , choices, multi]) => [k, { label: l, choices, multi }]));

  const goalHit = firstContent(itemsOf(items, ['מטרה']));
  if (goalHit) push('goal', fieldMeta.goal.label, goalHit.value.slice(0, 750), goalHit.source, goalHit.item_id);

  const summaryHit = firstContent(itemsOf(items, ['תוכן', 'עובדה', 'מבנה']));
  if (summaryHit) push('summary', fieldMeta.summary.label, summaryHit.value.slice(0, 1000), summaryHit.source, summaryHit.item_id);

  const audienceHit = firstContent(itemsOf(items, ['קהל יעד']));
  if (audienceHit) {
    const choice = pickChoice(audienceHit.value, fieldMeta.audience.choices);
    if (choice) push('audience', fieldMeta.audience.label, choice, audienceHit.source, audienceHit.item_id);
  }
  if (isEmpty(details.audience) && (payload.grades || sessions.length)) {
    push('audience', fieldMeta.audience.label, 'תלמידים', payload.grades ? `שכבות גיל: ${payload.grades}` : 'סילבוס', '');
  }

  const skillItems = itemsOf(items, ['מיומנות']);
  const skillText = skillItems.map((i) => i.content).join(' ');
  const sessionSkills = sessions.map((s) => s.skills_values || '').join(' ');
  const skills = pickMulti(`${skillText} ${sessionSkills}`, fieldMeta.skills.choices || []);
  if (skills.length) {
    push('skills', fieldMeta.skills.label, skills, skillItems[0]?.source || 'סילבוס/מאגר', skillItems[0]?.id || '', true);
  }

  const topicBlob = items.map((i) => `${i.topic || ''} ${i.title || ''} ${i.content || ''}`).join(' ');
  const topic = pickChoice(topicBlob, TOPIC_CHOICES);
  if (topic) push('topic', fieldMeta.topic.label, topic, 'התאמה מתוך מאגר ידע', '');
  const secondaryChoices = TOPIC_CHOICES.filter((c) => c !== topic);
  const secondary = pickChoice(topicBlob.replace(topic, ''), secondaryChoices);
  if (secondary && secondary !== topic) {
    push('secondary', fieldMeta.secondary.label, secondary, 'התאמה מתוך מאגר ידע', '');
  }

  const domain = pickChoice(topicBlob, fieldMeta.domain.choices);
  if (domain) push('domain', fieldMeta.domain.label, domain, 'התאמה מתוך מאגר ידע', '');

  const typeChoice = /חד.?פעמי/.test(topicBlob) ? 'חד פעמית'
    : /(מתמשך|סדרת מפגשים|מפגשים)/.test(topicBlob) || sessions.length > 1 ? 'מתמשכת' : '';
  if (typeChoice) push('type', fieldMeta.type.label, typeChoice, sessions.length ? 'מבנה סילבוס' : 'מאגר ידע', '');

  const ministry = pickChoice(topicBlob, fieldMeta.ministry.choices);
  if (ministry) push('ministry', fieldMeta.ministry.label, ministry, 'התאמה מתוך מאגר ידע', '');

  for (const key of ['sector', 'supervision', 'education', 'mode']) {
    const meta = fieldMeta[key];
    const found = pickMulti(topicBlob, meta.choices || []);
    if (found.length) push(key, meta.label, found, 'התאמה מתוך מאגר ידע', '', true);
  }

  const emergency = pickChoice(topicBlob, fieldMeta.emergency.choices);
  if (emergency) push('emergency', fieldMeta.emergency.label, emergency, 'התאמה מתוך מאגר ידע', '');

  // Research: only propose "כן" with evidence; otherwise may propose "לא" when knowledge asserts none.
  const yes = researchEvidence(items);
  if (yes) {
    push('research', fieldMeta.research.label, 'כן', yes.source, yes.item_id);
  } else {
    const noHit = (items || []).find((i) => /אין\s+מסמך\s+מחקר|ללא\s+מחקר\s+אקדמי|לא\s+צורף\s+מחקר/i.test(`${i.content || ''} ${i.notes || ''}`));
    if (noHit) push('research', fieldMeta.research.label, 'לא', noHit.source || noHit.title || 'מאגר ידע', noHit.id);
  }

  return proposals;
}

/** Apply selected proposals into details without wiping unspecified fields. */
export function applyDetailProposals(details = {}, proposals = [], selectedFields = null) {
  const next = { ...details };
  const allow = selectedFields ? new Set(selectedFields) : null;
  for (const p of proposals) {
    if (allow && !allow.has(p.field)) continue;
    if (p.multi || Array.isArray(p.value)) {
      next[p.field] = Array.isArray(p.value) ? [...p.value] : [p.value];
    } else {
      next[p.field] = p.value;
    }
  }
  return next;
}

/** Suggest syllabus audience / methods / skills from knowledge when session fields empty. */
export function proposeSyllabusSessionFills(session = {}, payload = {}) {
  const proposals = [];
  const grades = plain(payload.grades || payload.details?.grades || '');
  const stage = plain(session.age_stage || '');
  if (!plain(session.audience) && (grades || stage)) {
    const value = [stage && stage !== 'כללי' ? stage : '', grades].filter(Boolean).join(' · ');
    if (value) proposals.push({ field: 'audience', value, source: 'פרטי תוכנית / שכבת גיל' });
  }
  const items = payload.knowledge_items || [];
  if (!plain(session.methods)) {
    const hit = firstContent(itemsOf(items, ['שיטת הוראה']));
    if (hit) proposals.push({ field: 'methods', value: hit.value, source: hit.source });
  }
  if (!plain(session.skills_values)) {
    const hit = firstContent(itemsOf(items, ['מיומנות']));
    if (hit) proposals.push({ field: 'skills_values', value: hit.value, source: hit.source });
  }
  return proposals;
}

/** Count distinct meetings covered by session ranges (optional modules included). */
export function countSyllabusMeetings(sessions = []) {
  let max = 0;
  for (const s of sessions) {
    const to = Number(s.meeting_to || s.meeting_number || s.meeting_from) || 0;
    if (to > max) max = to;
  }
  return max || sessions.length;
}

export function uniformSessionDuration(sessions = []) {
  const mins = sessions.map((s) => Number(s.duration_minutes) || 0).filter((n) => n > 0);
  if (!mins.length) return 0;
  return mins.every((n) => n === mins[0]) ? mins[0] : 0;
}

/** Official form-174 catalog cell — never invent URLs or item numbers. */
export function catalogRefForExport(session = {}) {
  const num = plain(session.catalog_item_number);
  const url = plain(session.catalog_item_url);
  if (!num && !url) return '';
  if (num && url) return `${num} | ${url}`;
  return num || url;
}
