import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_STAGE_GROUPS,
  aiFactsForSelection,
  buildAiPackage
} from '../frontend/src/impact-feedback/feedback-ai-package.js';

function fact({ id, audience, stage, response, question, value, school = 'בית ספר לדוגמה', type = 'rating_1_5' }) {
  return {
    program_key: 'biomimicry', academic_year: 'school_2027',
    campaign_id: 'secret-campaign-id', response_id: response,
    audience, stage, question_id: question,
    question_key: question, question_type: type,
    question_text: 'שאלת מדגם ' + question,
    value_number: type === 'rating_1_5' ? value : null,
    value_text: type === 'free_text' ? value : null,
    value_options: [], value_bool: null,
    respondent_name: 'שם אישי שלא צריך לעבור',
    instructor_name: 'שם מדריך אישי',
    submitted_at: '2026-10-20T09:00:00Z',
    school_name: school, activity_row_id: 'school-id-42',
    metric_key: 'interest', is_comparison: true,
    section: 'core', sort_order: 10
  };
}

const facts = [
  fact({ id: 1, audience: 'student', stage: 'pre', response: 'stud-1', question: 'shared', value: 3 }),
  fact({ id: 2, audience: 'student', stage: 'pre', response: 'stud-2', question: 'shared', value: 5 }),
  fact({ id: 3, audience: 'student', stage: 'post', response: 'stud-3', question: 'shared', value: 4 }),
  fact({ id: 4, audience: 'educational_staff', stage: 'pre', response: 'staff-1', question: 'staff-pre', value: 4 }),
  fact({ id: 5, audience: 'instructor', stage: 'pre', response: 'instr-1', question: 'instr-pre', value: 2 }),
  fact({ id: 6, audience: 'instructor', stage: 'final_b', response: 'instr-2', question: 'instr-final', value: 5 })
];

function report(selected) {
  return buildAiPackage({
    facts, selected, title: 'ביומימיקרי יסודי',
    academicYear: 'school_2027', half: 'מחצית א׳',
    metrics: [], programs: [{ key: 'biomimicry', title: 'ביומימיקרי יסודי' }]
  });
}

test('stage selector defines seven individually selectable slots', () => {
  assert.equal(AI_STAGE_GROUPS.reduce((sum, group) => sum + group.stages.length, 0), 7);
  assert.equal(aiFactsForSelection(facts, ['student:pre']).length, 2);
  assert.equal(aiFactsForSelection(facts, ['instructor:final']).length, 1);
  assert.equal(aiFactsForSelection(facts, ['educational_staff:mid']).length, 0);
});

test('workbook exports one selected course, only chosen populations, and evidence counts', () => {
  const out = report(['student:pre', 'educational_staff:pre']);
  const names = out.sheets.map((s) => s.name);
  assert.deepEqual(names, ['הנחיות AI', 'בסיס הניתוח', 'צוות חינוכי', 'תלמידים',
    'השוואות', 'תשובות פתוחות', 'נתוני מקור']);
  const basis = out.sheets.find((s) => s.name === 'בסיס הניתוח');
  assert.deepEqual(basis.rows.map((r) => r[2]), [1, 2]);
  const student = out.sheets.find((s) => s.name === 'תלמידים');
  assert.equal(student.rows[0][4], 2);
  assert.equal(student.rows[0][6], 4);
  const rawText = JSON.stringify(out.sheets.find((s) => s.name === 'נתוני מקור'));
  assert.ok(!rawText.includes('שם אישי שלא צריך לעבור'));
  assert.ok(!rawText.includes('שם מדריך אישי'));
  assert.ok(!rawText.includes('secret-campaign-id'));
  assert.ok(!rawText.includes('בית ספר לדוגמה'));
  assert.ok(rawText.includes('בית ספר 1'));
});

test('comparison only includes selected stages and both stage-specific Ns', () => {
  const out = report(['student:pre', 'student:post']);
  const rows = out.sheets.find((s) => s.name === 'השוואות').rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0][5], 2);
  assert.equal(rows[0][7], 1);
  assert.equal(rows[0][9], 'ניתן להשוואה');
});

test('mid-stage selected before collection remains explicitly empty', () => {
  const out = report(['educational_staff:mid']);
  const row = out.stageOverview[0];
  assert.equal(row[2], 0);
  assert.equal(row[6], 'טרם התקבלו משובים');
  assert.equal(out.sheets.find((s) => s.name === 'צוות חינוכי').rows[0][4], 0);
});

test('empty selection is never silently exported', () => {
  assert.throws(() => report([]), /יש לבחור/);
});
