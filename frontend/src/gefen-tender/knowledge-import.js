/**
 * Reusable Excel → Gefen knowledge import.
 * Reads the unified sheet only (program sheets are views — never double-ingest).
 * Never touches final_answers / submission drafts.
 */

import { createKnowledgeItem, appendKnowledgeItems } from './knowledge.js';

export const UNIFIED_SHEET_ALIASES = ['מאגר מאוחד', 'unified', 'knowledge'];
export const PROGRAM_KEY_SHEET_ALIASES = ['תוכניות ומפתח', 'programs'];

/** Column aliases → canonical field (Hebrew source headers from unified workbook). */
export const COLUMN_ALIASES = {
  id: ['מזהה פריט', 'id', 'item_id', 'knowledge_id'],
  program: ['תוכנית', 'program', 'program_name', 'שם תוכנית'],
  topic: ['נושא', 'topic', 'category', 'קטגוריה'],
  original_question: ['שאלה במקור', 'original_question', 'question', 'נוסח השאלה'],
  content: ['תוכן מקורי', 'content', 'answer', 'תשובה', 'תוכן'],
  info_kind: ['סוג מידע', 'info_kind', 'type', 'סוג'],
  sources: ['מקורות (קובץ | גיליון | תא)', 'מקורות', 'sources', 'source'],
  source_program_names: ['שמות תוכנית במקור', 'source_program_names'],
  basket_context: ['הקשר תת סל במקור', 'basket_context', 'תת סל'],
  source_question_numbers: ['מספרי שאלה במקור', 'source_question_numbers'],
  control_notes: ['הערת בקרה', 'control_notes', 'notes', 'הערות'],
  occurrences: ['מופעי מקור', 'occurrences']
};

/** Topic → suggested 112 question ids (heuristic; never required for intake). */
export const TOPIC_TO_112 = {
  'התאמה לתוכנית ולתת הסל': ['112.6', '112.1'],
  'תקציר ותיאור התוכנית': ['112.6', '112.13'],
  'מטרות': ['112.13'],
  'פדגוגיה ושיטות עבודה': ['112.14'],
  'ידע ותכנים': ['112.17'],
  'ערכים': ['112.18'],
  'מיומנויות': ['112.19'],
  'סילבוס': ['112.16'],
  'היקף ומודל פעילות': ['112.15'],
  'קהל יעד ופריסה': ['112.1', '112.15'],
  'הכשרת מפעילים': ['112.26'],
  'השכלה וניסיון מפתחים': ['112.24'],
  'ניסיון מפעילים': ['112.25'],
  'ניסיון בהפעלה': ['112.27', '112.28'],
  'המלצות': ['112.29'],
  'דיגיטל ואבטחת מידע': ['112.8'],
  'חומרי לימוד': ['112.7'],
  'נגישות ובטיחות': ['112.3', '112.4', '112.30'],
  'מסמכים ואסמכתאות': ['112.11'],
  'הצהרות ותנאי הפעלה': ['112.2', '112.5', '112.10', '112.12']
};

function norm(s) {
  return String(s || '')
    .replace(/[\u200f\u200e]/g, '')
    .replace(/[״"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pickCol(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]);
  }
  // case-insensitive fallback
  const map = Object.fromEntries(Object.keys(row).map((k) => [norm(k), k]));
  for (const k of keys) {
    const real = map[norm(k)];
    if (real && String(row[real]).trim() !== '') return String(row[real]);
  }
  return '';
}

export function detectColumns(sampleRow = {}) {
  const headers = Object.keys(sampleRow || {});
  const mapping = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const hit = headers.find((h) => aliases.some((a) => norm(a) === norm(h)));
    mapping[field] = hit || null;
  }
  return mapping;
}

export function sheetToObjects(XLSX, workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

export function findUnifiedSheetName(sheetNames = []) {
  return sheetNames.find((n) => UNIFIED_SHEET_ALIASES.some((a) => norm(a) === norm(n)))
    || sheetNames.find((n) => /מאוחד|unified/i.test(n))
    || null;
}

/**
 * Exact-title program match only. Suggestions are informational, never auto-assigned.
 */
export function matchProgram(sourceName, programs = []) {
  const n = norm(sourceName);
  if (!n) return { status: 'pending', program_id: null, title: null, suggestions: [] };
  const exact = programs.find((p) => norm(p.title) === n || norm(p.payload?.details?.name) === n);
  if (exact) {
    return { status: 'assigned', program_id: exact.id, title: exact.title, suggestions: [] };
  }
  const suggestions = programs
    .map((p) => {
      const t = norm(p.title);
      let score = 0;
      if (t.includes(n) || n.includes(t)) score += 2;
      const tokens = n.split(' ').filter((x) => x.length > 2);
      score += tokens.filter((tok) => t.includes(tok)).length;
      return { id: p.id, title: p.title, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { status: 'pending', program_id: null, title: null, suggestions };
}

export function suggestRelated112(topic, originalQuestion = '', catalogQuestions = []) {
  const fromTopic = TOPIC_TO_112[topic] || [];
  const qn = norm(originalQuestion);
  const fromText = [];
  if (qn && catalogQuestions.length) {
    for (const q of catalogQuestions) {
      const label = norm(q.label);
      if (!label) continue;
      if (qn === label || qn.includes(label.slice(0, 40)) || label.includes(qn.slice(0, 40))) {
        fromText.push(String(q.id));
      }
    }
  }
  return [...new Set([...fromText, ...fromTopic])];
}

function mapInfoKindToType(infoKind) {
  if (/תשובה|מידע\s*\/\s*תשובה/.test(infoKind)) return 'תשובה היסטורית';
  if (/מטרה/.test(infoKind)) return 'מטרה';
  if (/סילבוס/.test(infoKind)) return 'סילבוס';
  if (/המלצ/.test(infoKind)) return 'המלצה';
  if (/ניסיון/.test(infoKind)) return 'ניסיון';
  return 'אחר';
}

function verificationForKind(infoKind) {
  if (/דורשת אימות|בחירה היסטורית/.test(infoKind)) return 'ממתין לאימות';
  if (/ללא בחירה|ללא תשובה|הפניה|הערת עבודה|אזכור מסמך/.test(infoKind)) return 'לא אומת';
  return 'ממתין לאימות';
}

export function rowToKnowledgeItem(row, {
  columnMap,
  programs = [],
  catalogQuestions = [],
  intakeAt = new Date().toISOString(),
  importBatchId = ''
} = {}) {
  const get = (field) => {
    const header = columnMap?.[field];
    if (header && row[header] != null) return String(row[header]);
    return pickCol(row, COLUMN_ALIASES[field] || []);
  };

  const content = get('content').trim();
  const id = get('id').trim();
  const programName = get('program').trim();
  const topic = get('topic').trim();
  const originalQuestion = get('original_question').trim();
  const infoKind = get('info_kind').trim();
  const sources = get('sources').trim();
  const match = matchProgram(programName, programs);
  const related = suggestRelated112(topic, originalQuestion, catalogQuestions);

  const item = createKnowledgeItem({
    id: id || undefined,
    title: originalQuestion || topic || content.slice(0, 80),
    type: mapInfoKindToType(infoKind),
    content: content || (infoKind ? `[${infoKind}]` : ''),
    source: sources || 'gefen_unified_program_knowledge',
    verification_status: verificationForKind(infoKind),
    related_questions: related,
    notes: [
      get('control_notes').trim(),
      infoKind ? `סוג מידע במקור: ${infoKind}` : '',
      match.status === 'pending' ? 'ממתין לשיוך תוכנית במערכת' : ''
    ].filter(Boolean).join('\n')
  });

  return {
    ...item,
    topic,
    original_question: originalQuestion,
    info_kind: infoKind,
    source_program_name: programName,
    source_program_names: get('source_program_names').trim(),
    basket_context: get('basket_context').trim(),
    source_question_numbers: get('source_question_numbers').trim(),
    control_notes: get('control_notes').trim(),
    source_occurrences: Number(get('occurrences') || 0) || 0,
    program_id: match.program_id,
    assignment_status: match.status === 'assigned' ? 'assigned' : 'pending_program',
    program_match_suggestions: match.suggestions,
    intake_at: intakeAt,
    import_batch_id: importBatchId,
    // Knowledge is never a 2027 final answer
    is_submission_answer: false,
    verified_for_2027: false
  };
}

/**
 * Parse workbook buffer/array into an import plan (preview + groups).
 */
export function planKnowledgeWorkbook(XLSX, data, {
  programs = [],
  catalogQuestions = [],
  existingByProgram = {},
  existingUnassigned = [],
  sheetName = null,
  importBatchId = ''
} = {}) {
  const workbook = typeof data?.SheetNames === 'object' && data.Sheets
    ? data
    : XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });

  const unified = sheetName || findUnifiedSheetName(workbook.SheetNames);
  if (!unified) {
    throw new Error('לא נמצא גיליון מאגר מאוחד');
  }
  const rows = sheetToObjects(XLSX, workbook, unified);
  if (!rows.length) throw new Error('גיליון המאגר המאוחד ריק');

  const columnMap = detectColumns(rows[0]);
  if (!columnMap.content && !columnMap.id) {
    throw new Error('לא זוהו עמודות חובה (תוכן / מזהה)');
  }

  const intakeAt = new Date().toISOString();
  const batch = importBatchId || `imp-${intakeAt.slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const items = rows.map((row) => rowToKnowledgeItem(row, {
    columnMap, programs, catalogQuestions, intakeAt, importBatchId: batch
  })).filter((i) => i.content);

  const existingIds = new Set([
    ...Object.values(existingByProgram).flat().map((x) => x.id),
    ...(existingUnassigned || []).map((x) => x.id)
  ]);

  const fresh = [];
  let duplicates = 0;
  for (const item of items) {
    if (existingIds.has(item.id)) {
      duplicates += 1;
      continue;
    }
    existingIds.add(item.id);
    fresh.push(item);
  }

  const byProgram = {};
  const unassigned = [];
  for (const item of fresh) {
    if (item.program_id) {
      (byProgram[item.program_id] ||= []).push(item);
    } else {
      unassigned.push(item);
    }
  }

  const programKeySheet = workbook.SheetNames.find((n) =>
    PROGRAM_KEY_SHEET_ALIASES.some((a) => norm(a) === norm(n))
  );
  const programKey = programKeySheet
    ? sheetToObjects(XLSX, workbook, programKeySheet)
    : [];

  return {
    sheet: unified,
    sheetNames: workbook.SheetNames,
    columnMap,
    import_batch_id: batch,
    intake_at: intakeAt,
    total_rows: rows.length,
    unique_parsed: items.length,
    to_ingest: fresh.length,
    duplicates_skipped: duplicates,
    assigned_count: fresh.length - unassigned.length,
    pending_count: unassigned.length,
    by_program: byProgram,
    unassigned,
    program_key: programKey,
    preview: fresh.slice(0, 25).map((i) => ({
      id: i.id,
      program: i.source_program_name,
      program_id: i.program_id,
      topic: i.topic,
      title: i.title,
      related_questions: i.related_questions,
      assignment_status: i.assignment_status,
      suggestions: i.program_match_suggestions
    })),
    // Program sheets are views — listed for transparency, never ingested separately
    program_view_sheets: workbook.SheetNames.filter((n) => n !== unified && !/מפתח|שאלות|תאי מקור|source/i.test(n))
  };
}

export function applyKnowledgePlan(plan, {
  programPayloads = {},
  unassignedExisting = []
} = {}) {
  const nextPrograms = {};
  for (const [programId, items] of Object.entries(plan.by_program || {})) {
    const existing = programPayloads[programId]?.knowledge_items || [];
    nextPrograms[programId] = appendKnowledgeItems(existing, items);
  }
  const nextUnassigned = appendKnowledgeItems(unassignedExisting, plan.unassigned || []);
  return { nextPrograms, nextUnassigned };
}

export function filterKnowledgeItems(items, {
  search = '',
  topic = '',
  type = '',
  verification = '',
  assignment = '',
  includeInactive = false
} = {}) {
  let list = Array.isArray(items) ? items : [];
  if (!includeInactive && assignment !== 'inactive') {
    list = list.filter((i) => i.assignment_status !== 'inactive');
  }
  if (search) {
    const q = search.trim().toLowerCase();
    list = list.filter((i) =>
      `${i.title || ''} ${i.content || ''} ${i.original_question || ''} ${i.source || ''} ${i.topic || ''}`
        .toLowerCase().includes(q)
    );
  }
  if (topic) list = list.filter((i) => i.topic === topic);
  if (type) list = list.filter((i) => i.type === type || i.info_kind === type);
  if (verification) list = list.filter((i) => i.verification_status === verification);
  if (assignment) list = list.filter((i) => i.assignment_status === assignment);
  return list;
}

/** Pending queue only — never inactive or already assigned. */
export function pendingKnowledgeItems(items) {
  return (Array.isArray(items) ? items : []).filter((i) =>
    i.assignment_status !== 'inactive' && (i.assignment_status === 'pending_program' || !i.program_id)
  );
}
