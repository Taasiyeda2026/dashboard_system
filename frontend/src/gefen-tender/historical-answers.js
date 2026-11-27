/** Historical tender-answer import — separate from 2027 final answers. */

export function createHistoricalAnswer(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    program_id: partial.program_id || '',
    question_id: String(partial.question_id || '').trim(),
    tender_year: String(partial.tender_year || partial.year || '').trim(),
    original_question: String(partial.original_question || partial.question || '').trim(),
    answer: String(partial.answer || partial.text || '').trim(),
    source: String(partial.source || '').trim(),
    source_url: String(partial.source_url || '').trim(),
    notes: String(partial.notes || '').trim(),
    imported_at: partial.imported_at || now,
    updated_at: now
  };
}

export function parseHistoricalImport(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.answers)
      ? parsed.answers
      : Array.isArray(parsed.items)
        ? parsed.items
        : null;
  if (!list) throw new Error('נדרש מערך answers/items');
  return list.map((row) => {
    const item = createHistoricalAnswer(row);
    if (!item.question_id && !item.original_question) {
      throw new Error('לכל רשומה נדרש question_id או original_question');
    }
    if (!item.answer) throw new Error('לכל רשומה נדרשת תשובה היסטורית');
    return item;
  });
}

/** Append-only merge by id; never touches final_answers. */
export function appendHistoricalAnswers(existing, incoming) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const ids = new Set(list.map((x) => x.id));
  for (const raw of incoming || []) {
    const item = createHistoricalAnswer(raw);
    if (!item.answer) continue;
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    list.push(item);
  }
  return list;
}

export function historicalForQuestion(items, questionId, label = '') {
  return (items || []).filter((h) =>
    (questionId && h.question_id === questionId) ||
    (label && h.original_question && h.original_question === label)
  );
}
