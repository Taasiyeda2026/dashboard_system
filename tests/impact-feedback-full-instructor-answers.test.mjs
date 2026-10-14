import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupInstructorFullResponses } from '../frontend/src/impact-feedback/feedback-domain.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');

function reply(responseId, course, extras = {}) {
  return {
    audience: 'instructor', stage: 'pre', program_key: course,
    response_id: responseId, campaign_id: 'campaign-' + course,
    instructor_name: 'מדריכה א', question_id: 'rating', question_text: 'עד כמה הרגשת מוכנות?',
    question_type: 'rating_1_5', sort_order: 1, value_number: 5, submitted_at: '2026-10-14T10:00:00Z',
    ...extras
  };
}

test('all answers stay attributed to the exact instructor, course, submitted form and question', () => {
  const assignments = [
    { instructor_emp_id: '100', instructor_name: 'מדריכה א', pre_campaign: { id: 'campaign-pharma' } },
    { instructor_emp_id: '100', instructor_name: 'מדריכה א', pre_campaign: { id: 'campaign-space_tech' } },
    { instructor_emp_id: '101', instructor_name: 'מדריכה א', pre_campaign: { id: 'other-campaign' } }
  ];
  const facts = [
    reply('r1', 'pharma', { question_id: 'free', question_text: 'מה כדאי לשנות?', question_type: 'free_text',
      sort_order: 3, value_number: null, value_text: 'דרך נוספת:\nطريق جديد' }),
    reply('r1', 'pharma'),
    reply('r2', 'space_tech', { question_type: 'single_select', value_number: null,
      value_options: ['zoom'], question_options: [{ value: 'zoom', label: 'הכשרה בזום' }] }),
    reply('r3', 'pharma', { campaign_id: 'other-campaign', instructor_name: 'מדריכה א', question_id: 'last' }),
    reply('r4', 'pharma', { audience: 'student', campaign_id: 'student-campaign' }),
    reply('r5', 'pharma', { stage: 'final', campaign_id: 'other-campaign' })
  ];
  const result = groupInstructorFullResponses(facts, { assignments, stage: 'pre' });
  assert.deepEqual(result.map((p) => p.employeeId), ['100', '101'], 'identical names with different employee IDs remain distinct');
  assert.equal(result[0].courses.length, 2);
  const pharma = result[0].courses.find((c) => c.programKey === 'pharma');
  assert.equal(pharma.responses.length, 1);
  assert.deepEqual(pharma.responses[0].answers.map((a) => a.question_id), ['rating', 'free']);
  assert.equal(pharma.responses[0].answers[1].value_text, 'דרך נוספת:\nطريق جديد', 'open answer is preserved exactly');
  const selected = groupInstructorFullResponses(facts, {
    stage: 'pre', programKey: 'pharma', instructorKey: 'employee:101', assignments
  });
  assert.deepEqual(selected.map((p) => p.employeeId), ['101']);
  assert.equal(selected[0].courses[0].responses.length, 1);
});

test('anonymous name fallback does not discard an instructor form when assignment lookup is unavailable', () => {
  const result = groupInstructorFullResponses([reply('one', 'trailblazers', { campaign_id: 'orphan' })], { stage: 'pre' });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'מדריכה א');
  assert.equal(result[0].courses[0].responses[0].answers.length, 1);
});

test('analysis tab renders full instructor submissions and keeps the per-course and per-instructor filters', () => {
  assert.match(screen, /analysis: \{ audience: 'instructor', stage: 'pre', instructor: '' \}/);
  assert.match(screen, /function instructorFullResponsesHtml\(\)/);
  assert.match(screen, /groupInstructorFullResponses\(semesterFacts\(\)/);
  assert.match(screen, /data-a="instructor"/);
  assert.match(screen, /sectionHtml\('כל התשובות של המדריכים — לפי מדריך וקורס', instructorFullResponsesHtml\(\)/);
  assert.match(screen, /completeInstructorAnswerValueHtml\(fact\)/);
  assert.match(screen, /esc\(fact\.question_text \|\| 'שאלה'\)/);
  assert.match(screen, /esc\(String\(fact\.value_text \?\? ''\)\)/);
  assert.match(styles, /\.ifb-admin \.ifb-full-answer-raw \{ white-space: pre-wrap;/);
});
