import { VERIFICATION_STATUSES } from './constants.js';

/** Strip markup/entities so knowledge never stores HTML that later appears as visible tags. */
export function plainKnowledgeText(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function createKnowledgeItem(partial = {}) {
  const now = new Date().toISOString();
  const content = plainKnowledgeText(partial.content || '');
  return {
    id: partial.id || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    title: plainKnowledgeText(partial.title || '') || content.slice(0, 80),
    type: partial.type || 'עובדה',
    content,
    source: String(partial.source || '').trim(),
    source_url: String(partial.source_url || '').trim(),
    source_date: partial.source_date || '',
    updated_at: partial.updated_at || now,
    verification_status: VERIFICATION_STATUSES.includes(partial.verification_status)
      ? partial.verification_status
      : 'לא אומת',
    related_questions: Array.isArray(partial.related_questions) ? partial.related_questions : [],
    notes: String(partial.notes || '').trim(),
    // Extended fields for unified / Excel intake (optional on legacy items)
    topic: String(partial.topic || '').trim(),
    original_question: String(partial.original_question || '').trim(),
    info_kind: String(partial.info_kind || '').trim(),
    source_program_name: String(partial.source_program_name || '').trim(),
    source_program_names: String(partial.source_program_names || '').trim(),
    basket_context: String(partial.basket_context || '').trim(),
    source_question_numbers: String(partial.source_question_numbers || '').trim(),
    control_notes: String(partial.control_notes || '').trim(),
    source_occurrences: Number(partial.source_occurrences || 0) || 0,
    program_id: partial.program_id || null,
    assignment_status: partial.assignment_status || (partial.program_id ? 'assigned' : ''),
    program_match_suggestions: Array.isArray(partial.program_match_suggestions)
      ? partial.program_match_suggestions
      : [],
    shared_with_program_ids: Array.isArray(partial.shared_with_program_ids)
      ? partial.shared_with_program_ids.filter(Boolean)
      : [],
    age_share: String(partial.age_share || '').trim(),
    intake_at: partial.intake_at || '',
    import_batch_id: String(partial.import_batch_id || '').trim(),
    is_submission_answer: false,
    verified_for_2027: partial.verified_for_2027 === true
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

/** Non-factual intake kinds — kept in the bank but never presented as program facts. */
const NON_FACTUAL_KIND = /אפשרויות בחירה|ללא בחירה|הערת עבודה|חזרה על השאלה|ללא תשובה|אזכור מסמך|הפניה לתשובה/;

export function knowledgeContentRole(item) {
  if (!item) return 'unknown';
  if (item.content_role) return item.content_role;
  if (item.assignment_status === 'inactive') return 'inactive';
  const kind = String(item.info_kind || '');
  if (/אפשרויות בחירה|ללא בחירה/.test(kind)) return 'choice_blank';
  if (/הערת עבודה/.test(kind)) return 'work_note';
  if (/חזרה על השאלה|ללא תשובה/.test(kind)) return 'question_echo';
  if (/אזכור מסמך/.test(kind)) return 'document_mention';
  if (/הפניה לתשובה/.test(kind)) return 'cross_reference';
  if (/בחירה היסטורית/.test(kind)) return 'historical_choice';
  if (/תשובה|מידע\s*\/\s*תשובה/.test(kind) || item.type === 'תשובה היסטורית') return 'factual';
  if (NON_FACTUAL_KIND.test(kind)) return 'non_factual';
  return 'factual';
}

/** True when the item may be used as program knowledge in ChatGPT packets. */
export function isFactualKnowledgeItem(item) {
  if (!item || item.assignment_status === 'inactive') return false;
  const role = knowledgeContentRole(item);
  return role === 'factual' || role === 'historical_choice';
}

/** Pending = awaiting program assignment. Inactive items stay in the bank but are not pending. */
export function isKnowledgePending(item) {
  if (!item) return false;
  if (item.assignment_status === 'inactive') return false;
  if (item.assignment_status === 'assigned' && item.program_id) return false;
  return item.assignment_status === 'pending_program' || !item.program_id;
}

export function isKnowledgeActive(item) {
  return Boolean(item) && item.assignment_status !== 'inactive';
}

/** Mark items inactive without deleting; they leave the pending queue. */
export function deactivateKnowledgeItems(unassigned, itemIds = [], reason = '') {
  const ids = new Set(itemIds);
  const now = new Date().toISOString();
  return (Array.isArray(unassigned) ? unassigned : []).map((item) => {
    if (!ids.has(item.id)) return item;
    const notes = [
      String(item.notes || '').trim(),
      reason ? `לא פעיל לשלב הנוכחי: ${reason}` : 'לא פעיל לשלב הנוכחי'
    ].filter(Boolean).join('\n');
    return {
      ...item,
      assignment_status: 'inactive',
      program_id: null,
      updated_at: now,
      notes
    };
  });
}

/** Assign pending knowledge item onto a program list (by moving id). */
export function assignKnowledgeToProgram(unassigned, programItems, itemId, programId) {
  const pending = Array.isArray(unassigned) ? [...unassigned] : [];
  const idx = pending.findIndex((x) => x.id === itemId);
  if (idx < 0) return { unassigned: pending, programItems: programItems || [] };
  const item = {
    ...pending[idx],
    program_id: programId,
    assignment_status: 'assigned',
    updated_at: new Date().toISOString()
  };
  pending.splice(idx, 1);
  return {
    unassigned: pending,
    programItems: appendKnowledgeItems(programItems || [], [item])
  };
}

/**
 * Assign one pending item to one or more programs (dual-share).
 * Removes from unassigned once; appends the same content to each program list.
 * shared_with_program_ids preserves linkage without inventing content.
 */
export function assignKnowledgeToPrograms(unassigned, programItemsById, itemId, programIds = []) {
  const pending = Array.isArray(unassigned) ? [...unassigned] : [];
  const idx = pending.findIndex((x) => x.id === itemId);
  const targets = [...new Set((programIds || []).filter(Boolean))];
  if (idx < 0 || !targets.length) {
    return { unassigned: pending, programItemsById: programItemsById || {} };
  }
  const now = new Date().toISOString();
  const base = pending[idx];
  pending.splice(idx, 1);
  const next = { ...(programItemsById || {}) };
  for (const programId of targets) {
    const shared = targets.filter((id) => id !== programId);
    const item = {
      ...base,
      program_id: programId,
      assignment_status: 'assigned',
      shared_with_program_ids: shared,
      age_share: shared.length ? 'shared' : (base.age_share || ''),
      updated_at: now
    };
    next[programId] = appendKnowledgeItems(next[programId] || [], [item]);
  }
  return { unassigned: pending, programItemsById: next };
}
