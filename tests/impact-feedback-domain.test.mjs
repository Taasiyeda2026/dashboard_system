import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAW_EXPORT_HEADERS,
  ageBandFromGrade,
  buildCsv,
  campaignUiStatus,
  comparePrePost,
  dashboardKpis,
  describeGroupChange,
  factNumericValue,
  filterGroups,
  missingRequired,
  normalizeWhatsappPhone,
  perspectiveGap,
  publicFeedbackUrl,
  rawExportRows,
  shareMessage,
  shareSubject,
  threePerspectives
} from '../frontend/src/impact-feedback/feedback-domain.js';

const NOW = Date.parse('2026-11-01T10:00:00Z');
const METRICS = [
  { key: 'knowledge', label: 'ידע והבנה', kind: 'impact' },
  { key: 'self_efficacy', label: 'מסוגלות וביטחון', kind: 'impact' },
  { key: 'content', label: 'איכות התוכן', kind: 'program' }
];

function fact(response, audience, stage, metric, value, extra = {}) {
  return {
    response_id: response, audience, stage, metric_key: metric, question_id: `${metric}-q`, question_text: metric,
    question_type: 'rating_1_5', value_number: value, is_comparison: true, scoring: { include_in_score: true }, ...extra
  };
}

test('age band parsing mirrors the SQL helper', () => {
  assert.equal(ageBandFromGrade("ח'"), 'g_i');
  assert.equal(ageBandFromGrade('ז-ח'), 'g_i');
  assert.equal(ageBandFromGrade('כיתה י"א'), 'j_l');
  assert.equal(ageBandFromGrade('ב׳'), 'a_c');
  assert.equal(ageBandFromGrade('5'), 'd_f');
  assert.equal(ageBandFromGrade('שכבה ו'), 'd_f');
  assert.equal(ageBandFromGrade(''), null);
});

test('campaign UI statuses cover every lifecycle state in Hebrew', () => {
  assert.equal(campaignUiStatus(null, NOW).label, 'טרם נפתח');
  const base = { audience: 'student', status: 'active', opens_at: '2026-10-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', responses: 0 };
  assert.equal(campaignUiStatus(base, NOW).label, 'פעיל');
  assert.deepEqual(
    [campaignUiStatus({ ...base, responses: 7 }, NOW).label, campaignUiStatus({ ...base, responses: 7 }, NOW).responses],
    ['פעיל', 7]
  );
  assert.deepEqual(
    [campaignUiStatus({ ...base, opens_at: '2026-11-05T00:00:00Z' }, NOW).key, campaignUiStatus({ ...base, opens_at: '2026-11-05T00:00:00Z' }, NOW).label],
    ['scheduled', 'מתוזמן']
  );
  assert.equal(campaignUiStatus({ ...base, expires_at: '2026-10-20T00:00:00Z' }, NOW).label, 'פג תוקף');
  assert.equal(campaignUiStatus({ ...base, status: 'closed' }, NOW).label, 'נסגר');
  const pendingPersonal = { ...base, audience: 'instructor', recipient: { status: 'pending' } };
  assert.equal(campaignUiStatus(pendingPersonal, NOW).label, 'ממתין למילוי');
  const personal = { ...base, audience: 'instructor', recipient: { status: 'completed' }, responses: 1 };
  assert.equal(campaignUiStatus(personal, NOW).label, 'הושלם');
});

test('KPIs count live campaigns, pending personal links and response rate', () => {
  const live = { status: 'active', opens_at: '2026-10-01T00:00:00Z', expires_at: null };
  const groups = [
    { campaigns: [
      { ...live, audience: 'student', stage: 'pre', responses: 12 },
      { ...live, audience: 'instructor', stage: 'final', recipient: { status: 'pending' } },
      { ...live, audience: 'educational_staff', stage: 'final', recipient: { status: 'completed' } }
    ] },
    { campaigns: [{ ...live, audience: 'student', stage: 'post', responses: 3 }] },
    { campaigns: [] }
  ];
  const k = dashboardKpis(groups, NOW);
  assert.deepEqual(
    [k.withFeedback, k.activePre, k.activePost, k.pendingInstructor, k.pendingContact, k.responseRate, k.studentResponses],
    [2, 1, 1, 1, 0, 50, 15]
  );
  assert.equal(filterGroups([{ school: 'אלון', campaigns: [] }, { school: 'אורן', campaigns: [] }], { search: 'אלו' }).length, 1);
});

test('PRE/POST is group vs group, only on comparison questions, with Δ and Δ%', () => {
  const pre = [fact('a', 'student', 'pre', 'knowledge', 3), fact('b', 'student', 'pre', 'knowledge', 3.2)];
  const post = [
    fact('c', 'student', 'post', 'knowledge', 4), fact('d', 'student', 'post', 'knowledge', 4),
    fact('c', 'student', 'post', 'knowledge', 1, { is_comparison: false, question_id: 'post-only' })
  ];
  const result = comparePrePost(pre, post, METRICS.filter((m) => m.kind === 'impact'));
  const row = result.rows.find((r) => r.metric_key === 'knowledge');
  assert.deepEqual([row.preAvg, row.postAvg, row.delta, row.deltaPct, row.nPre, row.nPost], [3.1, 4, 0.9, 29, 2, 2]);
  assert.equal(describeGroupChange(3.1, 4), 'ממוצע הקבוצה עלה מ-3.1 ל-4.0');
  assert.match(describeGroupChange(null, 4), /אין נתוני פתיחה/);
  assert.match(describeGroupChange(3, null), /טרם התקבלו נתוני סיום/);
});

test('three perspectives stay separate and instructor opening/final are not blended', () => {
  const facts = [
    fact('s1', 'student', 'post', 'knowledge', 5),
    fact('t1', 'educational_staff', 'final', 'knowledge', 3),
    fact('ipre', 'instructor', 'pre', 'content', 2),
    fact('ifinal', 'instructor', 'final', 'content', 4)
  ];
  const p = threePerspectives(facts, METRICS);
  assert.equal(p.students.post.byMetric.knowledge.score, 100);
  assert.equal(p.staff.byMetric.knowledge.score, 50);
  assert.equal(p.instructorPre.byMetric.content.score, 25);
  assert.equal(p.instructorFinal.byMetric.content.score, 75);
  assert.equal(p.instructor.byMetric.content.score, 75, 'legacy instructor perspective means final only');
  assert.equal(p.instructor.byMetric.knowledge, undefined, 'no cross-population blending');
  assert.equal(perspectiveGap([100, 50]).key, 'gap');
  assert.equal(perspectiveGap([80, 85, 78]).key, 'aligned');
  assert.equal(perspectiveGap([80]), null);
});

test('scoring rules: yes/no maps via scoring, excluded questions are ignored', () => {
  assert.equal(factNumericValue({ question_type: 'yes_no', value_bool: true, scoring: { include_in_score: true, yes: 5, no: 1 } }), 5);
  assert.equal(factNumericValue({ question_type: 'yes_no', value_bool: false, scoring: { include_in_score: true, yes: 5, no: 1 } }), 1);
  assert.equal(factNumericValue({ question_type: 'rating_1_5', value_number: 4, scoring: { include_in_score: false } }), null);
  assert.equal(factNumericValue({ question_type: 'multi_select', value_options: ['x'], scoring: {} }), null);
});

test('public links, WhatsApp numbers, required validation', () => {
  assert.equal(publicFeedbackUrl('TOKEN_abc', 'https://taasiyeda2026.github.io/dashboard_system/index.html?route=x'), 'https://taasiyeda2026.github.io/dashboard_system/feedback.html?t=TOKEN_abc');
  assert.equal(publicFeedbackUrl('T', 'https://host/dashboard_system/'), 'https://host/dashboard_system/feedback.html?t=T');
  assert.equal(normalizeWhatsappPhone('050-123-4567'), '972501234567');
  assert.equal(normalizeWhatsappPhone('+972 50 1234567'), '972501234567');
  const questions = [{ id: 'a', type: 'rating_1_5', required: true }, { id: 'b', type: 'free_text', required: false }, { id: 'c', type: 'multi_select', required: true }];
  assert.deepEqual(missingRequired(questions, { a: 3, c: [] }), ['c']);
});

test('instructor share copy distinguishes opening after training from end-of-course', () => {
  const pre = shareMessage({ audience: 'instructor', stage: 'pre', recipientName: 'דנה', programTitle: 'פורצות דרך', url: 'https://x.test/pre' });
  const final = shareMessage({ audience: 'instructor', stage: 'final', recipientName: 'דנה', programTitle: 'פורצות דרך', url: 'https://x.test/final' });
  assert.match(pre, /אחרי ההכשרה/);
  assert.match(pre, /משוב פתיחה/);
  assert.match(final, /לאחר סיום ההדרכה/);
  assert.match(final, /משוב סיום/);
  assert.match(shareSubject('instructor', 'פורצות דרך', 'pre'), /פתיחה/);
  assert.match(shareSubject('instructor', 'פורצות דרך', 'final'), /סיום/);
});

test('raw export never names students and maps option labels', () => {
  const rows = rawExportRows([
    { ...fact('s', 'student', 'pre', 'knowledge', 4), respondent_name: 'should-not-appear' },
    { response_id: 'i', audience: 'instructor', stage: 'final', metric_key: 'content', question_type: 'single_select', value_options: ['balanced'], question_options: [{ value: 'balanced', label: 'מאוזן' }], respondent_name: 'דנה לוי' }
  ], { metrics: METRICS });
  const nameIndex = RAW_EXPORT_HEADERS.indexOf('שם הממלא/ת');
  assert.equal(rows[0][nameIndex], '');
  assert.equal(rows[1][nameIndex], 'דנה לוי');
  assert.equal(rows[1].at(-1), 'מאוזן');
  const csv = buildCsv(['a', 'b'], [['x,y', 'q"t']]);
  assert.equal(csv, '﻿a,b\r\n"x,y","q""t"');
});

test('unresolved programs stay visible; excluded groups only under their own filter', async () => {
  const { isProgramUnresolved, PROGRAM_SOURCE_LABELS } = await import('../frontend/src/impact-feedback/feedback-domain.js');
  const groups = [
    { row_id: 'a', program_key: 'ofek', campaigns: [] },
    { row_id: 'b', program_key: null, campaigns: [] },
    { row_id: 'c', program_key: null, feedback_excluded: true, campaigns: [] }
  ];
  assert.deepEqual(filterGroups(groups, {}).map((g) => g.row_id), ['a', 'b']);
  assert.deepEqual(filterGroups(groups, { status: 'unresolved' }).map((g) => g.row_id), ['b']);
  assert.deepEqual(filterGroups(groups, { status: 'excluded' }).map((g) => g.row_id), ['c']);
  assert.equal(isProgramUnresolved(groups[1]), true);
  assert.equal(isProgramUnresolved(groups[2]), false);
  assert.equal(dashboardKpis(groups, NOW).unresolved, 1);
  assert.equal(PROGRAM_SOURCE_LABELS.manual_name, 'נבחרה ידנית לפי שם הפעילות');
  assert.equal(PROGRAM_SOURCE_LABELS.activity_no, 'זוהתה לפי מספר תוכנית');
});
