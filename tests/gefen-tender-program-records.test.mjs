import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExperienceRecords, emptyExperienceRecord,
  normalizeRecommendationRecords, emptyRecommendationRecord,
  normalizeSyllabusSessions, emptySyllabusSession, reorderSyllabusSessions,
  historicalAsKnowledgeItems,
  experienceFilled, recommendationsFilled, syllabusFilled, documentsFilled
} from '../frontend/src/gefen-tender/program-records.js';

test('experience records normalize and detect filled state', () => {
  assert.deepEqual(normalizeExperienceRecords(null), []);
  const row = emptyExperienceRecord();
  assert.ok(row.id);
  assert.equal(experienceFilled({ experience_records: [{ organization: 'עמותה', activity: 'סדנה' }] }), true);
  assert.equal(experienceFilled({ experience: 'ישן' }), true);
  assert.equal(experienceFilled({}), false);
});

test('recommendation and syllabus helpers preserve structure', () => {
  const rec = emptyRecommendationRecord();
  assert.equal(rec.status, 'טיוטה');
  assert.equal(recommendationsFilled({ recommendation_records: [rec] }), false);
  assert.equal(recommendationsFilled({ recommendations_documents: [{ url: 'https://x' }] }), true);

  const a = emptySyllabusSession('יסודי', 1);
  const b = emptySyllabusSession('יסודי', 2);
  a.topic = 'פתיחה';
  const ordered = reorderSyllabusSessions([a, b], a.id, 'down');
  assert.equal(ordered[0].id, b.id);
  assert.equal(ordered[0].meeting_number, 1);
  assert.equal(syllabusFilled({ syllabus_sessions: [{ topic: 'נושא' }] }), true);
  assert.equal(documentsFilled({ documents: [{ url: 'https://x' }] }), true);
});

test('historical answers project into knowledge items without inventing content', () => {
  const items = historicalAsKnowledgeItems([
    { id: 'h1', answer: 'תשובה קודמת', original_question: 'שאלה', tender_year: '2025', question_id: '112.1' },
    { id: 'h2', answer: '   ' }
  ], 'prog-1');
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'היסטורי');
  assert.equal(items[0]._historical, true);
  assert.match(items[0].verification_status, /אינו מאושר/);
  assert.equal(items[0].content, 'תשובה קודמת');
  assert.equal(normalizeSyllabusSessions([{ topic: 'x' }])[0].age_stage, 'כללי');
});
