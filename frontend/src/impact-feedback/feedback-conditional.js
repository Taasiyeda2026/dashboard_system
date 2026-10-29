/**
 * Optional branch conditions for template questions.
 *
 * Conditions are authored as part of the *published template-question snapshot*
 * (question.scoring.visible_when) and resolved to the parent template question ID
 * for public rendering. No impact on legacy questions without visible_when.
 *
 * Shape: { parent_id: uuid, operator: 'nonempty'|'not_equals', value?: string }.
 * Only single-level dependencies are authored; recursive evaluation ensures a
 * question is never shown when an ancestor becomes hidden.
 */
export function conditionalQuestionVisible(question, answers = {}, questions = []) {
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  const visibility = (item, seen) => {
    const rule = item?.visible_when;
    if (!rule) return true;
    if (!rule.parent_id || seen.has(String(item.id))) return false;
    const parent = byId.get(String(rule.parent_id));
    if (!parent || seen.has(String(parent.id))) return false;
    if (!visibility(parent, new Set([...seen, String(item.id)]))) return false;
    const value = answers[parent.id];
    if (rule.operator === 'nonempty') {
      return Array.isArray(value) ? value.length > 0 : typeof value === 'string'
        ? value.trim().length > 0 : value !== null && value !== undefined;
    }
    if (rule.operator === 'in') {
      const allowed = Array.isArray(rule.values) ? rule.values.map(String) : [];
      return !Array.isArray(value) && value !== undefined && value !== null &&
        allowed.includes(String(value));
    }
    if (rule.operator === 'not_equals') {
      return value !== undefined && value !== null && value !== '' &&
        !Array.isArray(value) && String(value) !== String(rule.value ?? '');
    }
    return false; // Invalid rules fail closed.
  };
  return visibility(question, new Set());
}

export function activeFeedbackQuestions(questions = [], answers = {}) {
  return questions.filter((q) => conditionalQuestionVisible(q, answers, questions));
}
