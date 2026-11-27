import { ADMIN_STATUSES } from './constants.js';
import { answerText, isFinalAnswer, withinLimit } from './final-answers.js';
import {
  BASKET_112, association112, enrichQuestion112, withinWordLimit,
  limitedAnswerText
} from './questionnaire-112.js';

export function administrativeCompleted(adminRow) {
  const sections = adminRow?.payload?.sections || {};
  return Object.values(sections).filter((x) => x.status === ADMIN_STATUSES[5]).length;
}

function q112Answers(row) {
  const { index, association } = association112(row.payload || {});
  if (index < 0 || !association) return { index: -1, questions: [], answers: [] };
  const questions = (association.questions || []).map((q, j) => {
    const e = enrichQuestion112(q);
    return {
      key: `association.${index}.${j}`,
      question_id: e.id,
      number: e.number,
      label: e.label,
      value: e.answer_type === 'yes_no_text'
        ? [e.answer, e.answer_extra].filter(Boolean).join(' — ')
        : answerText(e.answer),
      limit: e.limit,
      limit_words: e.limit_words,
      mapping_verified: e.mapping_verified,
      chapter_label: e.chapter_label
    };
  });
  return { index, questions, association };
}

/** Readiness for basket 112 only — missing data is "חסר/טרם נבדק", never automatic threshold fail. */
export function readiness112(row, adminCompleted) {
  const { index, questions, association } = q112Answers(row);
  if (index < 0) {
    return {
      applicable: false,
      approved: 0,
      total: 41,
      missing: 0,
      drafts: 0,
      over: 0,
      statuses: {},
      progress_pct: 0,
      work_state: 'ללא שיוך 112'
    };
  }

  const finals = row.payload?.final_answers || {};
  let missing = 0;
  let drafts = 0;
  let approved = 0;
  let over = 0;
  for (const a of questions) {
    const has = Boolean(String(a.value || '').trim());
    const isFinal = isFinalAnswer(finals, a.key, a.value);
    if (!has) missing += 1;
    else if (isFinal) approved += 1;
    else drafts += 1;
    const limited = limitedAnswerText(a);
    if (a.limit && !withinLimit(limited, a.limit)) over += 1;
    if (a.limit_words && !withinWordLimit(limited, a.limit_words)) over += 1;
  }

  const p = row.payload || {};
  const statusOf = (filled) => (filled ? 'הוזן' : 'טרם הוזן');
  const statuses = {
    threshold: association?.eligibility_verified === true ? 'נבדק' : 'טרם נבדק',
    developers: (p.developer_ids || []).length || answerText(p.developers).trim() ? 'הוזן' : 'טרם הוזן',
    operators: (p.operator_ids || []).length || answerText(p.operators).trim() ? 'הוזן' : 'טרם הוזן',
    experience: statusOf(answerText(p.experience).trim()),
    recommendations: statusOf(answerText(p.recommendations).trim()),
    syllabus: statusOf(answerText(p.syllabus).trim() || (p.syllabus_items || []).length),
    documents: statusOf(answerText(p.sharepoint_notes).trim() || answerText(p.drive_folder_url).trim()),
    forms: p.excel_templates_ready === true ? 'מוכן' : 'טרם הועלה',
    admin: adminCompleted === 19 ? 'הושלם' : `${adminCompleted}/19`
  };

  let work_state = 'בתהליך';
  if (missing === questions.length) work_state = 'טרם התחיל';
  else if (approved === questions.length && questions.length) work_state = 'תשובות מאושרות';
  else if (drafts || approved) work_state = 'בתהליך';

  return {
    applicable: true,
    index,
    association,
    questions,
    approved,
    total: questions.length || 41,
    missing,
    drafts,
    over,
    statuses,
    progress_pct: questions.length ? Math.round((approved / questions.length) * 100) : 0,
    work_state
  };
}

export function programReadinessRows112(rows) {
  const adminCompleted = administrativeCompleted(rows.find((r) => r.kind === 'administrative'));
  return rows
    .filter((r) => r.kind === 'program')
    .filter((r) => (r.payload?.associations || []).some((a) => Number(a.code) === BASKET_112))
    .map((r) => ({ row: r, ...readiness112(r, adminCompleted) }));
}

/** Compatibility helper — progress_pct is informational only, never threshold proof. */
export function associationReadiness(row, associationIndex, adminCompleted) {
  const association = row.payload?.associations?.[associationIndex] || {};
  if (Number(association.code) === BASKET_112) {
    const r = readiness112(row, adminCompleted);
    const issues = [];
    if (association.mapping_verified !== true) {
      issues.push({ code: 'mapping', label: 'מיפוי שאלון', target: 'program' });
    }
    if (association.eligibility_verified !== true) {
      issues.push({ code: 'threshold', label: 'תנאי סף', target: 'program' });
    }
    if (r.missing) issues.push({ code: 'answers', label: `${r.missing} תשובות חסרות`, target: 'submission' });
    if (adminCompleted !== 19) issues.push({ code: 'admin', label: 'הגשה מנהלית', target: 'administrative' });
    return {
      ...r,
      association,
      pending: r.drafts,
      unmapped: association.mapping_verified === true ? 0 : 1,
      issues,
      // Never treat answer fill % as threshold compliance
      ready_for_submission: false
    };
  }
  return {
    association,
    missing: 0,
    pending: 0,
    over: 0,
    unmapped: 0,
    issues: [{ code: 'scope', label: 'מחוץ להיקף 112 בשלב זה', target: 'program' }],
    progress_pct: 0,
    ready_for_submission: false
  };
}

export function programReadinessRows(rows) {
  return programReadinessRows112(rows);
}
