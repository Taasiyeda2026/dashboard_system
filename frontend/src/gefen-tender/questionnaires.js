import { BASKETS, PROGRAM_DETAIL_FIELDS } from './constants.js';
import { answerText } from './final-answers.js';

/**
 * Questionnaire catalog.
 * New-program fields are verified from the official form already embedded in the product.
 * Basket-specific question banks are NOT invented: they must be imported from verified
 * SharePoint sources (שאלות STEM.docx / screenshots) and marked mapping_verified=true.
 */

export function newProgramQuestions() {
  return PROGRAM_DETAIL_FIELDS.map(([key, label, limit, choices, multi], index) => ({
    id: `new.${key}`,
    number: index + 1,
    order: index + 1,
    questionnaire: 'new_program',
    label,
    answer_type: choices ? (multi ? 'multi_choice' : 'single_choice') : 'text',
    choices: choices || null,
    multi: Boolean(multi),
    limit: typeof limit === 'number' && limit > 0 ? limit : null,
    required: true,
    show_when: null,
    requirements: null,
    threshold_conditions: null,
    professional_criteria: null,
    attachments: null,
    source: 'טופס הגשת תוכנית חדשה — שדות רשמיים בממשק גפ״ן (מוטמע במוצר)',
    mapping_verified: true,
    field_key: key
  }));
}

export function documentQuestions() {
  return [
    ['syllabus', 'סילבוס / תוכנית למידה'],
    ['experience', 'ניסיון בהפעלת התוכנית'],
    ['recommendations', 'המלצות'],
    ['developers', 'מפתחים משויכים'],
    ['operators', 'מפעילים משויכים']
  ].map(([key, label], index) => ({
    id: `doc.${key}`,
    number: index + 1,
    order: index + 1,
    questionnaire: 'documents',
    label,
    answer_type: 'text',
    choices: null,
    multi: false,
    limit: null,
    required: true,
    mapping_verified: false,
    source: 'דרישות נלוות להגשה — יש לאמת מול מסמכי המכרז',
    field_key: key
  }));
}

/** Empty verified shells for baskets — do not invent question wording. */
export function basketQuestionnaireMeta(code) {
  const expected = {
    106: { expected_min: null, note: 'מיפוי שאלון תת־סל 106 טרם אומת מול צילומי מסך / מסמכי המכרז.' },
    112: { expected_min: 41, note: 'במסמך שאלות STEM דווח על 41 שאלות לתת־סל 112 — נוסח רשמי טרם יובא למערכת.' },
    114: { expected_min: null, note: 'מיפוי שאלון תת־סל 114 טרם אומת מול המקור הרשמי.' },
    706: { expected_min: 5, note: 'במסמך שאלות STEM דווח על 5 שאלות למסגרת STEM ו־18 קריטריונים בחמש קבוצות — נוסח רשמי טרם יובא.' }
  }[Number(code)] || { expected_min: null, note: 'מיפוי שאלון טרם אומת.' };

  return {
    code: Number(code),
    title: BASKETS[code] || String(code),
    mapping_verified: false,
    expected_min: expected.expected_min,
    note: expected.note,
    questions: []
  };
}

export function normalizeImportedQuestion(raw, index, questionnaire) {
  const id = String(raw.id || raw.question_id || `${questionnaire}.${index + 1}`).trim();
  if (!id) throw new Error('לכל שאלה נדרש מזהה קבוע');
  return {
    id,
    number: Number(raw.number ?? index + 1),
    order: Number(raw.order ?? raw.number ?? index + 1),
    questionnaire,
    label: String(raw.label || raw.text || raw.question || '').trim(),
    answer_type: raw.answer_type || (raw.choices ? 'single_choice' : 'text'),
    choices: Array.isArray(raw.choices) ? raw.choices : null,
    multi: Boolean(raw.multi),
    limit: raw.limit ?? raw.character_limit ?? null,
    required: raw.required !== false,
    show_when: raw.show_when || null,
    requirements: raw.requirements || null,
    threshold_conditions: raw.threshold_conditions || raw.conditions || null,
    professional_criteria: raw.professional_criteria || raw.criteria || null,
    attachments: raw.attachments || null,
    source: raw.source || 'ייבוא ידני',
    mapping_verified: raw.mapping_verified === true,
    answer: raw.answer ?? ''
  };
}

export function parseQuestionnaireImport(text, questionnaire) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(list) || !list.length) throw new Error('נדרש מערך שאלות');
  return list.map((q, i) => normalizeImportedQuestion(q, i, questionnaire));
}

export function ensureAssociationQuestions(association) {
  const a = { ...association, code: Number(association.code) };
  if (Array.isArray(a.questions) && a.questions.length) {
    a.questions = a.questions.map((q, i) => ({
      ...normalizeImportedQuestion(q, i, String(a.code)),
      answer: q.answer ?? ''
    }));
    a.mapping_verified = a.mapping_verified === true && a.questions.every((q) => q.mapping_verified);
    return a;
  }
  const meta = basketQuestionnaireMeta(a.code);
  return {
    ...a,
    mapping_verified: false,
    mapping_note: meta.note,
    expected_question_count: meta.expected_min,
    questions: []
  };
}

export function buildSubmissionAnswers(row) {
  const p = row.payload || {};
  const answers = [];

  for (const q of newProgramQuestions()) {
    const value = p.details?.[q.field_key] ?? (q.field_key === 'name' ? row.title : '');
    answers.push({
      key: `details.${q.field_key}`,
      question_id: q.id,
      group: 'תוכנית חדשה',
      label: q.label,
      value: answerText(value),
      limit: q.limit,
      choices: q.choices,
      multi: q.multi,
      mapping_verified: q.mapping_verified,
      source: q.source,
      requirements: q.requirements,
      criteria: q.professional_criteria,
      conditions: q.threshold_conditions
    });
  }

  (p.associations || []).forEach((raw, i) => {
    const a = ensureAssociationQuestions(raw);
    const group = `${a.code} – ${BASKETS[a.code] || a.code}`;
    if (!a.questions.length) {
      answers.push({
        key: `association.${i}.placeholder`,
        question_id: `assoc.${a.code}.unmapped`,
        group,
        label: a.mapping_note || 'מיפוי שאלון תת־הסל טרם אומת — אין להמציא שאלות',
        value: answerText(a.answers),
        limit: null,
        choices: null,
        multi: false,
        mapping_verified: false,
        code: a.code,
        unmapped: true,
        source: 'ממתין לייבוא ממקור רשמי'
      });
      return;
    }
    a.questions.forEach((q, j) => {
      answers.push({
        key: `association.${i}.${j}`,
        question_id: q.id,
        group,
        label: q.label,
        value: answerText(q.answer),
        limit: q.limit,
        choices: q.choices,
        multi: q.multi,
        mapping_verified: q.mapping_verified === true,
        code: a.code,
        requirements: q.requirements,
        criteria: q.professional_criteria,
        conditions: q.threshold_conditions,
        source: q.source
      });
    });
  });

  for (const q of documentQuestions()) {
    answers.push({
      key: q.field_key,
      question_id: q.id,
      group: 'מסמכים ונספחים',
      label: q.label,
      value: answerText(p[q.field_key]),
      limit: null,
      choices: null,
      multi: false,
      mapping_verified: false,
      source: q.source
    });
  }

  return answers;
}
