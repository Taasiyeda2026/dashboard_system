import { activeFeedbackQuestions } from './feedback-conditional.js';

// Optional snapshot metadata; legacy questionnaires keep their existing behavior.
export const answerRules = (q) => q.scoring || {};
export const otherAnswerKey = (q) => `${q.id}__other`;
export function needsOtherAnswer(q, value) {
  const other = answerRules(q).other_value;
  return typeof other === 'string' && (Array.isArray(value) ? value.includes(other) : value === other);
}
export function invalidFeedbackAnswers(questions, answers) {
  return activeFeedbackQuestions(questions, answers).filter((q) => {
    const rules = answerRules(q);
    const value = answers[q.id];
    if (q.type === 'free_text' && typeof value === 'string' &&
        [...value].length > (rules.max_length || 2000)) return true;
    if (Array.isArray(value) && (new Set(value).size !== value.length ||
        (value.includes(rules.exclusive_value) && value.length > 1))) return true;
    if (!needsOtherAnswer(q, value)) return false;
    const detail = answers[otherAnswerKey(q)];
    return typeof detail !== 'string' || !detail.trim() ||
      [...detail].length > (rules.other_max_length || 250);
  }).map((q) => q.id);
}
