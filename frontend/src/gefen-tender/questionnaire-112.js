/** Basket 112 questionnaire helpers — enrich and merge without inventing wording. */

export const BASKET_112 = 112;
export const BASKET_112_TITLE = 'חדשנות ויזמות טכנולוגית';

/** UX chapter groups for the submission workspace navigation. */
export const CHAPTERS_112 = [
  { id: 'general', label: 'שאלות כלליות', from: 1, to: 11 },
  { id: 'content', label: 'תוכן ופדגוגיה', from: 12, to: 23 },
  { id: 'people', label: 'מפתחים ומפעילים', from: 24, to: 26 },
  { id: 'experience', label: 'ניסיון קודם', from: 27, to: 28 },
  { id: 'recommendations', label: 'המלצות', from: 29, to: 29 },
  { id: 'safety', label: 'בטיחות', from: 30, to: 41 }
];

const YES_NO_EXTRA = new Set([2, 3, 4, 5, 7, 10]);
const YES_NO_CHOICES = ['כן', 'לא'];

export function chapterForNumber(n) {
  const num = Number(n);
  return CHAPTERS_112.find((c) => num >= c.from && num <= c.to) || { id: 'other', label: 'אחר' };
}

export function enrichQuestion112(raw) {
  const number = Number(raw.number || raw.order || 0);
  const requirements = raw.requirements || null;
  let limit = raw.limit ?? raw.character_limit ?? null;
  let limit_words = raw.limit_words ?? null;
  if (!limit_words && typeof requirements === 'string') {
    const m = requirements.match(/(\d+)\s*מילים/);
    if (m) limit_words = Number(m[1]);
  }
  if (!limit_words && /עד\s*70\s*מילים/.test(String(raw.label || ''))) limit_words = 70;

  let answer_type = raw.answer_type || (raw.choices ? 'single_choice' : 'text');
  let choices = Array.isArray(raw.choices) ? raw.choices : null;
  let extra_text = Boolean(raw.extra_text);
  if (YES_NO_EXTRA.has(number) || /כן\/לא\s*\+\s*טקסט/.test(String(requirements || ''))) {
    answer_type = 'yes_no_text';
    choices = choices || YES_NO_CHOICES;
    extra_text = true;
  } else if (/כן\/לא/.test(String(requirements || '')) && !choices) {
    answer_type = 'single_choice';
    choices = YES_NO_CHOICES;
  }

  const chapter = chapterForNumber(number);
  return {
    id: String(raw.id || `112.${number}`),
    number,
    order: Number(raw.order || number),
    questionnaire: '112',
    label: String(raw.label || raw.text || '').trim(),
    answer_type,
    choices,
    multi: Boolean(raw.multi),
    extra_text,
    limit,
    limit_words,
    required: raw.required !== false && !/רשות/.test(String(requirements || '')),
    show_when: raw.show_when || null,
    requirements,
    threshold_conditions: raw.threshold_conditions || raw.conditions || null,
    professional_criteria: raw.professional_criteria || raw.criteria || null,
    attachments: raw.attachments || null,
    source: raw.source || 'שאלות STEM.docx',
    mapping_verified: raw.mapping_verified === true,
    chapter_id: chapter.id,
    chapter_label: chapter.label,
    answer: raw.answer ?? '',
    answer_extra: raw.answer_extra ?? ''
  };
}

/** Preserve answers by stable question id when catalog wording updates. */
export function mergeQuestionsPreservingAnswers(catalogQuestions, existingQuestions = []) {
  const byId = new Map((existingQuestions || []).map((q) => [String(q.id), q]));
  return (catalogQuestions || []).map((raw, i) => {
    const enriched = enrichQuestion112({ ...raw, number: raw.number ?? i + 1 });
    const prev = byId.get(enriched.id);
    if (!prev) return enriched;
    return {
      ...enriched,
      answer: prev.answer ?? '',
      answer_extra: prev.answer_extra ?? ''
    };
  });
}

export function association112(payload) {
  const list = payload?.associations || [];
  const index = list.findIndex((a) => Number(a.code) === BASKET_112);
  if (index < 0) return { index: -1, association: null };
  return { index, association: list[index] };
}

export function programsWith112(rows) {
  return (rows || []).filter((r) =>
    r.kind === 'program' && (r.payload?.associations || []).some((a) => Number(a.code) === BASKET_112)
  );
}

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function withinWordLimit(text, limitWords) {
  if (!limitWords) return true;
  return countWords(text) <= limitWords;
}

export function displayAnswerValue(q) {
  if (q.answer_type === 'yes_no_text') {
    const base = String(q.answer || '').trim();
    const extra = String(q.answer_extra || '').trim();
    return extra ? `${base}${base ? ' — ' : ''}${extra}` : base;
  }
  if (Array.isArray(q.answer)) return q.answer.join(', ');
  return String(q.answer ?? '');
}
