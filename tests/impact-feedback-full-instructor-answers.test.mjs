import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupInstructorFullResponses, groupEducationalStaffFullResponses, groupStudentFullResponses } from '../frontend/src/impact-feedback/feedback-domain.js';

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
  assert.match(screen, /analysis: \{ audience: 'instructor', stage: 'pre', instructor: '', contact: '', group: '' \}/);
  assert.match(screen, /function instructorFullResponsesHtml\(\)/);
  assert.match(screen, /groupInstructorFullResponses\(semesterFacts\(\)/);
  assert.match(screen, /data-a="instructor"/);
  assert.match(screen, /sectionHtml\('כל התשובות של המדריכים — לפי מדריך וקורס', instructorFullResponsesHtml\(\)/);
  assert.match(screen, /completeInstructorAnswerValueHtml\(fact\)/);
  assert.match(screen, /esc\(fact\.question_text \|\| 'שאלה'\)/);
  assert.match(screen, /esc\(String\(fact\.value_text \?\? ''\)\)/);
  assert.match(styles, /\.ifb-admin \.ifb-full-answer-raw \{ white-space: pre-wrap;/);
});

test('educational staff answers are grouped by contact, school and course, preserving every answer', () => {
  const facts = [
    reply('a', 'pharma', { audience: 'educational_staff', school_name: 'בית ספר אלף',
      respondent_name: 'רות', campaign_id: 'staff-one', question_id: 'q2',
      question_type: 'free_text', value_number: null, value_text: 'חשוב לשפר\nطريقة التدريب', sort_order: 2 }),
    reply('a', 'pharma', { audience: 'educational_staff', school_name: 'בית ספר אלף',
      respondent_name: 'רות', campaign_id: 'staff-one', question_id: 'q1', sort_order: 1 }),
    reply('b', 'ofek', { audience: 'educational_staff', school_name: 'בית ספר אלף',
      respondent_name: 'רות', campaign_id: 'staff-two' }),
    reply('c', 'pharma', { audience: 'educational_staff', school_name: 'בית ספר בית',
      respondent_name: 'רות', campaign_id: 'staff-three' }),
    reply('d', 'pharma', { audience: 'student', school_name: 'בית ספר אלף' }),
    reply('e', 'pharma', { audience: 'educational_staff', stage: 'final', school_name: 'בית ספר אלף',
      respondent_name: 'רות' })
  ];
  const grouped = groupEducationalStaffFullResponses(facts, { stage: 'pre' });
  assert.equal(grouped.length, 2, 'identical contact names in different schools are not joined');
  const schoolA = grouped.find((p) => p.schoolName === 'בית ספר אלף');
  assert.deepEqual(schoolA.courses.map((c) => c.programKey), ['ofek','pharma']);
  assert.deepEqual(schoolA.courses.find((c) => c.programKey === 'pharma').responses[0].answers.map((a) => a.question_id), ['q1','q2']);
  assert.equal(schoolA.courses.find((c) => c.programKey === 'pharma').responses[0].answers[1].value_text,
    'חשוב לשפר\nطريقة التدريب');
  const filtered = groupEducationalStaffFullResponses(facts, { stage: 'pre',
    contactKey: schoolA.key, programKey: 'pharma' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].courses.length, 1);
});

test('anonymous student forms are grouped by course and school group, never by person', () => {
  const facts = [
    reply('one', 'pharma', { audience: 'student', stage: 'pre', activity_row_id: 'school-1',
      school_name: 'בית ספר אלף', grade: 'ח', question_id: 'q2',
      value_text: 'תשובה אישית', question_type: 'free_text', value_number: null, sort_order: 2,
      respondent_name: 'DO NOT SHOW', instructor_name: 'DO NOT SHOW' }),
    reply('one', 'pharma', { audience: 'student', stage: 'pre', activity_row_id: 'school-1',
      school_name: 'בית ספר אלף', question_id: 'q1', sort_order: 1 }),
    reply('two', 'pharma', { audience: 'student', stage: 'pre', activity_row_id: 'school-1',
      school_name: 'בית ספר אלף' }),
    reply('three', 'pharma', { audience: 'student', stage: 'pre', activity_row_id: 'school-2',
      school_name: 'בית ספר אלף', grade: 'ט' }),
    reply('four', 'ofek', { audience: 'student', stage: 'pre', activity_row_id: 'school-3',
      school_name: 'בית ספר בית' }),
    reply('five', 'pharma', { audience: 'instructor' })
  ];
  const courses = groupStudentFullResponses(facts, { stage: 'pre' });
  assert.deepEqual(courses.map((c) => c.programKey), ['ofek', 'pharma']);
  const groups = courses.find((c) => c.programKey === 'pharma').groups;
  assert.equal(groups.length, 2, 'two different activity row IDs stay separate even at one school');
  assert.equal(groups.find((g) => g.key === 'group:school-1').responses.length, 2);
  assert.deepEqual(groups.find((g) => g.key === 'group:school-1').responses[0].answers.map((a) => a.question_id),
    ['q1','q2']);
  assert.equal('respondentName' in groups[0], false);
  assert.equal('instructorName' in groups[0], false);
  assert.equal(groupStudentFullResponses(facts, { stage: 'pre', groupKey: 'group:school-2' })[0].groups.length, 1);
  assert.equal(groupStudentFullResponses(facts, { stage: 'post' }).length, 0);
});

test('all three audience views expose raw saved answers and selectors without identifying students', () => {
  assert.match(screen, /groupEducationalStaffFullResponses\(semesterFacts\(\)/);
  assert.match(screen, /groupStudentFullResponses\(semesterFacts\(\)/);
  assert.match(screen, /data-a="contact"/);
  assert.match(screen, /data-a="group"/);
  assert.match(screen, /sectionHtml\('כל התשובות של הצוות החינוכי — לפי איש קשר וקורס', staffFullResponsesHtml\(\)/);
  assert.match(screen, /sectionHtml\('כל תשובות התלמידים — לפי קורס ובית ספר', studentFullResponsesHtml\(\)/);
  assert.match(screen, /שאלון אנונימי /);
  assert.match(screen, /completeInstructorAnswerValueHtml\(fact\)/);
  assert.match(screen, /if \(key === 'audience'\) ui\.analysis\.stage = \(AUDIENCE_STAGES\[el\.value\] \|\| \['pre'\]\)\[0\]/);
});
