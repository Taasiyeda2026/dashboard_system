import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audienceMetricScores,
  comparePrePost,
  comparePrePostByQuestion,
  courseCollection,
  courseLabel,
  crossCourseCore,
  overviewTotals,
  questionExportRows,
  questionStats,
  strengthsAndGaps
} from '../frontend/src/impact-feedback/feedback-domain.js';

function answer(response, value, extra = {}) {
  return {
    response_id: response, audience: 'student', stage: 'post', program_key: 'pharma', question_id: 'q1', question_key: 'q1',
    question_text: 'שאלה', metric_key: 'knowledge', section: 'core', sort_order: 10, question_type: 'rating_1_5',
    value_number: value, value_options: null, is_comparison: true, scoring: { include_in_score: true }, ...extra
  };
}

test('course averages pool every valid answer instead of averaging group averages', () => {
  // Group A: 1 student answering 5; group B: 3 students answering 1 → pooled 2.0, mean of means would be 3.0.
  const facts = [
    answer('a1', 5, { activity_row_id: 'A' }),
    answer('b1', 1, { activity_row_id: 'B' }), answer('b2', 1, { activity_row_id: 'B' }), answer('b3', 1, { activity_row_id: 'B' })
  ];
  const [q] = questionStats(facts);
  assert.deepEqual([q.avg, q.valid, q.n, q.dist], [2, 4, 4, [3, 0, 0, 0, 1]]);
});

test('N/A answers are counted separately and never enter the mean', () => {
  const facts = [answer('r1', 4), answer('r2', null, { value_options: ['na'] }), answer('r3', 2)];
  const [q] = questionStats(facts);
  assert.deepEqual([q.avg, q.valid, q.na], [3, 2, 1]);
});

test('per-question PRE/POST uses identical questions only and flags changed wording', () => {
  const pre = [answer('p1', 2, { stage: 'pre' }), answer('p2', 3, { stage: 'pre' }), answer('p1', 4, { stage: 'pre', question_id: 'pre-only' })];
  const post = [answer('o1', 4), answer('o2', 5), answer('o1', 3, { question_id: 'q2', question_text: 'אחר' })];
  const result = comparePrePostByQuestion(pre, post);
  assert.equal(result.rows.length, 1, 'only the question asked in both stages is compared');
  assert.deepEqual([result.rows[0].preAvg, result.rows[0].postAvg, result.rows[0].delta, result.rows[0].comparable], [2.5, 4.5, 2, true]);
  assert.deepEqual([result.nPre, result.nPost], [2, 2]);
  const reworded = comparePrePostByQuestion(pre, [answer('o1', 4, { question_text: 'ניסוח חדש' })]);
  assert.deepEqual([reworded.rows[0].comparable, reworded.rows[0].delta], [false, null], 'changed wording is not presented as change');
});

test('metric-level PRE/POST is built from the same question set in both stages', () => {
  const pre = [answer('p1', 2, { stage: 'pre' })];
  const post = [answer('o1', 4), answer('o1', 1, { question_id: 'post-only-comparison' })];
  const row = comparePrePost(pre, post, [{ key: 'knowledge', label: 'ידע' }]).rows[0];
  assert.deepEqual([row.preAvg, row.postAvg], [2, 4], 'a comparison question asked only at POST does not shift the POST mean');
});

test('collection figures: no unique count for anonymous students, unique people for instructors', () => {
  const rows = [
    { program_key: 'pharma', audience: 'student', stage: 'pre', campaigns: 2, groups: 2, responses: 30, participants_total: 40, participants_campaigns: 1, responses_with_participants: 18 },
    { program_key: 'pharma', audience: 'student', stage: 'post', campaigns: 1, groups: 1, responses: 12, participants_total: 0, participants_campaigns: 0, responses_with_participants: 0 },
    { program_key: 'pharma', audience: 'student', stage: 'all', campaigns: 3, responses: 42, unique_respondents: null },
    { program_key: 'pharma', audience: 'instructor', stage: 'pre', campaigns: 2, responses: 2, invited: 2, completed: 2 },
    { program_key: 'pharma', audience: 'instructor', stage: 'final', campaigns: 2, responses: 1, invited: 2, completed: 1 },
    { program_key: 'pharma', audience: 'instructor', stage: 'all', campaigns: 4, responses: 3, unique_respondents: 2, unidentified_responses: 0 },
    { program_key: 'ofek', audience: 'educational_staff', stage: 'final', campaigns: 3, responses: 2, invited: 3, completed: 2 },
    { program_key: 'ofek', audience: 'educational_staff', stage: 'all', campaigns: 3, responses: 2, unique_respondents: 1, unidentified_responses: 0 }
  ];
  const students = courseCollection(rows, 'pharma', 'student');
  assert.equal(students.uniqueRespondents, null);
  assert.equal(students.responses, 42);
  assert.deepEqual([students.byStage.pre.responseRate, students.byStage.pre.rateCoverage], [45, '1/2'], 'rate only over groups with a participants count');
  assert.equal(students.byStage.post.responseRate, null, 'no participants count → no response rate');
  const instructors = courseCollection(rows, 'pharma', 'instructor');
  assert.deepEqual([instructors.responses, instructors.uniqueRespondents, instructors.byStage.final.responseRate], [3, 2, 50]);
  const totals = overviewTotals(rows);
  assert.deepEqual([totals.courses, totals.responses, totals.identifiedRespondents], [2, 47, 3]);
  assert.deepEqual(totals.byAudience, { student: 42, instructor: 3, educational_staff: 2 });
  assert.deepEqual(totals.byPhase, { pre: 32, end: 15 });
  assert.equal(overviewTotals(rows, { phase: 'pre' }).identifiedRespondents, null, 'unique people are not split by phase');
  assert.equal(overviewTotals(rows, { programKey: 'ofek' }).responses, 2);
});

test('courses with look-alike titles get distinct labels', () => {
  const programs = [
    { key: 'biomimicry', title: 'ביומימיקרי', education_level: 'elementary', gefen_numbers: ['6089'] },
    { key: 'biomimicry_secondary', title: 'ביומימיקרי', education_level: 'secondary', gefen_numbers: ['53828'] },
    { key: 'ai_applications', title: 'יישומי AI', education_level: 'secondary', gefen_numbers: ['53819'] },
    { key: 'ai_foundations', title: 'סודות ויסודות AI', education_level: 'secondary', gefen_numbers: ['9545'] }
  ];
  assert.equal(courseLabel(programs[0], programs), 'ביומימיקרי (יסודי · 6089)');
  assert.equal(courseLabel(programs[1], programs), 'ביומימיקרי (חטיבה · 53828)');
  assert.equal(courseLabel(programs[2], programs), 'יישומי AI');
});

test('populations are scored side by side and never merged', () => {
  const facts = [
    answer('s1', 5), answer('s2', 5), answer('s3', 5),
    answer('t1', 2, { audience: 'educational_staff', stage: 'final' }),
    answer('i1', 3, { audience: 'instructor', stage: 'pre' })
  ];
  const [row] = audienceMetricScores(facts, [{ key: 'knowledge', label: 'ידע', kind: 'impact' }], { minN: 1 });
  assert.equal(row.cells.student.score, 100);
  assert.equal(row.cells.educational_staff.score, 25);
  assert.equal(row.cells.instructor, null, 'instructor opening is not mixed into the end-of-course perspective');
  assert.equal(row.gap.key, 'gap');
  const [guarded] = audienceMetricScores(facts, [{ key: 'knowledge', label: 'ידע', kind: 'impact' }], { minN: 3 });
  assert.equal(guarded.gap, null, 'no gap claim when one population is below the minimum N');
});

test('cross-course comparison uses shared core questions and keeps courses separate', () => {
  const facts = [
    answer('a', 4, { program_key: 'pharma' }), answer('b', 2, { program_key: 'pharma' }),
    answer('c', 5, { program_key: 'ofek' }),
    answer('d', 1, { program_key: 'ofek', section: 'course', question_id: 'ofek-only' })
  ];
  const { programKeys, rows } = crossCourseCore(facts, { audience: 'student', stage: 'post' });
  assert.deepEqual(programKeys, ['ofek', 'pharma']);
  assert.equal(rows.length, 1, 'course-specific questions are not part of the cross-course core');
  assert.deepEqual(rows[0].byProgram, { ofek: { avg: 5, n: 1 }, pharma: { avg: 3, n: 2 } });
});

test('strengths and gaps require a minimum number of valid answers', () => {
  const stats = [
    { question_id: 'a', question_type: 'rating_1_5', valid: 10, avg: 4.6 },
    { question_id: 'b', question_type: 'rating_1_5', valid: 10, avg: 2.1 },
    { question_id: 'c', question_type: 'rating_1_5', valid: 2, avg: 1.0 },
    { question_id: 'd', question_type: 'free_text', valid: 0, avg: null }
  ];
  const { strengths, gaps, eligible } = strengthsAndGaps(stats, { minN: 5, count: 1 });
  assert.deepEqual([strengths[0].question_id, gaps[0].question_id, eligible], ['a', 'b', 2]);
  const flat = strengthsAndGaps([
    { question_id: 'x', question_type: 'rating_1_5', valid: 9, avg: 3 },
    { question_id: 'y', question_type: 'rating_1_5', valid: 9, avg: 3 }
  ], { minN: 5 });
  assert.deepEqual([flat.strengths.length, flat.gaps.length, flat.flat], [0, 0, true], 'equal means are not presented as strengths or gaps');
});

test('question export lists every course/audience/stage separately with distribution', () => {
  const rows = questionExportRows([answer('a', 4), answer('b', 5), answer('c', 3, { program_key: 'ofek' })], {
    programs: [{ key: 'pharma', title: 'רוקחים עולם' }, { key: 'ofek', title: 'אופק פרימיום' }],
    metrics: [{ key: 'knowledge', label: 'ידע והבנה' }]
  });
  assert.equal(rows.length, 2);
  const pharma = rows.find((r) => r[0] === 'רוקחים עולם');
  assert.deepEqual(pharma.slice(7, 15), [2, '', 4.5, 0, 0, 0, 1, 1]);
});


test('cross-course comparison hides core questions seen in only one course', () => {
  const facts = [
    answer('r1', 5, { program_key: 'pharma', question_id: 'pharma-only', question_text: 'ייחודי לקורס' }),
    answer('r2', 4, { program_key: 'pharma', question_id: 'shared', question_text: 'משותפת' }),
    answer('r3', 3, { program_key: 'ofek', question_id: 'shared', question_text: 'משותפת' }),
    answer('r4', 1, { program_key: 'ofek', question_id: 'ofek-only', section: 'course' })
  ];
  const actual = crossCourseCore(facts, { audience: 'student', stage: 'post' });
  assert.deepEqual(actual.programKeys, ['ofek', 'pharma']);
  assert.deepEqual(actual.rows.map((r) => r.question_id), ['shared']);
  assert.deepEqual(crossCourseCore([facts[0]], { audience: 'student', stage: 'post' }), { programKeys: [], rows: [] });
});
