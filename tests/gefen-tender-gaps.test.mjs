import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFactualKnowledgeItem, knowledgeContentRole
} from '../frontend/src/gefen-tender/knowledge.js';
import {
  relevantKnowledge, scoreKnowledgeRelevance, buildContextPacket
} from '../frontend/src/gefen-tender/context-packet.js';
import { applyCatalog112, catalog112Meta } from '../frontend/src/gefen-tender/catalog-112.js';
import { recommendationsFolderUrl, RECOMMENDATION_FOLDER_BY_PROGRAM } from '../frontend/src/gefen-tender/constants.js';
import { buildSubmissionAnswers } from '../frontend/src/gefen-tender/questionnaires.js';
import { fillTemplateWorkbook, templateMeta } from '../frontend/src/gefen-tender/excel-templates.js';
import * as XLSX from 'xlsx';

test('non-factual knowledge kinds are excluded from ChatGPT factual packet', () => {
  assert.equal(knowledgeContentRole({ info_kind: 'אפשרויות בחירה – ללא בחירה' }), 'choice_blank');
  assert.equal(isFactualKnowledgeItem({ info_kind: 'אפשרויות בחירה – ללא בחירה', content: 'כן / לא' }), false);
  assert.equal(isFactualKnowledgeItem({ info_kind: 'מידע / תשובה קיימת', content: 'מטרה' }), true);

  const answer = { question_id: '112.13', key: 'association.0.12', label: 'מטרות המענה/התוכנית.', chapter_label: 'תוכן ופדגוגיה', number: 13 };
  const items = [
    { id: '1', content: 'מטרות רפואה', topic: 'מטרות', info_kind: 'מידע / תשובה קיימת', related_questions: ['112.13'], verification_status: 'ממתין לאימות' },
    { id: '2', content: 'כן / לא', topic: 'דיגיטל', info_kind: 'אפשרויות בחירה – ללא בחירה', related_questions: ['112.13'] },
    { id: '3', content: 'הערה פנימית', topic: 'מטרות', info_kind: 'הערת עבודה / הנחיה', related_questions: ['112.13'] },
    { id: '4', content: 'רקע כללי', topic: 'אחר', info_kind: 'מידע / תשובה קיימת', related_questions: [], verification_status: 'לא אומת' }
  ];
  const pack = relevantKnowledge(items, answer, { id: 'p-53819', revision: 3 });
  assert.equal(pack.linked_to_question.length, 1);
  assert.equal(pack.linked_to_question[0].id, '1');
  assert.equal(pack.non_factual_excluded, 2);
  assert.equal(pack.full_program_knowledge_access.record_id, 'p-53819');
  assert.ok(scoreKnowledgeRelevance(items[0], answer) > scoreKnowledgeRelevance(items[3], answer));
});

test('catalog-112 applies types and word limit without inventing labels or char limits', () => {
  const existing = [
    { id: '112.20', number: 20, label: 'רקע תיאורטי ואמפירי (עד 70 מילים)', answer: 'טיוטה', requirements: 'עד 70 מילים' },
    { id: '112.2', number: 2, label: 'הלימה ליעדים', answer: 'כן', answer_extra: 'פירוט' }
  ];
  const merged = applyCatalog112(existing);
  assert.equal(merged[0].label, existing[0].label);
  assert.equal(merged[0].answer, 'טיוטה');
  assert.equal(merged[0].limit_words, 70);
  assert.equal(merged[0].limit, 500);
  assert.equal(merged[1].answer_type, 'yes_no_text');
  assert.equal(merged[1].answer_extra, 'פירוט');
  assert.match(catalog112Meta().character_limits_status, /תבנית הגשה|33/);
});

test('fifteen recommendation folders mapped', () => {
  assert.equal(Object.keys(RECOMMENDATION_FOLDER_BY_PROGRAM).length, 15);
  const url = recommendationsFolderUrl('p-6089');
  assert.match(url, /05%20-%20/);
  assert.match(decodeURIComponent(url), /ביומימיקרי \(יסודי\)/);
});

test('excel template fill preserves sheet and writes no invented rows when empty', () => {
  const wb0 = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['שם', 'תחום'], ['כותרת', 'כותרת2']]);
  XLSX.utils.book_append_sheet(wb0, ws, 'גיליון1');
  const buf = XLSX.write(wb0, { type: 'array', bookType: 'xlsx' });
  const filled = fillTemplateWorkbook(XLSX, buf, templateMeta(159).mapping, []);
  assert.ok(filled.Sheets['גיליון1']);
  assert.equal(filled.Sheets['גיליון1'].A1.v, 'שם');
});

test('context packet separates verified and excludes non-factual', () => {
  const row = {
    id: 'p-53819', title: 'יישומי AI ברפואה ובחקלאות', revision: 9,
    payload: {
      number: 53819,
      associations: [{ code: 112, questions: [
        { id: '112.13', number: 13, label: 'מטרות המענה/התוכנית.', answer: '', answer_type: 'text' }
      ] }],
      knowledge_items: [
        { id: 'a', content: 'יישום ברפואה', info_kind: 'מידע / תשובה קיימת', related_questions: ['112.13'], verification_status: 'אומת' },
        { id: 'b', content: 'כן / לא', info_kind: 'אפשרויות בחירה – ללא בחירה', related_questions: ['112.13'] }
      ]
    }
  };
  const answer = buildSubmissionAnswers(row).find((x) => x.question_id === '112.13');
  const packet = buildContextPacket(row, answer, []);
  assert.match(packet, /יישום ברפואה/);
  assert.doesNotMatch(packet, /כן \/ לא/);
  assert.match(packet, /record_id=p-53819/);
  assert.match(packet, /full_program_knowledge_access|knowledge_items/);
});
