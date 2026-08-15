import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COORDINATION_STATUS,
  buildActivityDocumentSnapshot,
  coordinationStatus,
  documentDataHash,
  groupActivitiesForDispatch,
  meetingRowsForActivity,
  readinessForActivity,
  validCoordinationSchoolId
} from '../frontend/src/activity-coordination/domain.js';

function activity(overrides = {}) {
  const row = {
    row_id: 'activity-1', activity_season: 'school_2027', school_id: 7,
    activity_name: 'יזמות באנגלית English Lab', activity_no: 'P-100', gefen_number: '12345', sessions: '10',
    start_time: '08:30:00', end_time: '10:00:00', emp_id: 42, instructor_name: 'נועה לוי',
    grade: 'ח׳', class_group: 'קבוצה א׳', school: 'בית ספר לדוגמה', semel_mosad: '540001',
    contact_name: 'ישראל ישראלי', contact_role: 'רכז/ת (STEM)', contact_phone: '050-1234567',
    activity_manager: 'הילה רוזן'
  };
  for (let index = 1; index <= 10; index += 1) row[`date_${index}`] = `2026-09-${String(index + 2).padStart(2, '0')}`;
  return { ...row, ...overrides };
}

test('readiness requires every declared date, both times, contact, and the primary instructor', () => {
  assert.deepEqual(readinessForActivity(activity()), { ready: true, missing: [], sessions: 10 });
  assert.equal(readinessForActivity(activity({ date_10: null })).ready, false);
  assert.deepEqual(readinessForActivity(activity({ date_10: null })).missing, ['date_10']);
  assert.deepEqual(readinessForActivity(activity({ start_time: null })).missing, ['start_time']);
  assert.deepEqual(readinessForActivity(activity({ end_time: null })).missing, ['end_time']);
  assert.deepEqual(readinessForActivity(activity({ emp_id: null, instructor_name: '' })).missing, ['instructor']);
  assert.equal(readinessForActivity(activity({ sessions: 'abc' })).missing.includes('sessions'), true);
  assert.equal(readinessForActivity(activity({ contact_name: '', school_contact_id: null })).missing.includes('contact'), true);
  assert.equal(readinessForActivity(activity({ contact_name: '', school_contact_id: null, resolved_contact_name: 'איש קשר מהרשומה המקושרת' })).ready, true);
  assert.equal(readinessForActivity(activity({ grade: '', class_group: '' })).ready, true);
});

test('preparation is matched only by activity_no and is never a readiness requirement', () => {
  const row = activity();
  const syllabus = [
    { program_number: 'P-100', meeting_order: 1, school_preparation: null },
    { program_number: 'P-100', meeting_order: 2, school_preparation: 'מחשב עם חיבור לאינטרנט' },
    { program_number: '12345', meeting_order: 3, school_preparation: 'אסור להגיע דרך גפן' }
  ];
  const meetings = meetingRowsForActivity(row, syllabus);
  assert.equal(readinessForActivity(row).ready, true);
  assert.equal(meetings[0].school_preparation, '');
  assert.equal(meetings[1].school_preparation, 'מחשב עם חיבור לאינטרנט');
  assert.equal(meetings[2].school_preparation, '');
  assert.equal(meetings[0].hours, '08:30–10:00');
  assert.equal(meetings[0].grade_class, 'ח׳ / קבוצה א׳');
  assert.equal(meetings[0].date, '03/09/2026');
});

test('snapshot hash is stable, changes for date_3, and ignores fields outside the document', async () => {
  const base = activity();
  const context = { instructor: { mobile: '052-1112233' }, activityManager: { phone: '052-3222951' } };
  const first = buildActivityDocumentSnapshot({ activity: base, ...context });
  const reordered = buildActivityDocumentSnapshot({ activity: { notes: 'לא נכלל', ...base }, ...context });
  const unrelated = buildActivityDocumentSnapshot({ activity: { ...base, notes: 'הערה פנימית חדשה', finance_status: 'paid' }, ...context });
  const changed = buildActivityDocumentSnapshot({ activity: { ...base, date_3: '2026-10-20' }, ...context });
  assert.equal(await documentDataHash(first), await documentDataHash(reordered));
  assert.equal(await documentDataHash(first), await documentDataHash(unrelated));
  assert.notEqual(await documentDataHash(first), await documentDataHash(changed));
});

test('dispatch grouping uses season, school, and normalized recipient email', () => {
  const same = [1, 2, 3].map((id) => ({ row_id: String(id), activity_season: 'school_2027', school_id: 5, recipient_email: ' School@Example.org ' }));
  assert.equal(groupActivitiesForDispatch(same).length, 1);
  assert.equal(groupActivitiesForDispatch([...same, { ...same[0], row_id: '4', recipient_email: 'other@example.org' }]).length, 2);
});

test('status precedence uses verified sent, current draft, then readiness', () => {
  const ready = { ready: true, missing: [], sessions: 10 };
  const missing = { ready: false, missing: ['date_10'], sessions: 10 };
  assert.equal(coordinationStatus({ readiness: ready, currentHash: 'a' }), COORDINATION_STATUS.READY);
  assert.equal(coordinationStatus({ readiness: missing, currentHash: 'a' }), COORDINATION_STATUS.MISSING_DETAILS);
  assert.equal(coordinationStatus({ readiness: ready, currentHash: 'a', activeDraft: { document_data_hash: 'a' } }), COORDINATION_STATUS.DRAFT);
  assert.equal(coordinationStatus({ readiness: ready, currentHash: 'a', latestSent: { document_data_hash: 'a' } }), COORDINATION_STATUS.SENT);
  assert.equal(coordinationStatus({ readiness: ready, currentHash: 'b', latestSent: { document_data_hash: 'a' } }), COORDINATION_STATUS.CHANGED_SINCE_SENT);
  assert.equal(coordinationStatus({ readiness: ready, currentHash: 'b', latestSent: { document_data_hash: 'a' }, activeDraft: { document_data_hash: 'b' } }), COORDINATION_STATUS.DRAFT);
  assert.equal(coordinationStatus({ readiness: ready, currentHash: 'b', activeDraft: null }), COORDINATION_STATUS.READY);
});

test('coordination requires a positive bigint-compatible school id before dispatch', () => {
  assert.equal(validCoordinationSchoolId(7), true);
  assert.equal(validCoordinationSchoolId('7'), true);
  assert.equal(validCoordinationSchoolId(''), false);
  assert.equal(validCoordinationSchoolId(0), false);
  assert.equal(validCoordinationSchoolId('school-7'), false);
});
