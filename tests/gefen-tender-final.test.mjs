import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCatalog112, CHAR_LIMITS_112, EXTRA_TEXT_LIMIT_QUESTIONS, catalog112Meta
} from '../frontend/src/gefen-tender/catalog-112.js';
import {
  limitAppliesToExtra, limitedAnswerText, enrichQuestion112
} from '../frontend/src/gefen-tender/questionnaire-112.js';
import {
  RECOMMENDATION_FOLDER_BY_PROGRAM, recommendationsFolderUrl
} from '../frontend/src/gefen-tender/constants.js';
import { relevantKnowledge, buildContextPacket } from '../frontend/src/gefen-tender/context-packet.js';
import { buildSubmissionAnswers } from '../frontend/src/gefen-tender/questionnaires.js';
import { withinLimit } from '../frontend/src/gefen-tender/final-answers.js';

test('catalog preserves stored limits and applies template limits for extra-text questions', () => {
  const existing = [
    { id: '112.2', number: 2, label: 'הלימה', answer: 'כן', answer_extra: 'פירוט', limit: 250, extra_text: true, answer_type: 'yes_no_text', choices: ['כן', 'לא'] },
    { id: '112.20', number: 20, label: 'רקע תיאורטי', answer: 'טיוטה', limit: 500, limit_words: 70 },
    { id: '112.1', number: 1, label: 'אפיק', answer: 'יזמות טכנולוגית', answer_type: 'single_choice' }
  ];
  const merged = applyCatalog112(existing);
  assert.equal(merged[0].limit, 250);
  assert.equal(merged[0].limit_applies_to, 'extra');
  assert.equal(merged[0].answer, 'כן');
  assert.equal(merged[0].label, 'הלימה');
  assert.equal(merged[1].limit, 500);
  assert.equal(merged[1].limit_words, 70);
  assert.equal(merged[2].limit, null);
  assert.equal(CHAR_LIMITS_112[2], 250);
  assert.equal(EXTRA_TEXT_LIMIT_QUESTIONS.has(31), true);
  assert.match(catalog112Meta().character_limits_status, /תבנית הגשה/);
});

test('character limit enforcement uses complementary text for yes_no_text', () => {
  const q = enrichQuestion112({
    id: '112.2', number: 2, label: 'הלימה', answer: 'כן', answer_extra: 'א'.repeat(251),
    limit: 250, extra_text: true, answer_type: 'yes_no_text', choices: ['כן', 'לא']
  });
  assert.equal(limitAppliesToExtra(q), true);
  assert.equal(limitedAnswerText(q).length, 251);
  assert.equal(withinLimit(limitedAnswerText(q), q.limit), false);
  assert.equal(withinLimit('כן', q.limit), true);
});

test('recommendation folders match SharePoint names exactly (15)', () => {
  assert.equal(Object.keys(RECOMMENDATION_FOLDER_BY_PROGRAM).length, 15);
  assert.equal(RECOMMENDATION_FOLDER_BY_PROGRAM['p-6089'], 'ביומימיקרי (יסודי)');
  assert.equal(RECOMMENDATION_FOLDER_BY_PROGRAM['p-960'], 'פרימיום');
  assert.equal(RECOMMENDATION_FOLDER_BY_PROGRAM['p-27342'], 'משחקי קופסה');
  assert.equal(RECOMMENDATION_FOLDER_BY_PROGRAM['p-new-microbit'], 'micro-bit');
  assert.equal(RECOMMENDATION_FOLDER_BY_PROGRAM['p-new-photonics'], 'פוטוניקה');
  assert.equal(RECOMMENDATION_FOLDER_BY_PROGRAM['p-52279'], undefined);
  const url = recommendationsFolderUrl('p-9545');
  assert.match(url, /05%20-%20/);
  assert.match(decodeURIComponent(url), /בינה מלאכותית/);
});

test('context packet reports limit applies to extra and omits non-factual', () => {
  const row = {
    id: 'p-53819', title: 'יישומי AI ברפואה ובחקלאות', revision: 12,
    payload: {
      number: 53819,
      associations: [{
        code: 112,
        questions: [{
          id: '112.2', number: 2, label: 'הלימה ליעדים', answer: 'כן', answer_extra: 'פירוט קצר',
          answer_type: 'yes_no_text', extra_text: true, limit: 250, limit_applies_to: 'extra',
          choices: ['כן', 'לא'], requirements: 'כן/לא + טקסט'
        }]
      }],
      knowledge_items: [
        { id: 'a', content: 'עובדה', info_kind: 'מידע / תשובה קיימת', related_questions: ['112.2'], verification_status: 'אומת' },
        { id: 'b', content: 'כן / לא', info_kind: 'אפשרויות בחירה – ללא בחירה', related_questions: ['112.2'] }
      ]
    }
  };
  const answer = buildSubmissionAnswers(row).find((x) => x.question_id === '112.2');
  const pack = relevantKnowledge(row.payload.knowledge_items, answer, row);
  assert.equal(pack.linked_to_question.length, 1);
  assert.equal(pack.non_factual_excluded, 1);
  const packet = buildContextPacket(row, answer, []);
  assert.match(packet, /limit_applies_to/);
  assert.match(packet, /record_id=p-53819/);
  assert.doesNotMatch(packet, /כן \/ לא/);
});
