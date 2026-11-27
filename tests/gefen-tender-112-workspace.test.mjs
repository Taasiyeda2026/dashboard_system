import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTERS_112, BASKET_112, enrichQuestion112, mergeQuestionsPreservingAnswers,
  countWords, withinWordLimit, displayAnswerValue, association112
} from '../frontend/src/gefen-tender/questionnaire-112.js';
import {
  appendHistoricalAnswers, createHistoricalAnswer, historicalForQuestion,
  parseHistoricalImport
} from '../frontend/src/gefen-tender/historical-answers.js';
import { readiness112, programReadinessRows112 } from '../frontend/src/gefen-tender/readiness.js';
import { buildSubmissionAnswers, ensureAssociationQuestions } from '../frontend/src/gefen-tender/questionnaires.js';
import { buildContextPacket, CHATGPT_SYSTEM_PROMPT_112 } from '../frontend/src/gefen-tender/context-packet.js';
import { approveAnswer, isFinalAnswer } from '../frontend/src/gefen-tender/final-answers.js';
import { DEFAULT_TEMPLATE_MAPS, templateMeta } from '../frontend/src/gefen-tender/excel-templates.js';
import { thresholdsPayload } from '../frontend/src/gefen-tender/thresholds-112.js';

test('112 chapters cover 1-41 without gaps or overlap', () => {
  const covered = new Set();
  for (const ch of CHAPTERS_112) {
    for (let n = ch.from; n <= ch.to; n += 1) {
      assert.equal(covered.has(n), false, `overlap at ${n}`);
      covered.add(n);
    }
  }
  assert.equal(covered.size, 41);
  assert.equal(Math.min(...covered), 1);
  assert.equal(Math.max(...covered), 41);
});

test('enrichQuestion112 detects yes/no+text and word limits without inventing wording', () => {
  const q = enrichQuestion112({
    id: '112.2',
    number: 2,
    label: 'שאלה לדוגמה',
    requirements: 'כן/לא + טקסט עד 70 מילים'
  });
  assert.equal(q.answer_type, 'yes_no_text');
  assert.equal(q.limit_words, 70);
  assert.equal(q.mapping_verified, false);
  assert.equal(q.label, 'שאלה לדוגמה');
});

test('mergeQuestionsPreservingAnswers keeps drafts by stable id', () => {
  const catalog = [
    { id: '112.1', number: 1, label: 'נוסח מעודכן' },
    { id: '112.2', number: 2, label: 'שתיים' }
  ];
  const existing = [
    { id: '112.1', number: 1, label: 'נוסח ישן', answer: 'טיוטה שמורה', answer_extra: 'המשך' }
  ];
  const merged = mergeQuestionsPreservingAnswers(catalog, existing);
  assert.equal(merged[0].label, 'נוסח מעודכן');
  assert.equal(merged[0].answer, 'טיוטה שמורה');
  assert.equal(merged[0].answer_extra, 'המשך');
  assert.equal(merged[1].answer, '');
});

test('word limit helper', () => {
  assert.equal(countWords('אחת שתיים שלוש'), 3);
  assert.equal(withinWordLimit('אחת שתיים שלוש', 3), true);
  assert.equal(withinWordLimit('אחת שתיים שלוש ארבע', 3), false);
});

test('historical answers append without touching finals', () => {
  const a = createHistoricalAnswer({
    question_id: '112.6',
    tender_year: '2025',
    answer: 'תשובה ישנה',
    original_question: 'שאלה'
  });
  const merged = appendHistoricalAnswers([], [a, { ...a, answer: 'ניסיון דריסה' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].answer, 'תשובה ישנה');
  assert.equal(historicalForQuestion(merged, '112.6').length, 1);
  const parsed = parseHistoricalImport(JSON.stringify({ answers: [{
    question_id: '112.1', answer: 'היסטורית', tender_year: '2024'
  }] }));
  assert.equal(parsed.length, 1);
});

test('readiness112 reports missing neutrally and never auto-passes thresholds', () => {
  const questions = Array.from({ length: 41 }, (_, i) => ({
    id: `112.${i + 1}`,
    number: i + 1,
    label: `שאלה ${i + 1}`,
    answer: i === 0 ? 'טיוטה' : ''
  }));
  const row = {
    id: 'fixture-p',
    kind: 'program',
    title: 'תוכנית בדיקה',
    payload: {
      associations: [{ code: BASKET_112, status: 'להגיש', questions, mapping_verified: false }],
      final_answers: {},
      knowledge_items: []
    }
  };
  const r = readiness112(row, 0);
  assert.equal(r.applicable, true);
  assert.equal(r.total, 41);
  assert.equal(r.missing, 40);
  assert.equal(r.drafts, 1);
  assert.equal(r.approved, 0);
  assert.equal(r.statuses.threshold, 'טרם נבדק');
  assert.notEqual(r.work_state, 'מוכנה להגשה אוטומטית');
  const rows = programReadinessRows112([
    { kind: 'administrative', payload: { sections: {} } },
    row
  ]);
  assert.equal(rows.length, 1);
});

test('buildSubmissionAnswers enriches 112 answer types', () => {
  const row = {
    id: 'p',
    title: 'בדיקה',
    payload: {
      details: { name: 'בדיקה' },
      associations: [{
        code: 112,
        status: 'חדשה',
        questions: [
          { id: '112.2', number: 2, label: 'כן לא', requirements: 'כן/לא + טקסט', answer: 'כן', answer_extra: 'פירוט' }
        ]
      }]
    }
  };
  const a = ensureAssociationQuestions(row.payload.associations[0]);
  assert.equal(a.questions[0].answer_type, 'yes_no_text');
  const answers = buildSubmissionAnswers(row);
  const q = answers.find((x) => x.question_id === '112.2');
  assert.equal(displayAnswerValue(a.questions[0]), 'כן — פירוט');
  assert.equal(q.value, 'כן — פירוט');
  assert.equal(q.answer_type, 'yes_no_text');
});

test('ChatGPT 112 prompt forbids inventing data', () => {
  assert.match(CHATGPT_SYSTEM_PROMPT_112, /אין להמציא מידע/);
  assert.match(CHATGPT_SYSTEM_PROMPT_112, /תת סל 112/);
  const row = {
    id: 'p-1',
    title: 'תוכנית',
    revision: 1,
    payload: {
      number: 1,
      associations: [{
        code: 112,
        questions: [{ id: '112.1', number: 1, label: 'שאלה אחת', answer: '' }]
      }],
      historical_answers: [createHistoricalAnswer({
        question_id: '112.1', answer: 'ישנה', tender_year: '2025'
      })]
    }
  };
  const answer = buildSubmissionAnswers(row).find((a) => a.question_id === '112.1');
  const packet = buildContextPacket(row, answer, []);
  assert.match(packet, /תשובות היסטוריות/);
  assert.match(packet, /ישנה/);
  assert.match(packet, /append_historical/);
});

test('excel template maps exist for 159/160/174 without forged binaries', () => {
  assert.ok(DEFAULT_TEMPLATE_MAPS[159].columns.name);
  assert.ok(DEFAULT_TEMPLATE_MAPS[160]);
  assert.ok(DEFAULT_TEMPLATE_MAPS[174]);
  const meta = templateMeta(159, {});
  assert.equal(meta.mapping_verified, false);
  assert.equal(meta.uploaded_at, null);
});

test('thresholds registry preserves prior status notes', () => {
  const list = thresholdsPayload([
    { id: 'th-112-track', status: 'נבדק', notes: 'אומת ידנית' }
  ]);
  const track = list.find((x) => x.id === 'th-112-track');
  assert.equal(track.status, 'נבדק');
  assert.equal(track.notes, 'אומת ידנית');
  assert.ok(list.length >= 8);
});

test('approved 112 answer uses display value for final match', () => {
  const key = 'association.0.0';
  const value = 'כן — פירוט';
  const finals = approveAnswer({}, key, value);
  assert.equal(isFinalAnswer(finals, key, value), true);
  assert.equal(isFinalAnswer(finals, key, 'כן'), false);
});

test('association112 finds basket index', () => {
  assert.equal(association112({ associations: [{ code: 106 }, { code: 112 }] }).index, 1);
  assert.equal(association112({ associations: [{ code: 106 }] }).index, -1);
});
