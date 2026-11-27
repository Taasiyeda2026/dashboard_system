import { ADMIN_STATUSES } from './constants.js';
import { answerText, isFinalAnswer, withinLimit } from './final-answers.js';
import { buildSubmissionAnswers } from './questionnaires.js';

export function administrativeCompleted(adminRow) {
  const sections = adminRow?.payload?.sections || {};
  return Object.values(sections).filter((x) => x.status === ADMIN_STATUSES[5]).length;
}

export function associationReadiness(row, associationIndex, adminCompleted) {
  const association = row.payload?.associations?.[associationIndex] || {};
  const answers = buildSubmissionAnswers(row).filter((x) =>
    !x.key.startsWith('association.') || x.key.startsWith(`association.${associationIndex}.`)
  );
  const missing = answers.filter((x) => !answerText(x.value).trim());
  const pending = answers.filter((x) => answerText(x.value).trim() && !isFinalAnswer(row.payload?.final_answers, x.key, x.value));
  const over = answers.filter((x) => x.limit && !withinLimit(x.value, x.limit));
  const unmapped = answers.filter((x) => x.unmapped || x.mapping_verified === false);

  const issues = [];
  if (!association.questions?.length || association.mapping_verified !== true) {
    issues.push({ code: 'mapping', label: 'מיפוי שאלון', target: 'program' });
  }
  if (association.eligibility_verified !== true) {
    issues.push({ code: 'threshold', label: 'תנאי סף', target: 'program' });
  }
  for (const [k, label] of [
    ['syllabus', 'סילבוס'],
    ['recommendations', 'המלצות'],
    ['experience', 'ניסיון בהפעלה'],
    ['developers', 'מפתחים'],
    ['operators', 'מפעילים']
  ]) {
    const hasIds = k === 'developers'
      ? (row.payload?.developer_ids || []).length
      : k === 'operators'
        ? (row.payload?.operator_ids || []).length
        : false;
    if (!answerText(row.payload?.[k]).trim() && !hasIds) {
      issues.push({ code: k, label, target: 'program' });
    }
  }
  if (!(row.payload?.knowledge_items || []).length && !row.payload?.knowledge_notes) {
    issues.push({ code: 'knowledge', label: 'מאגר ידע', target: 'program' });
  }
  const peopleUnchecked = [...(row.payload?.developer_ids || []), ...(row.payload?.operator_ids || [])];
  if (peopleUnchecked.length === 0) {
    issues.push({ code: 'people', label: 'מפתחים/מפעילים שטרם נבדקו', target: 'operator' });
  }
  issues.push({ code: 'forms', label: 'טפסים רשמיים', target: 'submission' });
  if (adminCompleted !== 19) {
    issues.push({ code: 'admin', label: 'הגשה מנהלית', target: 'administrative' });
  }

  const blocking = missing.length + over.length + (association.mapping_verified === true ? 0 : 1);
  return {
    association,
    answers,
    missing: missing.length,
    pending: pending.length,
    over: over.length,
    unmapped: unmapped.length,
    issues,
    // Percent is informational only — never proof of threshold compliance
    progress_pct: answers.length
      ? Math.round((answers.filter((a) => isFinalAnswer(row.payload?.final_answers, a.key, a.value)).length / answers.length) * 100)
      : 0,
    ready_for_submission: blocking === 0 && pending.length === 0 && adminCompleted === 19
  };
}

export function programReadinessRows(rows) {
  const admin = rows.find((r) => r.kind === 'administrative');
  const adminCompleted = administrativeCompleted(admin);
  return rows
    .filter((r) => r.kind === 'program')
    .flatMap((r) => (r.payload?.associations || []).map((_, i) => ({
      row: r,
      index: i,
      ...associationReadiness(r, i, adminCompleted)
    })));
}
