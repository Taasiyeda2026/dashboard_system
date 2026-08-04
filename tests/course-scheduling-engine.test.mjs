import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCourseSchedule, instructorLoad, schedulingCourses, schedulingInstructors } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';
import { createRouteClient, calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';
import { courseSchedulingCounts, detailsHtml } from '../frontend/src/screens/course-scheduling.js';

const course = (id, date = '2027-09-05', extra = {}) => ({
  row_id: id,
  activity_name: id,
  activity_no: id,
  activity_type: 'קורס',
  activity_season: 'school_2027',
  status: 'פתוח',
  school: `בית ספר ${id}`,
  school_address: `רחוב ${id}, חיפה`,
  authority: 'חיפה',
  instruction_language: 'he',
  education_level: 'elementary',
  required_instructor_gender: 'female',
  start_time: '10:00',
  end_time: '11:00',
  meetings: [{ date, start_time: '10:00', end_time: '11:00' }],
  ...extra
});
const instructors = [
  { emp_id: '1', full_name: 'נועה', active: 'yes', address: 'חיפה' },
  { emp_id: '2', full_name: 'דנה', active: 'yes', address: 'חיפה' }
];
const profiles = {
  1: { gender: 'female', instruction_languages: ['he'], education_levels: ['elementary'], course_restriction_mode: 'all', course_ids: [] },
  2: { gender: 'female', instruction_languages: ['he'], education_levels: ['elementary'], course_restriction_mode: 'all', course_ids: [] }
};
const rules = {
  1: [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }, { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' }],
  2: [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }, { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' }]
};

const baseInput = (activities) => ({ activities, instructors, profiles, rules, exceptions: {} });

test('filters only open, fully unassigned 2027 courses', () => {
  assert.deepEqual(schedulingCourses([
    course('ok'),
    { ...course('assigned'), emp_id: '1' },
    { ...course('secondary'), emp_id_2: '2' },
    { ...course('secondary-name'), instructor_name_2: 'דנה' },
    { ...course('workshop'), activity_type: 'סדנה' },
    { ...course('closed'), status: 'סגור' },
    { ...course('old'), activity_season: 'regular' }
  ]).map((row) => row.row_id), ['ok']);
});

test('filters inactive instructors before matching and route calculation', () => {
  const activeInstructor = instructors[0];
  const inactiveInstructor = { ...instructors[1], active: 'no' };
  assert.deepEqual(schedulingInstructors([activeInstructor, inactiveInstructor]).map((row) => row.emp_id), ['1']);
  const result = calculateCourseSchedule({ ...baseInput([course('active-only')]), instructors: [activeInstructor, inactiveInstructor] })[0];
  assert.deepEqual(result.checked.map((candidate) => candidate.instructor.emp_id), ['1']);
});

test('global allocation preserves the only instructor for a constrained course', () => {
  const constrainedProfiles = {
    1: { ...profiles[1], course_restriction_mode: 'allow_only', course_ids: ['flex', 'only'] },
    2: { ...profiles[2], course_restriction_mode: 'allow_only', course_ids: ['flex'] }
  };
  const results = calculateCourseSchedule({ ...baseInput([course('flex'), course('only', '2027-09-06')]), profiles: constrainedProfiles });
  assert.equal(results.filter((result) => result.recommended).length, 2);
  assert.equal(results.find((result) => result.course.row_id === 'only').recommended.instructor.emp_id, '1');
  assert.equal(results.find((result) => result.course.row_id === 'flex').recommended.instructor.emp_id, '2');
});

test('checks every meeting and keeps missing weekday availability out of recruitment', () => {
  const result = calculateCourseSchedule(baseInput([{ ...course('flex'), meetings: [
    { date: '2027-09-05', start_time: '10:00', end_time: '11:00' },
    { date: '2027-09-07', start_time: '10:00', end_time: '11:00' }
  ] }]))[0];
  assert.equal(result.status, 'נדרש טיפול');
  assert.ok(result.checked.every((candidate) => candidate.missingProfileData.some((reason) => /זמינות/.test(reason))));
});

test('missing essential data is reported exactly and never proposed', () => {
  const result = calculateCourseSchedule(baseInput([{ ...course('missing'), school_address: '', instruction_language: '' }]))[0];
  assert.equal(result.status, 'חסר מידע');
  assert.deepEqual(result.missing, ['כתובת בית הספר']);
  assert.ok(!result.missing.includes('שפת הדרכה'));
});

test('weekly workload compares each ISO week with one declared weekly capacity', () => {
  const load = instructorLoad([
    course('week-one', '2027-09-05'),
    course('week-two', '2027-09-12')
  ], profiles[1], rules[1]);
  assert.equal(load.hours, 2);
  assert.equal(load.availabilityHours, 16);
  assert.equal(load.maxRatio, 1 / 16);
  assert.equal(load.ratio, 1 / 16);
});

test('the draft dynamically balances otherwise equivalent courses between instructors', () => {
  const results = calculateCourseSchedule(baseInput([
    course('first', '2027-09-05'),
    course('second', '2027-09-06')
  ]));
  assert.equal(results.filter((result) => result.recommended).length, 2);
  assert.equal(new Set(results.map((result) => result.recommended.instructor.emp_id)).size, 2);
});

test('closed, cancelled and other-season assignments do not block or inflate workload', () => {
  const target = course('target');
  const ignoredAssignments = [
    { ...course('closed-blocker'), emp_id: '1', status: 'סגור' },
    { ...course('cancelled-blocker'), emp_id: '1', status: 'בוטל' },
    { ...course('old-blocker'), emp_id: '1', activity_season: 'regular' }
  ];
  const result = calculateCourseSchedule(baseInput([target, ...ignoredAssignments]))[0];
  assert.ok(result.checked.find((candidate) => candidate.instructor.emp_id === '1').eligible);
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === '1').load.hours, 1);
});

test('missing profile fields are separate from professional failures and receive no score', () => {
  for (const [field, partial] of [
    ['מגדר', { instruction_languages: ['he'], education_levels: ['elementary'] }],
    ['שפות הדרכה', { gender: 'female', education_levels: ['elementary'] }],
    ['שכבות גיל', { gender: 'female', instruction_languages: ['he'] }]
  ]) {
    const result = evaluateInstructor({ instructor: instructors[0], profile: { ...partial, course_restriction_mode: 'all' }, rules: rules[1], activity: course('missing-profile') });
    assert.equal(result.eligible, false);
    assert.equal(result.score, null);
    assert.ok(result.missingProfileData.includes(field));
    assert.equal(result.failures.length, 0);
  }
});

test('defined availability outside course hours is a failure, while no weekly rules is missing data', () => {
  const activity = course('flex');
  const missing = evaluateInstructor({ instructor: instructors[0], profile: profiles[1], rules: [], activity });
  assert.ok(missing.missingProfileData.includes('זמינות שבועית'));
  assert.equal(missing.failures.length, 0);
  const rejected = evaluateInstructor({ instructor: instructors[0], profile: profiles[1], rules: [{ weekday: 0, available: true, start_time: '12:00', end_time: '14:00' }], activity });
  assert.equal(rejected.missingProfileData.length, 0);
  assert.match(rejected.failures.join(' '), /אינה מכסה/);
});

test('eight missing Monday availability dates are grouped once and expanded only in details', () => {
  const meetings = Array.from({ length: 8 }, (_, index) => {
    const date = new Date('2027-09-06T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + index * 7);
    return { date: date.toISOString().slice(0, 10), start_time: '10:00', end_time: '11:30' };
  });
  const activity = course('flex', meetings[0].date, { meetings, start_time: '10:00', end_time: '11:30' });
  const candidate = evaluateInstructor({ instructor: instructors[0], profile: profiles[1], rules: [], activity });
  assert.equal(candidate.issues.filter((issue) => issue.kind === 'missing_availability').length, 1);
  assert.equal(candidate.issues[0].dates.length, 8);
  const result = { course: activity, status: 'נדרש טיפול', recommended: null, incompleteProfiles: [{ ...candidate, instructor: instructors[0] }], treatmentReason: 'לא ניתן להשלים את בדיקת השיבוץ משום שחסרים נתונים בפרופילי מדריכים.' };
  const html = detailsHtml(result);
  assert.equal((html.match(/לא הוגדרה זמינות/g) || []).length, 1);
  for (const meeting of meetings) assert.match(html, new RegExp(meeting.date));
});

test('course status distinguishes incomplete-only candidates from fully rejected candidates', () => {
  const incomplete = calculateCourseSchedule({ activities: [course('incomplete')], instructors, profiles: {}, rules: {}, exceptions: {} })[0];
  assert.equal(incomplete.status, 'נדרש טיפול');
  const rejectedProfiles = { 1: { ...profiles[1], instruction_languages: ['ar'] }, 2: { ...profiles[2], instruction_languages: ['ar'] } };
  const rejected = calculateCourseSchedule({ ...baseInput([course('rejected')]), profiles: rejectedProfiles })[0];
  assert.equal(rejected.status, 'נדרש גיוס');
});

test('route requests are deduplicated, capped at four, and only threshold candidates are routed', async () => {
  let active = 0;
  let max = 0;
  let calls = 0;
  const client = createRouteClient({ concurrency: 4, invoke: async () => {
    calls += 1;
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return { data: { calculated: true, distance_km: 2, duration_minutes: 5 } };
  } });
  await Promise.all(Array.from({ length: 10 }, (_, index) => client.request(index < 2 ? 'same' : `o${index}`, 'dest')));
  assert.ok(max <= 4);
  assert.equal(calls, 9);
  const preliminary = [{ course: course('route'), candidate: { instructor: instructors[0] } }];
  const routed = await calculateCandidateTravel(preliminary, [], client);
  assert.ok(routed.travel.route['1'].home);
  assert.equal(routed.travel.route?.['2'], undefined);
});

test('travel is precomputed between two draft courses proposed for the same instructor', async () => {
  const first = course('a', '2027-09-05', { school: 'א', school_address: 'כתובת א', start_time: '08:00', end_time: '09:00', meetings: [{ date: '2027-09-05', start_time: '08:00', end_time: '09:00' }] });
  const second = course('b', '2027-09-05', { school: 'ב', school_address: 'כתובת ב', start_time: '10:00', end_time: '11:00', meetings: [{ date: '2027-09-05', start_time: '10:00', end_time: '11:00' }] });
  const requested = [];
  const client = createRouteClient({ invoke: async ({ origin, destination }) => {
    requested.push(`${origin}→${destination}`);
    return { data: { calculated: true, distance_km: 4, duration_minutes: 12 } };
  } });
  const preliminary = [first, second].map((draftCourse) => ({ course: draftCourse, candidate: { instructor: instructors[0] } }));
  const routed = await calculateCandidateTravel(preliminary, [], client);
  assert.ok(requested.includes('כתובת א→כתובת ב'));
  assert.equal(routed.routeMatrix['כתובת א→כתובת ב']?.duration_minutes, 12);
});

test('a missing route between two draft schools safely prevents assigning both to one instructor', () => {
  const first = course('a', '2027-09-05', { school: 'א', school_address: 'כתובת א', start_time: '08:00', end_time: '09:00', meetings: [{ date: '2027-09-05', start_time: '08:00', end_time: '09:00' }] });
  const second = course('b', '2027-09-05', { school: 'ב', school_address: 'כתובת ב', start_time: '10:00', end_time: '11:00', meetings: [{ date: '2027-09-05', start_time: '10:00', end_time: '11:00' }] });
  const results = calculateCourseSchedule({ activities: [first, second], instructors: [instructors[0]], profiles: { 1: profiles[1] }, rules: { 1: rules[1] }, exceptions: {}, travel: {}, routeMatrix: {} });
  assert.equal(results.filter((result) => result.recommended).length, 1);
});

test('unverified transition between existing schools fails safely', () => {
  const result = evaluateInstructor({ instructor: instructors[0], profile: profiles[1], rules: rules[1], activity: course('transition'), existingActivities: [{ date: '2027-09-05', start_time: '08:00', end_time: '09:00', school: 'אחר' }], travel: { home: null, transitions: { '2027-09-05': { previous: null } } } });
  assert.equal(result.eligible, false);
  assert.match(result.failures.join(' '), /לא ניתן לאמת זמן מעבר/);
});

test('status counters and candidate radio names are isolated per course', () => {
  assert.deepEqual(courseSchedulingCounts([
    { status: 'הצעה מוכנה' }, { status: 'נדרש טיפול' }, { status: 'נדרש גיוס' }, { status: 'חסר מידע' }
  ]), { ready: 1, treatment: 1, recruit: 1, missing: 1 });
  const candidate = { instructor: instructors[0], eligible: true, score: 90, explanation: 'מתאימה', warnings: [], failures: [], missingProfileData: [], issues: [] };
  const firstHtml = detailsHtml({ course: course('first'), status: 'הצעה מוכנה', recommended: candidate, alternatives: [], checked: [candidate] });
  const secondHtml = detailsHtml({ course: course('second'), status: 'הצעה מוכנה', recommended: candidate, alternatives: [], checked: [candidate] });
  assert.match(firstHtml, /name="course-candidate-first"/);
  assert.match(secondHtml, /name="course-candidate-second"/);
});

test('course scheduling screen explicitly loads school_2027 and exposes reject/open workflows', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /activity_period:\s*'school_2027'/);
  assert.match(source, /data-assign-course/);
  assert.match(source, /data-save-draft/);
  assert.match(source, /data-open-missing-course/);
  assert.match(source, /state\.listFilters\.activities/);
  assert.doesNotMatch(source, /CSS\.escape/);
});

test('scheduling route reuses cached address pairs without an expiry check', async () => {
  const source = await readFile(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');
  assert.match(source, /\.eq\('origin_key', originKey\)/);
  assert.match(source, /\.eq\('destination_key', destinationKey\)/);
  assert.doesNotMatch(source, /\.gt\('expires_at'/);
});

test('acceptance: Hila Rosen 1500 remains incomplete, keeps her address, and groups eight Mondays', () => {
  const dates = Array.from({ length: 8 }, (_, index) => {
    const date = new Date('2027-09-06T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + index * 7);
    return { date: date.toISOString().slice(0, 10), start_time: '10:00', end_time: '11:30' };
  });
  const hila = { emp_id: '1500', full_name: 'הילה רוזן', active: 'yes', address: 'צה״ל 68, גן יבנה' };
  const activity = course('hila', dates[0].date, { meetings: dates, start_time: '10:00', end_time: '11:30' });
  const result = calculateCourseSchedule({ activities: [activity], instructors: [hila], profiles: {}, rules: {}, exceptions: {} })[0];
  assert.equal(result.status, 'נדרש טיפול');
  assert.equal(result.recommended, null);
  assert.equal(result.incompleteProfiles[0].score, null);
  assert.equal(result.incompleteProfiles[0].failures.length, 0);
  assert.ok(!result.incompleteProfiles[0].missingProfileData.includes('כתובת'));
  const html = detailsHtml(result);
  assert.match(html, /הילה רוזן \| 1500/);
  assert.match(html, /צה״ל 68, גן יבנה/);
  assert.doesNotMatch(html, /חסר להשלמה:<\/b> כתובת/);
  assert.equal((html.match(/לא הוגדרה זמינות/g) || []).length, 1);
  assert.match(html, /משפיע על 8 מפגשים/);
});
