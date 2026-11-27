import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import {
  detectColumns, matchProgram, planKnowledgeWorkbook, suggestRelated112,
  filterKnowledgeItems, findUnifiedSheetName
} from '../frontend/src/gefen-tender/knowledge-import.js';
import { appendKnowledgeItems, assignKnowledgeToProgram } from '../frontend/src/gefen-tender/knowledge.js';
import { buildContextPacket, CHATGPT_SYSTEM_PROMPT_112 } from '../frontend/src/gefen-tender/context-packet.js';
import { buildSubmissionAnswers } from '../frontend/src/gefen-tender/questionnaires.js';

const FIXTURE = '/home/ubuntu/.cursor/projects/agent-repos-dashboard-system/uploads/gefen_unified_program_knowledge_42f0.xlsx';

test('detects unified sheet and required columns', () => {
  const wb = XLSX.read(readFileSync(FIXTURE), { type: 'buffer' });
  assert.equal(findUnifiedSheetName(wb.SheetNames), 'מאגר מאוחד');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['מאגר מאוחד'], { defval: '' });
  const map = detectColumns(rows[0]);
  assert.equal(map.id, 'מזהה פריט');
  assert.equal(map.content, 'תוכן מקורי');
  assert.equal(map.program, 'תוכנית');
});

test('exact program match only; biomimicry variants stay pending', () => {
  const programs = [
    { id: 'p-52279', title: 'אופק לתעשייה', payload: {} },
    { id: 'p-53828', title: 'ביומימיקרי - לחטיבות', payload: {} },
    { id: 'p-6089', title: 'יזמות ביומימיקרי (יסודי)', payload: {} },
    { id: 'p-9545', title: 'סודות (ויסודות) הבינה המלאכותית', payload: {} }
  ];
  assert.equal(matchProgram('אופק לתעשייה', programs).status, 'assigned');
  assert.equal(matchProgram('אופק לתעשייה', programs).program_id, 'p-52279');
  assert.equal(matchProgram('ביומימיקרי', programs).status, 'pending');
  assert.equal(matchProgram('יזמות ביומימיקרי - טכנולוגיה בהשראת הטבע', programs).status, 'pending');
  assert.equal(matchProgram('יסודות הבינה המלאכותית ויישומיה בתעשייה', programs).status, 'pending');
});

test('topic suggests related 112 questions without requiring them', () => {
  const ids = suggestRelated112('מטרות', 'מטרות המענה/התוכנית.', [
    { id: '112.13', label: 'מטרות המענה/התוכנית.' }
  ]);
  assert.ok(ids.includes('112.13'));
});

test('planKnowledgeWorkbook ingests unified sheet once and dedupes by id', () => {
  const programs = [
    { id: 'p-52279', title: 'אופק לתעשייה', payload: { knowledge_items: [] } }
  ];
  const plan = planKnowledgeWorkbook(XLSX, readFileSync(FIXTURE), { programs });
  assert.equal(plan.total_rows, 296);
  assert.equal(plan.unique_parsed, 296);
  assert.equal(plan.to_ingest, 296);
  assert.equal(plan.assigned_count, 76);
  assert.equal(plan.pending_count, 220);
  assert.equal(plan.by_program['p-52279'].length, 76);
  assert.ok(plan.program_view_sheets.includes('ביומימיקרי'));

  const again = planKnowledgeWorkbook(XLSX, readFileSync(FIXTURE), {
    programs,
    existingByProgram: { 'p-52279': plan.by_program['p-52279'] },
    existingUnassigned: plan.unassigned
  });
  assert.equal(again.to_ingest, 0);
  assert.equal(again.duplicates_skipped, 296);
});

test('append and assign preserve ids without deleting prior knowledge', () => {
  const a = { id: 'H-1', content: 'א', program_id: null, assignment_status: 'pending_program' };
  const b = { id: 'H-2', content: 'ב', program_id: 'p-1', assignment_status: 'assigned' };
  const merged = appendKnowledgeItems([a], [b, { ...a, content: 'דריסה' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].content, 'א');
  const moved = assignKnowledgeToProgram([a], [], 'H-1', 'p-9');
  assert.equal(moved.unassigned.length, 0);
  assert.equal(moved.programItems[0].program_id, 'p-9');
});

test('ChatGPT packet includes program knowledge and forbids treating it as final', () => {
  assert.match(CHATGPT_SYSTEM_PROMPT_112, /מאגר הידע הוא בסיס לניסוח בלבד/);
  const row = {
    id: 'p-52279',
    title: 'אופק לתעשייה',
    revision: 1,
    payload: {
      number: 52279,
      associations: [{
        code: 112,
        questions: [{ id: '112.13', number: 13, label: 'מטרות המענה/התוכנית.', answer: '' }]
      }],
      knowledge_items: [{
        id: 'H-demo',
        type: 'תשובה היסטורית',
        topic: 'מטרות',
        original_question: 'מטרות המענה/התוכנית.',
        content: 'תוכן היסטורי לבדיקה',
        related_questions: ['112.13'],
        verification_status: 'ממתין לאימות'
      }]
    }
  };
  const answer = buildSubmissionAnswers(row).find((a) => a.question_id === '112.13');
  const packet = buildContextPacket(row, answer, []);
  assert.match(packet, /מאגר ידע מצטבר/);
  assert.match(packet, /תוכן היסטורי לבדיקה/);
  assert.match(packet, /אינו תשובה מאושרת/);
});

test('filterKnowledgeItems filters by topic and search', () => {
  const list = [
    { id: '1', topic: 'מטרות', content: 'א', title: 'א', type: 'עובדה', verification_status: 'לא אומת' },
    { id: '2', topic: 'סילבוס', content: 'ב', title: 'ב', type: 'עובדה', verification_status: 'אומת' }
  ];
  assert.equal(filterKnowledgeItems(list, { topic: 'מטרות' }).length, 1);
  assert.equal(filterKnowledgeItems(list, { search: 'סילב' }).length, 1);
});
