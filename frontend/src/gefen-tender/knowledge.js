import { VERIFICATION_STATUSES } from './constants.js';

export function createKnowledgeItem(partial = {}) {
  const now = new Date().toISOString();
  const content = String(partial.content || '').trim();
  return {
    id: partial.id || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    title: String(partial.title || '').trim() || content.slice(0, 80),
    type: partial.type || 'עובדה',
    content,
    source: String(partial.source || '').trim(),
    source_url: String(partial.source_url || '').trim(),
    source_date: partial.source_date || '',
    updated_at: now,
    verification_status: VERIFICATION_STATUSES.includes(partial.verification_status)
      ? partial.verification_status
      : 'לא אומת',
    related_questions: Array.isArray(partial.related_questions) ? partial.related_questions : [],
    notes: String(partial.notes || '').trim()
  };
}

/** Append-only merge: never delete existing items; skip exact id duplicates. */
export function appendKnowledgeItems(existing, incoming) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const ids = new Set(list.map((x) => x.id));
  for (const raw of incoming || []) {
    const item = createKnowledgeItem(raw);
    if (!item.content) continue;
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    list.push(item);
  }
  return list;
}

export function knowledgeFromCatalog(details) {
  if (!details) return [];
  const source = 'catalog_program_details';
  const pairs = [
    ['עובדה', details.short_description],
    ['מטרה', details.goals],
    ['תוכן', details.core_idea],
    ['מבנה', details.program_flow],
    ['תוצר תלמידים', details.final_outcome],
    ['מיומנות', details.student_develops],
    ['סילבוס', typeof details.syllabus === 'string' ? details.syllabus : null]
  ];
  return pairs
    .filter(([, content]) => content && String(content).trim())
    .map(([type, content]) => createKnowledgeItem({
      type,
      content: String(content).trim(),
      source,
      source_url: '',
      verification_status: 'ממתין לאימות',
      notes: 'יובא מקטלוג הדשבורד — יש לאמת לפני שימוש כתשובה סופית'
    }));
}

export function summarizeGaps(payload, answers) {
  const gaps = [];
  const items = payload?.knowledge_items || [];
  if (!items.length && !payload?.knowledge_notes) gaps.push('מאגר ידע מצטבר ריק');
  const unverified = items.filter((i) => i.verification_status !== 'אומת');
  if (unverified.length) gaps.push(`${unverified.length} פריטי ידע שטרם אומתו`);
  for (const a of answers || []) {
    if (a.unmapped || a.mapping_verified === false) {
      gaps.push(`מיפוי לא מאומת: ${a.label}`);
    }
    if (!String(a.value || '').trim()) gaps.push(`חסר מענה: ${a.label}`);
  }
  if (!payload?.drive_folder_url) gaps.push('לא שויכה תיקיית Google Drive לתוכנית');
  return [...new Set(gaps)];
}
