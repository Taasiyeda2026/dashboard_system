import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONLINE_REPORT_TYPE,
  TRAINING_REPORT_TYPE,
  OPERATIONS_REPORT_TYPE,
  NO_ACTIVITY_NAME_REPORT_TYPES,
  OPEN_FIELD_REPORT_TYPES,
  filterActivitiesForReportType,
  activityMatchesReportType,
  instructorActivitySelectOptions,
  instructorActivityOptionLabel,
  deriveAuthoritySchoolListFromActivities,
  normalizeDbActivityType,
  getDbTypesForReportType,
  HEBREW_ACTIVITY_TYPES,
} from '../attendance/src/services/activities-report.helpers.js';

const sampleActivities = [
  { row_id: 'c1', activity_name: 'רובוטיקה', activity_type: 'course', authority_id: 1, authority_name: 'אשכול', single_school_id: 101, single_school_name: 'שמש גבולות' },
  { row_id: 'c2', activity_name: 'AI', activity_type: 'course', authority_id: 1, authority_name: 'אשכול', single_school_id: 102, single_school_name: 'הרצל' },
  { row_id: 'c3', activity_name: 'AI', activity_type: 'course', authority_id: 2, authority_name: 'דרום', single_school_id: 201, single_school_name: 'נגב' },
  { row_id: 'w1', activity_name: 'סדנת קסם', activity_type: 'workshop', authority_id: 3, authority_name: 'מרכז', single_school_id: 301, single_school_name: 'נוער' },
  { row_id: 'w2', activity_name: 'גיטרה', activity_type: 'workshop', authority_id: 3, authority_name: 'מרכז', single_school_id: 301, single_school_name: 'נוער' },
  { row_id: 'w3', activity_name: 'ציור', activity_type: 'workshop', authority_id: 4, authority_name: 'צפון', single_school_id: 401, single_school_name: 'גליל' },
  { row_id: 'w4', activity_name: 'קיץ', activity_type: 'workshop', authority_id: 4, authority_name: 'צפון', single_school_id: 401, single_school_name: 'גליל' },
  { row_id: 't1', activity_name: 'סיור מדע', activity_type: 'tour', authority_id: 5, authority_name: 'עיר', single_school_id: 501, single_school_name: 'טכנולוגי' },
  { row_id: 'e1', activity_name: 'בריחה', activity_type: 'escape_room', authority_id: 5, authority_name: 'עיר', single_school_id: 501, single_school_name: 'טכנולוגי' },
];

test('HEBREW_ACTIVITY_TYPES includes מקוון in alphabetical order', () => {
  assert.ok(HEBREW_ACTIVITY_TYPES.includes('מקוון'));
  const idxOnline = HEBREW_ACTIVITY_TYPES.indexOf('מקוון');
  const idxWorkshop = HEBREW_ACTIVITY_TYPES.indexOf('סדנה');
  assert.ok(idxOnline < idxWorkshop);
});

test('report type filters use canonical DB activity_type values', () => {
  assert.deepEqual(getDbTypesForReportType('קורס'), ['course']);
  assert.deepEqual(getDbTypesForReportType('סדנה'), ['workshop']);
  assert.deepEqual(getDbTypesForReportType('סדנאות קיץ'), ['workshop']);
  assert.equal(getDbTypesForReportType(ONLINE_REPORT_TYPE), null);
  assert.deepEqual(getDbTypesForReportType(OPERATIONS_REPORT_TYPE), []);
  assert.deepEqual(getDbTypesForReportType(TRAINING_REPORT_TYPE), []);
});

test('instructor with 3 courses and 4 workshops gets exact counts per type', () => {
  assert.equal(filterActivitiesForReportType(sampleActivities, 'קורס').length, 3);
  assert.equal(filterActivitiesForReportType(sampleActivities, 'סדנה').length, 4);
  assert.equal(filterActivitiesForReportType(sampleActivities, ONLINE_REPORT_TYPE).length, 9);
});

test('online report type does not filter by activity family', () => {
  const onlineOptions = instructorActivitySelectOptions(sampleActivities, { reportType: ONLINE_REPORT_TYPE });
  assert.equal(onlineOptions.length, 9);
  assert.ok(onlineOptions.some((o) => o.activity.activity_type === 'course'));
  assert.ok(onlineOptions.some((o) => o.activity.activity_type === 'workshop'));
});

test('course extended filter excludes workshops', () => {
  const courseOptions = instructorActivitySelectOptions(sampleActivities, { reportType: 'קורס' });
  assert.equal(courseOptions.length, 3);
  assert.ok(courseOptions.every((o) => normalizeDbActivityType(o.activity.activity_type) === 'course'));
});

test('activity option label distinguishes same name by school and authority', () => {
  const label = instructorActivityOptionLabel(sampleActivities[0]);
  assert.match(label, /רובוטיקה/);
  assert.match(label, /שמש גבולות/);
  assert.match(label, /אשכול/);
});

test('activityMatchesReportType respects type transitions for online and course', () => {
  const course = sampleActivities[0];
  assert.equal(activityMatchesReportType(course, 'קורס'), true);
  assert.equal(activityMatchesReportType(course, 'סדנה'), false);
  assert.equal(activityMatchesReportType(course, ONLINE_REPORT_TYPE), true);
});

test('deriveAuthoritySchoolListFromActivities deduplicates authorities and schools', () => {
  const list = deriveAuthoritySchoolListFromActivities(sampleActivities);
  assert.ok(list.length >= 3);
  const ashkelon = list.find((a) => a.authority_name === 'אשכול');
  assert.ok(ashkelon);
  assert.equal(ashkelon.schools.length, 2);
});
