import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  education_level: 'high_school',
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
  education_levels: ['high_school'],
};

const travelHome = { distance_km: 4.2, duration_minutes: 11 };
const travelHomeReturn = { distance_km: 4.5, duration_minutes: 13 };
const travelFor = (courseId, empId, home = travelHome, homeReturn = travelHomeReturn) => ({
  [courseId]: {
    [empId]: { home, homeReturn, transitions: {} }
  }
});

function mergeTravel(...parts) {
  const merged = {};
  for (const part of parts) {
    for (const [courseId, byEmp] of Object.entries(part || {})) {
      merged[courseId] = { ...(merged[courseId] || {}), ...byEmp };
    }
  }
  return merged;
}

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
  const primary = result.recommended || result.bestAvailable;
  assert.ok(primary);
  assert.equal(primary.travel.home.distance_km, 4.2);
  assert.equal(primary.travel.home.duration_minutes, 11);
  const html = detailsHtml(result);
  assert.match(html, /מרחק מהבית: 4 ק״מ/);
  assert.match(html, /זמן נסיעה משוער: 11 דקות/);
  assert.doesNotMatch(html, /מרחק לא זמין/);
  assert.equal(distanceLabel(primary), 'מרחק מהבית: 4 ק״מ · זמן נסיעה משוער: 11 דקות');
});

test('the same travel object is used for scoring and display', () => {
  const result = calculateCourseSchedule(baseInput(
    [femaleInstructor],
    { f1: matchingProfile },
    travelFor('school_2027_019', 'f1', { distance_km: 12, duration_minutes: 22 })
  ))[0];
  const candidate = result.recommended || result.bestAvailable;
  assert.ok(candidate, 'expected a selectable candidate');
  assert.equal(candidate.travel.home.distance_km, 12);
  assert.equal(candidate.scoreBreakdown.travelDistance.distance_km, candidate.relevantTravelDistance);
  assert.equal(candidate.scoreBreakdown.travelDistance.duration_minutes, candidate.relevantTravelMinutes);
  assert.ok(candidate.relevantTravelMinutes > 0);
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
    mergeTravel(
      travelFor('school_2027_019', 'f1'),
      travelFor('school_2027_019', 'm1')
    )
  ))[0];
  const primary = result.recommended || result.bestAvailable;
  assert.equal(primary.instructor.emp_id, 'f1');
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
    travel: mergeTravel(travelFor('any-gender', 'm1'), travelFor('any-gender', 'f1')),
    routeMatrix: {}
  })[0];
  const eligibleIds = result.checked.filter((item) => item.eligible).map((item) => item.instructor.emp_id).sort();
  assert.deepEqual(eligibleIds, ['f1', 'm1']);
});

test('language remains a hard gate while education level does not', () => {
  // Stage 1 removed education-level gating; stage 3 must not restore it.
  const mismatchedAge = evaluateInstructor({
    instructor: femaleInstructor,
    profile: { ...matchingProfile, education_levels: ['elementary'] },
    rules: weekdayRules,
    activity: course019({ education_level: 'high_school', grade: 'יב' })
  });
  assert.equal(mismatchedAge.eligible, true);
  assert.equal(mismatchedAge.checks.educationLevel, undefined);
  assert.doesNotMatch(mismatchedAge.failures.join(' '), /רמת החינוך/);

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
    travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} }
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
    travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} }
  });
  assert.equal(matchingUnavailable.checks.gender.passed, true);
  assert.equal(matchingUnavailable.checks.availability.passed, false);
  assert.equal(availabilityLabel(matchingUnavailable), 'לא זמין במלואו');
});

test('course and instructor allow/block lists no longer gate scheduling eligibility', () => {
  // Stage 1 removed course/school/authority allow-block lists; stage 3 must not restore them.
  for (const profileExtra of [
    { course_restriction_mode: 'allow_only', course_ids: ['other-course'] },
    { course_restriction_mode: 'block_selected', course_ids: ['school_2027_019'] },
    { blocked_authorities: ['נתניה'] },
    { blocked_schools: ['תורני ואולפנת בר אילן'] }
  ]) {
    const result = evaluateInstructor({ instructor: femaleInstructor, profile: { ...matchingProfile, ...profileExtra }, rules: weekdayRules, activity: course019(), travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} } });
    assert.equal(result.eligible, true);
    assert.equal(result.checks.courseEligibility, undefined);
  }

  for (const activityExtra of [
    { blocked_instructor_ids: ['f1'] },
    { allowed_instructor_ids: ['other-instructor'] }
  ]) {
    const result = evaluateInstructor({ instructor: femaleInstructor, profile: matchingProfile, rules: weekdayRules, activity: course019(activityExtra), travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} } });
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
    travel: mergeTravel(
      travelFor('school_2027_019', 'f1', { distance_km: 3, duration_minutes: 8 }),
      travelFor('school_2027_019', 'f2', { distance_km: 9, duration_minutes: 18 })
    )
  })[0];
  const primary = result.recommended || result.bestAvailable;
  assert.ok(primary.travel);
  assert.ok(primary.checks);
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
  const storedPrimary = stored.results[0].recommended || stored.results[0].bestAvailable;
  assert.ok(storedPrimary.travel.home.distance_km);
  assert.ok(storedPrimary.checks.gender);

  const restored = {};
  restoreCalculationSnapshot(restored, [course019()]);
  assert.equal(restored.courseSchedulingResults.length, 1);
  const restoredPrimary = restored.courseSchedulingResults[0].recommended || restored.courseSchedulingResults[0].bestAvailable;
  assert.equal(restoredPrimary.travel.home.duration_minutes, 11);
  assert.equal(restoredPrimary.checks.language.passed, true);
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
    travel: mergeTravel(
      travelFor('school_2027_019', 'f1', { distance_km: 6.4, duration_minutes: 14 }),
      // Farther than f1 so the matching Hebrew female remains the recommendation.
      travelFor('school_2027_019', 'f-el', { distance_km: 40, duration_minutes: 70 })
    ),
    routeMatrix: {}
  })[0];

  assert.equal(result.course.row_id, 'school_2027_019');
  const primary = result.recommended || result.bestAvailable;
  assert.equal(primary.instructor.emp_id, 'f1');
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === 'f-el').eligible, true);
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === 'm1').eligible, false);
  assert.equal(result.checked.find((candidate) => candidate.instructor.emp_id === 'f-ar').eligible, false);
  assert.equal(primary.checks.gender.passed, true);
  assert.equal(primary.checks.language.passed, true);
  assert.equal(primary.checks.educationLevel, undefined);
  assert.match(primary.checks.language.label, /עברית/);
  assert.equal(primary.travel.home.distance_km, 6.4);
  assert.equal(primary.scoreBreakdown.travelDistance.distance_km, primary.relevantTravelDistance);
  assert.ok(primary.scoreBreakdown.continuityEfficiency);
  assert.ok(primary.scoreBreakdown.travelDistance);
  assert.ok(primary.scoreBreakdown.actualWorkload);
  assert.ok(primary.scoreBreakdown.originalSchedulePreservation);
  assert.ok(primary.scoreBreakdown.gapsAndNewDays);
  assert.equal(primary.scoreBreakdown.seniority, undefined);
  assert.equal(primary.scoreBreakdown.workload, undefined);
  const html = detailsHtml(result);
  assert.doesNotMatch(html, /שכבת גיל/);
  assert.match(html, /מרחק מהבית: 6 ק״מ/);
  assert.match(html, /זמן נסיעה משוער: 14 דקות/);
  assert.doesNotMatch(html, /ניסיון קודם בקורס/);
  assert.doesNotMatch(html, />ותק</);
});

test('language hard gates Hebrew, Arabic, and missing instructor languages', () => {
  const hebrew = calculateCourseSchedule({
    activities: [course019({ row_id: 'he-course', activity_no: 'he-course', instruction_language: 'he', required_instructor_gender: 'any' })],
    instructors: [femaleInstructor, maleInstructor],
    profiles: { f1: { ...matchingProfile, instruction_languages: ['he'] }, m1: { gender: 'male', instruction_languages: ['ar'], education_levels: ['high_school'] } },
    rules: { f1: weekdayRules, m1: weekdayRules },
    exceptions: {},
    travel: mergeTravel(travelFor('he-course', 'f1'), travelFor('he-course', 'm1')),
    routeMatrix: {}
  })[0];
  assert.deepEqual(hebrew.checked.filter((item) => item.eligible).map((item) => item.instructor.emp_id), ['f1']);
  assert.equal(hebrew.checked.find((item) => item.instructor.emp_id === 'm1').score, null);
  assert.match(hebrew.checked.find((item) => item.instructor.emp_id === 'm1').failures.join(' '), /שפת ההדרכה אינה תואמת/);

  const arabic = calculateCourseSchedule({
    activities: [course019({ row_id: 'ar-course', activity_no: 'ar-course', instruction_language: 'ar', required_instructor_gender: 'any' })],
    instructors: [femaleInstructor, maleInstructor],
    profiles: { f1: { ...matchingProfile, instruction_languages: ['he'] }, m1: { gender: 'male', instruction_languages: ['ar'], education_levels: ['high_school'] } },
    rules: { f1: weekdayRules, m1: weekdayRules },
    exceptions: {},
    travel: mergeTravel(travelFor('ar-course', 'f1'), travelFor('ar-course', 'm1')),
    routeMatrix: {}
  })[0];
  assert.deepEqual(arabic.checked.filter((item) => item.eligible).map((item) => item.instructor.emp_id), ['m1']);

  const missing = evaluateInstructor({ instructor: femaleInstructor, profile: { gender: 'female' }, rules: weekdayRules, activity: course019() });
  assert.equal(missing.eligible, false);
  assert.equal(missing.score, null);
  assert.ok(missing.missingProfileData.includes('לא ניתן לאמת שפת הדרכה'));
});

test('gender hard gates male, female, and missing profile gender only when required', () => {
  const maleCourse = course019({ row_id: 'male-course', activity_no: 'male-course', required_instructor_gender: 'male' });
  const result = calculateCourseSchedule({
    activities: [maleCourse],
    instructors: [femaleInstructor, maleInstructor],
    profiles: { f1: matchingProfile, m1: { ...matchingProfile, gender: 'male' } },
    rules: { f1: weekdayRules, m1: weekdayRules },
    exceptions: {},
    travel: mergeTravel(travelFor('male-course', 'f1'), travelFor('male-course', 'm1')),
    routeMatrix: {}
  })[0];
  assert.deepEqual(result.checked.filter((item) => item.eligible).map((item) => item.instructor.emp_id), ['m1']);
  assert.equal(result.checked.find((item) => item.instructor.emp_id === 'f1').score, null);

  const missingRequired = evaluateInstructor({ instructor: femaleInstructor, profile: { instruction_languages: ['he'] }, rules: weekdayRules, activity: course019({ required_instructor_gender: 'female' }) });
  assert.ok(missingRequired.missingProfileData.includes('מגדר'));

  // Gender remains mandatory even when the activity requirement is "any".
  const missingAny = evaluateInstructor({ instructor: femaleInstructor, profile: { instruction_languages: ['he'] }, rules: weekdayRules, activity: course019({ required_instructor_gender: 'any' }) });
  assert.equal(missingAny.checks.gender.passed, false);
  assert.match(missingAny.missingProfileData.join(' '), /מגדר/);
});

test('candidate details render primary card, closed rejections, and initially disabled actions with explanation', () => {
  const recommended = {
    instructor: femaleInstructor,
    eligible: true,
    score: 88,
    qualityLabel: 'מומלץ',
    recommendationReason: 'רציפות יומית גבוהה',
    explanation: 'מתאימה',
    warnings: [],
    failures: [],
    missingProfileData: [],
    issues: [],
    projectedHalfHours: 12,
    movedMeetingsCount: 0,
    activeWorkDays: 3,
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } },
    scoreBreakdown: {
      continuityEfficiency: { points: 30, label: 'רציפות ויעילות ביום' },
      travelDistance: { points: 20, label: 'מרחק ונסיעות' },
      actualWorkload: { points: 18, label: 'עומס עבודה בפועל' },
      originalSchedulePreservation: { points: 15, label: 'שמירה על המועדים המקוריים' },
      gapsAndNewDays: { points: 5, label: 'צמצום חלונות ופתיחת ימי עבודה' }
    },
    travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} }
  };
  const rejected = { instructor: maleInstructor, eligible: false, score: null, failures: ['שפת ההדרכה אינה תואמת'], missingProfileData: ['לא ניתן לאמת שפת הדרכה'], checks: { language: { passed: false, reason: 'שפת ההדרכה אינה תואמת' }, gender: { passed: true }, availability: { passed: true } }, travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} } };
  const html = detailsHtml({ course: course019({ required_instructor_gender: 'any' }), status: 'הצעה מוכנה', recommended, alternatives: [], checked: [recommended, rejected] }, { courseSchedulingSelectedCandidateId: '' });
  assert.match(html, /המדריך המומלץ/);
  assert.match(html, /course-scheduling-primary-card/);
  assert.match(html, /88<\/strong><span>\/100<\/span>/);
  assert.match(html, /רציפות ויעילות ביום[\s\S]*30 מתוך 35/);
  assert.match(html, /מרחק ונסיעות[\s\S]*20 מתוך 25/);
  assert.match(html, /עומס עבודה בפועל[\s\S]*18 מתוך 20/);
  assert.match(html, /שמירה על המועדים המקוריים[\s\S]*15 מתוך 15/);
  assert.match(html, /צמצום חלונות ופתיחת ימי עבודה[\s\S]*5 מתוך 5/);
  assert.match(html, /לא עברו תנאי סף \(1\)/);
  assert.doesNotMatch(html, /<details class="course-scheduling-rejected"[^>]*open/);
  assert.doesNotMatch(html, /data-rejected-candidate="m1"[\s\S]*type="radio"/);
  assert.match(html, /data-assign-course disabled title="בחרו מדריך כשיר"/);
  assert.match(html, /בחרו מדריך כדי להמשיך/);
  assert.doesNotMatch(html, /course-scheduling-candidates-table/);
  assert.doesNotMatch(html, /text-overflow:\s*ellipsis/);
});

test('bestAvailable uses review title and never the misleading quality-miss heading', () => {
  const bestAvailable = {
    instructor: femaleInstructor,
    eligible: true,
    score: 48,
    qualityLabel: 'מתאים טכנית בלבד',
    recommendationReason: 'עומד בתנאי הסף אך הציון נמוך',
    projectedHalfHours: 10,
    movedMeetingsCount: 0,
    activeWorkDays: 2,
    scoreBreakdown: {
      continuityEfficiency: { points: 12, label: 'רציפות ויעילות ביום' },
      travelDistance: { points: 10, label: 'מרחק ונסיעות' },
      actualWorkload: { points: 12, label: 'עומס עבודה בפועל' },
      originalSchedulePreservation: { points: 10, label: 'שמירה על המועדים המקוריים' },
      gapsAndNewDays: { points: 4, label: 'צמצום חלונות ופתיחת ימי עבודה' }
    },
    travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
  };
  const html = detailsHtml({
    course: course019({ required_instructor_gender: 'any' }),
    status: 'נדרש טיפול',
    recommended: null,
    bestAvailable,
    alternatives: [],
    checked: [bestAvailable]
  });
  assert.match(html, /ההתאמה הטובה ביותר שנמצאה/);
  assert.equal((html.match(/נדרשת בדיקה/g) || []).length, 1);
  const badges = [...html.matchAll(/course-scheduling-status-pill[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(badges, ['נדרשת בדיקה']);
  assert.doesNotMatch(html, /ההתאמה הטובה ביותר<\/span>/);
  assert.doesNotMatch(html, /מתאים טכנית בלבד/);
  assert.doesNotMatch(html, /לא נמצאה התאמה איכותית לקורס/);
});

test('alternatives keep engine order, max three, and exclude ineligible candidates', () => {
  const mk = (id, name, score, eligible = true) => ({
    instructor: { emp_id: id, full_name: name, active: 'yes', address: 'נתניה' },
    eligible,
    score: eligible ? score : null,
    qualityLabel: eligible ? 'מתאים עם אזהרה' : '',
    projectedHalfHours: 8,
    movedMeetingsCount: 0,
    activeWorkDays: 1,
    scoreBreakdown: eligible ? {
      continuityEfficiency: { points: 20, label: 'רציפות ויעילות ביום' },
      travelDistance: { points: 15, label: 'מרחק ונסיעות' },
      actualWorkload: { points: 12, label: 'עומס עבודה בפועל' },
      originalSchedulePreservation: { points: 10, label: 'שמירה על המועדים המקוריים' },
      gapsAndNewDays: { points: 3, label: 'צמצום חלונות ופתיחת ימי עבודה' }
    } : null,
    travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} },
    checks: { language: { passed: eligible }, gender: { passed: true }, availability: { passed: true } },
    failures: eligible ? [] : ['שפת ההדרכה אינה תואמת']
  });
  const recommended = mk('f1', 'נועה כהן', 88);
  const alternatives = [mk('a1', 'אלטרנטיבה א', 70), mk('a2', 'אלטרנטיבה ב', 65), mk('a3', 'אלטרנטיבה ג', 62), mk('a4', 'אלטרנטיבה ד', 61), mk('bad', 'פסולה', null, false)];
  const html = detailsHtml({
    course: course019({ required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended,
    alternatives,
    checked: [recommended, ...alternatives]
  });
  assert.match(html, /חלופות מתאימות/);
  assert.equal((html.match(/class="course-scheduling-alt-card(?: is-selected)?"/g) || []).length, 3);
  assert.ok(html.indexOf('אלטרנטיבה א') < html.indexOf('אלטרנטיבה ב'));
  assert.ok(html.indexOf('אלטרנטיבה ב') < html.indexOf('אלטרנטיבה ג'));
  assert.doesNotMatch(html, /אלטרנטיבה ד/);
  const alternativesBlock = html.match(/data-alternatives>[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(alternativesBlock, /פסולה/);
  assert.doesNotMatch(alternativesBlock, /data-candidate-row="bad"/);
  assert.match(html, /data-rejected-candidate="bad"/);
  assert.doesNotMatch(html, /data-rejected-candidate="bad"[\s\S]{0,200}type="radio"/);
});

test('proposed meetings and halfOverflow render from candidate data without recomputing scores', () => {
  const recommended = {
    instructor: femaleInstructor,
    eligible: true,
    score: 70,
    qualityLabel: 'מומלץ',
    recommendationReason: 'שמירה על המועדים',
    projectedHalfHours: 11,
    movedMeetingsCount: 2,
    totalShiftDays: 14,
    activeWorkDays: 4,
    halfOverflow: true,
    originalEndDate: '2026-10-25',
    proposedEndDate: '2026-11-08',
    proposedMeetings: [
      { date: '2026-09-06', original_date: '2026-09-06', start_time: '10:00', end_time: '11:00', moved: false },
      { date: '2026-09-20', original_date: '2026-09-13', start_time: '10:00', end_time: '11:00', moved: true }
    ],
    dateAdjustment: {
      valid: true,
      movedCount: 2,
      exceedsHalf: true,
      newEndDate: '2026-11-08',
      meetings: [
        { date: '2026-09-06', original_date: '2026-09-06', start_time: '10:00', end_time: '11:00', moved: false },
        { date: '2026-09-20', original_date: '2026-09-13', start_time: '10:00', end_time: '11:00', moved: true }
      ]
    },
    scoreBreakdown: {
      continuityEfficiency: { points: 25, label: 'רציפות ויעילות ביום' },
      travelDistance: { points: 18, label: 'מרחק ונסיעות' },
      actualWorkload: { points: 14, label: 'עומס עבודה בפועל' },
      originalSchedulePreservation: { points: 8, label: 'שמירה על המועדים המקוריים', halfOverflow: true },
      gapsAndNewDays: { points: 5, label: 'צמצום חלונות ופתיחת ימי עבודה' }
    },
    travel: { home: travelHome, homeReturn: travelHomeReturn, transitions: {} },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
  };
  const selectedHtml = detailsHtml({
    course: course019({ required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended,
    alternatives: [],
    checked: [recommended]
  }, { courseSchedulingSelectedCandidateId: 'f1' });
  assert.match(selectedHtml, /נבחרה: נועה כהן/);
  assert.match(selectedHtml, /course-scheduling-action-bar/);
  assert.match(selectedHtml, /מועדי הפעילות/);
  assert.match(selectedHtml, /מועד מקורי/);
  assert.match(selectedHtml, /מועד מוצע/);
  assert.match(selectedHtml, /הוזז/);
  assert.match(selectedHtml, /המועדים המוצעים חורגים מתקופת המחצית/);
  assert.match(selectedHtml, /תאריך סיום מקורי/);
  assert.match(selectedHtml, /תאריך סיום מוצע/);
  assert.match(selectedHtml, /data-save-draft/);
  assert.match(selectedHtml, /data-assign-course/);
  assert.match(selectedHtml, /data-clear-candidate/);

  const unchanged = {
    ...recommended,
    movedMeetingsCount: 0,
    halfOverflow: false,
    proposedMeetings: [],
    dateAdjustment: null,
    originalEndDate: '2026-10-25',
    proposedEndDate: '2026-10-25'
  };
  const unchangedHtml = detailsHtml({
    course: course019({ required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended: unchanged,
    alternatives: [],
    checked: [unchanged]
  }, { courseSchedulingSelectedCandidateId: 'f1' });
  assert.match(unchangedHtml, /מועדי הפעילות נשארים ללא שינוי/);
  assert.doesNotMatch(unchangedHtml, /course-scheduling-meetings-table/);
  assert.doesNotMatch(unchangedHtml, /data-half-overflow/);
});

test('results layer displays scoreBreakdown points and does not import scoring recompute helpers into markup', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /SCORE_COMPONENT_DISPLAY/);
  assert.match(source, /SCORE_WEIGHTS/);
  assert.match(source, /continuityEfficiency/);
  assert.match(source, /travelDistance/);
  assert.match(source, /actualWorkload/);
  assert.match(source, /originalSchedulePreservation/);
  assert.match(source, /gapsAndNewDays/);
  assert.match(source, /\$\{points\} מתוך \$\{max\}/);
  assert.match(source, /SCORE_WEIGHTS\.continuityEfficiency/);
  assert.match(source, /SCORE_WEIGHTS\.travelDistance/);
  assert.match(source, /SCORE_WEIGHTS\.actualWorkload/);
  assert.match(source, /SCORE_WEIGHTS\.originalSchedulePreservation/);
  assert.match(source, /SCORE_WEIGHTS\.gapsAndNewDays/);
  assert.doesNotMatch(source, /scoreCandidate\(|buildCandidateScore\(|calculateCandidateScore\(/);
});

test('missing-only incomplete profiles stay out of rejectedCandidatesHtml', () => {
  const incomplete = {
    instructor: { emp_id: '1500', full_name: 'הילה רוזן', address: 'צה״ל 68, גן יבנה' },
    eligible: false,
    score: null,
    failures: [],
    missingProfileData: ['לא הוגדרה זמינות שבועית'],
    issues: [{ missing: true, message: 'לא הוגדרה זמינות', dates: ['2026-09-07'] }]
  };
  const hardReject = {
    instructor: { emp_id: 'm9', full_name: 'נדחה' },
    eligible: false,
    score: null,
    failures: ['שפת ההדרכה אינה תואמת'],
    missingProfileData: [],
    issues: []
  };
  const html = detailsHtml({
    course: course019({ required_instructor_gender: 'any' }),
    status: 'נדרש טיפול',
    recommended: null,
    treatmentReason: 'חסרים נתונים בפרופילי מדריכים.',
    incompleteProfiles: [incomplete],
    checked: [incomplete, hardReject]
  });
  assert.match(html, /פרופילים חסרים להשלמה/);
  assert.match(html, /הילה רוזן \| 1500/);
  assert.equal((html.match(/לא הוגדרה זמינות/g) || []).length, 1);
  assert.doesNotMatch(html, /data-rejected-candidate="1500"/);
  assert.match(html, /data-rejected-candidate="m9"/);
  assert.match(html, /לא עברו תנאי סף \(1\)/);
});
