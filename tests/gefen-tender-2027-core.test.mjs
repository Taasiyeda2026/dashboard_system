import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveAnswer, isFinalAnswer, reconcileFinalAnswers, revokeAnswer
} from '../frontend/src/gefen-tender/final-answers.js';
import { appendKnowledgeItems, createKnowledgeItem, knowledgeFromCatalog } from '../frontend/src/gefen-tender/knowledge.js';
import { buildSubmissionAnswers, ensureAssociationQuestions, newProgramQuestions } from '../frontend/src/gefen-tender/questionnaires.js';
import { buildContextPacket, CHATGPT_SYSTEM_PROMPT } from '../frontend/src/gefen-tender/context-packet.js';
import { associationReadiness } from '../frontend/src/gefen-tender/readiness.js';
import { exportOfficialFormPackage } from '../frontend/src/gefen-tender/excel-forms.js';
import * as XLSX from 'xlsx';

test('new program questionnaire uses stable verified ids', () => {
  const qs = newProgramQuestions();
  assert.ok(qs.length >= 16);
  assert.equal(qs[0].id, 'new.name');
  assert.equal(qs.every((q) => q.mapping_verified === true), true);
  assert.ok(qs.find((q) => q.field_key === 'summary')?.limit === 1000);
});

test('basket associations stay unmapped without inventing questions', () => {
  const a = ensureAssociationQuestions({ code: 112, status: 'להגיש' });
  assert.equal(a.mapping_verified, false);
  assert.equal(a.questions.length, 0);
  assert.match(a.mapping_note, /112/);
});

test('approved answer is cleared on edit and not revived by restoring old text', () => {
  let finals = approveAnswer({}, 'details.summary', 'טקסט מאושר');
  assert.equal(isFinalAnswer(finals, 'details.summary', 'טקסט מאושר'), true);

  const afterEdit = reconcileFinalAnswers(finals, new Map([['details.summary', 'טקסט שונה']]));
  assert.equal(Object.keys(afterEdit).length, 0);
  assert.equal(isFinalAnswer(afterEdit, 'details.summary', 'טקסט מאושר'), false);

  // Restoring the old wording without a new approve must not resurrect approval
  const restored = reconcileFinalAnswers(afterEdit, new Map([['details.summary', 'טקסט מאושר']]));
  assert.equal(Object.keys(restored).length, 0);

  finals = approveAnswer({}, 'details.summary', 'טקסט מאושר');
  finals = revokeAnswer(finals, 'details.summary');
  assert.equal(isFinalAnswer(finals, 'details.summary', 'טקסט מאושר'), false);
});

test('legacy string approvals upgrade to tokens and still clear on mismatch', () => {
  const legacy = { 'details.goal': 'ישן' };
  const kept = reconcileFinalAnswers(legacy, new Map([['details.goal', 'ישן']]));
  assert.equal(typeof kept['details.goal'].token, 'string');
  assert.equal(kept['details.goal'].legacy, false);
  const cleared = reconcileFinalAnswers(legacy, new Map([['details.goal', 'חדש']]));
  assert.equal(Object.keys(cleared).length, 0);
});

test('knowledge items append without deleting previous content', () => {
  const first = createKnowledgeItem({ content: 'עובדה א', type: 'עובדה' });
  const second = createKnowledgeItem({ content: 'עובדה ב', type: 'עובדה' });
  const merged = appendKnowledgeItems([first], [second, { ...first, content: 'ניסיון דריסה' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].content, 'עובדה א');
  assert.equal(merged[1].content, 'עובדה ב');
});

test('catalog import creates pending verification knowledge items', () => {
  const items = knowledgeFromCatalog({
    short_description: 'תיאור',
    goals: 'מטרות',
    program_flow: 'מבנה'
  });
  assert.ok(items.length >= 3);
  assert.equal(items.every((i) => i.verification_status === 'ממתין לאימות'), true);
  assert.equal(items.every((i) => i.source === 'catalog_program_details'), true);
});

test('submission answers include new program fields and unmapped basket placeholder', () => {
  const row = {
    id: 'p-1',
    title: 'בדיקה',
    payload: {
      number: 1,
      details: { name: 'בדיקה', summary: 'תקציר' },
      associations: [{ code: 112, status: 'חדשה' }],
      syllabus: ''
    }
  };
  const answers = buildSubmissionAnswers(row);
  assert.ok(answers.some((a) => a.key === 'details.summary' && a.value === 'תקציר'));
  assert.ok(answers.some((a) => a.unmapped === true && a.code === 112));
});

test('ChatGPT context packet includes mandatory prompt and live identifiers', () => {
  const row = {
    id: 'p-9545',
    title: 'סודות הבינה',
    revision: 3,
    payload: {
      number: 9545,
      details: { name: 'סודות הבינה', summary: 'תקציר' },
      associations: [{ code: 112, status: 'בתוקף' }],
      knowledge_items: [{ id: 'k1', type: 'עובדה', content: 'הופעלה ב־10 בתי ספר', verification_status: 'אומת' }],
      drive_folder_url: 'https://drive.google.com/drive/folders/abc'
    }
  };
  const answer = buildSubmissionAnswers(row).find((a) => a.key === 'details.summary');
  const packet = buildContextPacket(row, answer, []);
  assert.match(packet, /גפ״ן 2027/);
  assert.match(packet, /אין להמציא מידע/);
  assert.match(packet, /record_id=p-9545/);
  assert.match(packet, /revision=3/);
  assert.match(packet, /הופעלה ב־10 בתי ספר/);
  assert.match(packet, /drive\.google\.com/);
  assert.ok(CHATGPT_SYSTEM_PROMPT.includes('תעשיידע'));
});

test('readiness never treats progress percent as threshold approval', () => {
  const row = {
    id: 'p-1',
    title: 'בדיקה',
    payload: {
      details: { name: 'בדיקה' },
      associations: [{ code: 112, status: 'להגיש', mapping_verified: false }],
      final_answers: {}
    }
  };
  const ready = associationReadiness(row, 0, 19);
  assert.equal(ready.ready_for_submission, false);
  assert.ok(ready.issues.some((i) => i.code === 'mapping'));
  assert.equal(typeof ready.progress_pct, 'number');
});

test('official form package exports 159/160/174 sheets and STEM when needed', async () => {
  const program = {
    id: 'p-1',
    title: 'STEM Demo',
    revision: 1,
    payload: {
      number: 1,
      associations: [{ code: 706, status: 'להגיש' }],
      developer_ids: ['o-1'],
      operator_ids: ['o-2'],
      syllabus: 'מפגש 1\nמפגש 2'
    }
  };
  const people = [
    { id: 'o-1', kind: 'operator', title: 'מפתח א', payload: { experience: 'פיתוח' } },
    { id: 'o-2', kind: 'operator', title: 'מפעיל ב', payload: { experience: 'הדרכה' } }
  ];
  const { wb, stamp } = await exportOfficialFormPackage(XLSX, program, people, { approvedOnly: false });
  assert.equal(stamp, 'טיוטה');
  assert.ok(wb.SheetNames.includes('159 מפתחים'));
  assert.ok(wb.SheetNames.includes('160 מפעילים'));
  assert.ok(wb.SheetNames.includes('174 תוכנית למידה'));
  assert.ok(wb.SheetNames.includes('151 STEM'));
});
