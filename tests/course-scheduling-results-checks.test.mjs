import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor, normalizeGender } from '../frontend/src/screens/instructor-matching-engine.js';
import {
  availabilityLabel,
  detailsHtml,
  distanceLabel,
  restoreCalculationSnapshot,
  saveCalculationSnapshot,
  SCHEDULING_SNAPSHOT_KEY,
  SCHEDULING_SNAPSHOT_SCHEMA_VERSION
} from '../frontend/src/screens/course-scheduling.js';

const weekdayRules = [
  { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 2, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 3, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 4, available: true, start_time: '08:00', end_time: '16:00' }
];

const course019 = (extra = {}) => ({
  row_id: 'school_2027_019',
  activity_name: 'קורס תורני ואולפנת בר אילן',
  activity_no: 'school_2027_019',
  activity_type: 'קורס',
  activity_season: 'school_2027',
  status: 'פתוח',
  school: 'תורני ואולפנת בר אילן',
  school_address: 'רחוב בר אילן 1, נתניה',
  authority: 'נתניה',
  instruction_language: 'he',
  grade: '',
  required_instructor_gender: 'female',
  start_date: '2026-09-06',
  start_time: '10:00',
  end_time: '11:00',
  meetings: Array.from({ length: 8 }, (_, index) => {
    const date = new Date('2026-09-06T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + index * 7);
    return { date: date.toISOString().slice(0, 10), start_time: '10:00', end_time: '11:00' };
  }),
  ...extra
});

const femaleInstructor = {
  emp_id: 'f1',
  full_name: 'נועה כהן',
  active: 'yes',
  address: 'הרצל 10, נתניה'
};
const maleInstructor = {
  emp_id: 'm1',
  full_name: 'דני לוי',
  active: 'yes',
  address: 'הרצל 12, נתניה'
};

const matchingProfile = {
  gender: 'female',
  instruction_languages: ['he'],
};

const travelHome = { distance_km: 4.2, duration_minutes: 11 };
const travelFor = (courseId, empId, home = travelHome) => ({
  [courseId]: {
    [empId]: { home, transitions: {} }
  }
});

function baseInput(instructors, profiles, travel = {}) {
  return {
    activities: [course019()],
    instructors,
    profiles,
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, weekdayRules])),
    exceptions: {},
    travel,
    routeMatrix: {}
  };
}

test('normalizeGender converts Hebrew and English consistently', () => {
  assert.equal(normalizeGender('female'), 'female');
  assert.equal(normalizeGender('מדריכה'), 'female');
  assert.equal(normalizeGender('male'), 'male');
  assert.equal(normalizeGender('מדריך'), 'male');
  assert.equal(normalizeGender('any'), 'any');
});

test('cached travel appears on the card with distance and duration', () => {
  const result = calculateCourseSchedule(baseInput(
    [femaleInstructor],
    { f1: matchingProfile },
    travelFor('school_2027_019', 'f1')
  ))[0];
  assert.ok(result.recommended);
  assert.equal(result.recommended.travel.home.distance_km, 4.2);
  assert.equal(result.recommended.travel.home.duration_minutes, 11);
  const html = detailsHtml(result);
  assert.match(html, /מרחק מהבית: 4 ק״מ/);
  assert.match(html, /זמן נסיעה משוער: 11 דקות/);
  assert.doesNotMatch(html, /מרחק לא זמין/);
  assert.equal(distanceLabel(result.recommended), 'מרחק מהבית: 4 ק״מ · זמן נסיעה משוער: 11 דקות');
});

test('the same travel object is used for scoring and display', () => {
  const result = calculateCourseSchedule(baseInput(
    [femaleInstructor],
    { f1: matchingProfile },
    travelFor('school_2027_019', 'f1', { distance_km: 12, duration_minutes: 22 })
  ))[0];
  const candidate = result.recommended;
  assert.equal(candidate.travel.home.distance_km, 12);
  assert.equal(candidate.scoreBreakdown.distance.distance_km, 12);
  assert.equal(candidate.scoreBreakdown.distance.duration_minutes, 22);
  assert.match(candidate.explanation, /12 ק״מ מהבית, 22 דקות נסיעה/);
  assert.match(detailsHtml(result), /מרחק מהבית: 12 ק״מ/);
  assert.match(detailsHtml(result), /זמן נסיעה משוער: 22 דקות/);
});

test('female-required course never recommends a male instructor', () => {
  const result = calculateCourseSchedule(baseInput(
    [maleInstructor, femaleInstructor],
    {
      m1: { ...matchingProfile, gender: 'male' },
      f1: matchingProfile
    },
    {
      ...travelFor('school_2027_019', 'f1'),
      ...travelFor('school_2027_019', 'm1')
    }
  ))[0];
  assert.equal(result.recommended.instructor.emp_id, 'f1');
  assert.ok(!result.alternatives.some((item) => item.instructor.emp_id === 'm1'));
  assert.ok(!result.checked.filter((item) => item.eligible).some((item) => item.instructor.emp_id === 'm1'));
  const rejected = result.checked.find((item) => item.instructor.emp_id === 'm1');
  assert.equal(rejected.eligible, false);
  assert.ok(rejected.failures.includes('הקורס דורש מדריכה'));
  assert.equal(rejected.checks.gender.passed, false);
});

test('course without gender requirement accepts male or female instructors', () => {
  const anyCourse = course019({ required_instructor_gender: 'any', row_id: 'any-gender', activity_no: 'any-gender' });
  const result = calculateCourseSchedule({
    activities: [anyCourse],
    instructors: [maleInstructor, femaleInstructor],
    profiles: {
      m1: { ...matchingProfile, gender: 'male' },
      f1: matchingProfile
    },
    rules: { m1: weekdayRules, f1: weekdayRules },
    exceptions: {},
    travel: {
      ...travelFor('any-gender', 'm1'),
      ...travelFor('any-gender', 'f1')
    }
  })[0];
  const eligibleIds = result.checked.filter((item) => item.eligible).map((item) => item.instructor.emp_id).sort();
  assert.deepEqual(eligibleIds, ['f1', 'm1']);
});

test('language remains a hard matching constraint while age fields are ignored', () => {
  const mismatchedAge = evaluateInstructor({
    instructor: femaleInstructor,
    profile: { ...matchingProfile, education_levels: ['elementary'] },
    rules: weekdayRules,
    activity: course019({ education_level: 'high_school', grade: 'יב' })
  });
  assert.equal(mismatchedAge.eligible, true);
  assert.equal(mismatchedAge.checks.educationLevel, undefined);
  assert.doesNotMatch([...mismatchedAge.failures, ...mismatchedAge.warnings].join(' '), /שכבת גיל|שכבת הגיל/);

  const wrongLanguage = evaluateInstructor({
    instructor: femaleInstructor,
    profile: { ...matchingProfile, instruction_languages: ['ar'] },
    rules: weekdayRules,
    activity: course019()
  });
  assert.equal(wrongLanguage.eligible, false);
  assert.match(wrongLanguage.failures.join(' '), /עברית/);
  assert.equal(wrongLanguage.checks.language.passed, false);
});

test('availability and gender checks stay independent in labels', () => {
  const availableWrongGender = evaluateInstructor({
    instructor: maleInstructor,
    profile: { ...matchingProfile, gender: 'male' },
    rules: weekdayRules,
    activity: course019(),
    travel: { home: travelHome, transitions: {} }
  });
  assert.equal(availableWrongGender.checks.availability.passed, true);
  assert.equal(availableWrongGender.checks.gender.passed, false);
  assert.equal(availableWrongGender.eligible, false);
  assert.match(availabilityLabel(availableWrongGender), /פנוי בכל 8 המפגשים/);
  assert.doesNotMatch(availabilityLabel(availableWrongGender), /מתאים$/);

  const matchingUnavailable = evaluateInstructor({
    instructor: femaleInstructor,
    profile: matchingProfile,
    rules: [{ weekday: 0, available: true, start_time: '12:00', end_time: '14:00' }],
    activity: course019({ meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }] }),
    travel: { home: travelHome, transitions: {} }
  });
  assert.equal(matchingUnavailable.checks.gender.passed, true);
  assert.equal(matchingUnavailable.checks.availability.passed, false);
  assert.equal(availabilityLabel(matchingUnavailable), 'לא זמין במלואו');
});

test('course and instructor allow/block lists no longer gate scheduling eligibility', () => {
  for (const profileExtra of [
    { course_restriction_mode: 'allow_only', course_ids: ['other-course'] },
    { course_restriction_mode: 'block_selected', course_ids: ['school_2027_019'] },
    { blocked_authorities: ['נתניה'] },
    { blocked_schools: ['תורני ואולפנת בר אילן'] }
  ]) {
    const result = evaluateInstructor({ instructor: femaleInstructor, profile: { ...matchingProfile, ...profileExtra }, rules: weekdayRules, activity: course019(), travel: { home: travelHome, transitions: {} } });
    assert.equal(result.eligible, true);
    assert.equal(result.checks.courseEligibility, undefined);
  }

  for (const activityExtra of [
    { blocked_instructor_ids: ['f1'] },
    { allowed_instructor_ids: ['other-instructor'] }
  ]) {
    const result = evaluateInstructor({ instructor: femaleInstructor, profile: matchingProfile, rules: weekdayRules, activity: course019(activityExtra), travel: { home: travelHome, transitions: {} } });
    assert.equal(result.eligible, true);
    assert.equal(result.checks.courseEligibility, undefined);
  }
});

test('recommended and alternatives always include travel and checks', () => {
  const secondFemale = { emp_id: 'f2', full_name: 'מאיה', active: 'yes', address: 'ויצמן 3, נתניה' };
  const result = calculateCourseSchedule({
    activities: [course019()],
    instructors: [femaleInstructor, secondFemale],
    profiles: { f1: matchingProfile, f2: matchingProfile },
    rules: { f1: weekdayRules, f2: weekdayRules },
    exceptions: {},
    travel: {
      ...travelFor('school_2027_019', 'f1', { distance_km: 3, duration_minutes: 8 }),
      ...travelFor('school_2027_019', 'f2', { distance_km: 9, duration_minutes: 18 })
    }
  })[0];
  assert.ok(result.recommended.travel);
  assert.ok(result.recommended.checks);
  for (const candidate of [...(result.alternatives || []), ...(result.checked || [])]) {
    assert.ok(candidate.travel, `missing travel for ${candidate.instructor.emp_id}`);
    assert.ok(candidate.checks, `missing checks for ${candidate.instructor.emp_id}`);
    assert.ok(candidate.checks.gender);
    assert.ok(candidate.checks.language);
    assert.equal(candidate.checks.educationLevel, undefined);
    assert.ok(candidate.checks.availability);
    assert.ok(candidate.checks.travel);
    assert.equal(candidate.checks.courseEligibility, undefined);
  }
});

test('legacy snapshot without travel/checks is not restored', () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: (key) => { memory.delete(key); }
  };
  memory.set('dashboard:course-scheduling-calculation-v1', JSON.stringify({
    calculatedAt: 'old',
    results: [{ course: course019(), status: 'הצעה מוכנה', recommended: { instructor: femaleInstructor, eligible: true, score: 50 } }]
  }));
  memory.set(SCHEDULING_SNAPSHOT_KEY, JSON.stringify({
    schemaVersion: 1,
    calculatedAt: 'stale',
    results: [{ course: course019(), status: 'הצעה מוכנה', recommended: { instructor: femaleInstructor, eligible: true, score: 50 } }]
  }));

  const state = {};
  restoreCalculationSnapshot(state, [course019()]);
  assert.equal((state.courseSchedulingResults || []).length, 0);
  assert.equal(memory.has('dashboard:course-scheduling-calculation-v1'), false);
});

test('new snapshot stores and restores travel and checks', () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: (key) => { memory.delete(key); }
  };
  const calculated = calculateCourseSchedule(baseInput(
    [femaleInstructor],
    { f1: matchingProfile },
    travelFor('school_2027_019', 'f1')
  ));
  const state = {
    courseSchedulingResults: calculated,
    courseSchedulingCalculatedAt: 'עכשיו'
  };
  saveCalculationSnapshot(state, [course019()]);
  const stored = JSON.parse(memory.get(SCHEDULING_SNAPSHOT_KEY));
  assert.equal(stored.schemaVersion, SCHEDULING_SNAPSHOT_SCHEMA_VERSION);
  assert.ok(stored.results[0].recommended.travel.home.distance_km);
  assert.ok(stored.results[0].recommended.checks.gender);

  const restored = {};
  restoreCalculationSnapshot(restored, [course019()]);
  assert.equal(restored.courseSchedulingResults.length, 1);
  assert.equal(restored.courseSchedulingResults[0].recommended.travel.home.duration_minutes, 11);
  assert.equal(restored.courseSchedulingResults[0].recommended.checks.language.passed, true);
});

test('integration school_2027_019: matching Hebrew females are recommended without age gating and distance is scored', () => {
  const arabicOnly = {
    emp_id: 'f-ar',
    full_name: 'רים',
    active: 'yes',
    address: 'שדרות בן גוריון 5, נתניה'
  };
  const elementaryOnly = {
    emp_id: 'f-el',
    full_name: 'יעל',
    active: 'yes',
    address: 'סוקולוב 8, נתניה'
  };
  const result = calculateCourseSchedule({
    activities: [course019()],
    instructors: [maleInstructor, arabicOnly, elementaryOnly, femaleInstructor],
    profiles: {
      m1: { ...matchingProfile, gender: 'male' },
      'f-ar': { ...matchingProfile, instruction_languages: ['ar'] },
      'f-el': { ...matchingProfile, education_levels: ['elementary'] },
      f1: matchingProfile
    },
    rules: {
      m1: weekdayRules,
      'f-ar': weekdayRules,
      'f-el': weekdayRules,
      f1: weekdayRules
    },
    exceptions: {},
    travel: travelFor('school_2027_019', 'f1', { distance_km: 6.4, duration_minutes: 14 })
  })[0];

  assert.equal(result.course.row_id, 'school_2027_019');
  assert.equal(result.recommended.instructor.emp_id, 'f1');
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === 'f-el').eligible, true);
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === 'm1').eligible, false);
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === 'f-ar').eligible, false);
  assert.equal(result.recommended.checks.gender.passed, true);
  assert.equal(result.recommended.checks.language.passed, true);
  assert.equal(result.recommended.checks.educationLevel, undefined);
  assert.match(result.recommended.checks.language.label, /עברית/);
  assert.equal(result.recommended.travel.home.distance_km, 6.4);
  assert.equal(result.recommended.scoreBreakdown.distance.distance_km, 6.4);
  const html = detailsHtml(result);
  assert.match(html, /התאמה לדרישות הקורס/);
  assert.match(html, /מגדר:[\s\S]*עומדת בדרישה/);
  assert.match(html, /שפה:[\s\S]*עברית - מתאים/);
  assert.doesNotMatch(html, /שכבת גיל/);
  assert.match(html, /מרחק מהבית: 6 ק״מ/);
  assert.match(html, /זמן נסיעה משוער: 14 דקות/);
  assert.match(html, /פירוט הציון/);
  assert.match(html, /אין רציפות בבית הספר או ברשות|רציפות באותו בית ספר|רציפות באותה רשות/);
  assert.match(html, /עומס וחלוקה שוויונית/);
  assert.match(html, /ותק/);
  assert.doesNotMatch(html, /ניסיון קודם בקורס/);
  assert.match(html, /תנאי סף ואינם מוסיפים נקודות/);
});
