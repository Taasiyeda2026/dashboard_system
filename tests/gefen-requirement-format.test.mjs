import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFieldFormatRequirement,
  professionalRequirementText
} from '../frontend/src/gefen-tender/questionnaire-112.js';
import {
  inferAgeStageFromGrades,
  normalizeSyllabusSessions
} from '../frontend/src/gefen-tender/program-records.js';

test('field-format requirements are distinguished from professional requirements', () => {
  assert.equal(isFieldFormatRequirement('טקסט'), true);
  assert.equal(isFieldFormatRequirement('כן/לא + טקסט נוסף'), true);
  assert.equal(isFieldFormatRequirement('בחירת אפיק'), false);
  assert.equal(professionalRequirementText({ requirements: 'טקסט' }).kind, 'format_only');
  assert.equal(professionalRequirementText({ requirements: 'בחירת אפיק' }).kind, 'professional');
  assert.equal(professionalRequirementText({}).kind, 'missing');
});

test('syllabus sessions preserve ranges, duration and source metadata', () => {
  assert.equal(inferAgeStageFromGrades('ד׳–ו׳'), 'יסודי');
  assert.equal(inferAgeStageFromGrades('ז׳–ט׳'), 'חטיבה');
  const rows = normalizeSyllabusSessions([
    {
      id: 'syl-1',
      meeting_from: 8,
      meeting_to: 9,
      meeting_label: '8–9',
      topic: 'פיתוח',
      content: 'תיאור משותף',
      age_stage: 'יסודי',
      duration_minutes: 90,
      source: 'תוכניות למכרז(1).pdf',
      source_page: 2,
      source_group_id: 'p2-m8-9'
    }
  ]);
  assert.equal(rows[0].meeting_from, 8);
  assert.equal(rows[0].meeting_to, 9);
  assert.equal(rows[0].meeting_label, '8–9');
  assert.equal(rows[0].duration_minutes, 90);
  assert.equal(rows[0].source_page, 2);
});
