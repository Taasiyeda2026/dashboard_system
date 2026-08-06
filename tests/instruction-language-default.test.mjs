import test from 'node:test';
import assert from 'node:assert/strict';
import {
  instructionLanguageLabel,
  profileSpeaksLanguage,
  resolveInstructionLanguage
} from '../frontend/src/screens/shared/instruction-language.js';
import { missingCourseInformation, calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';
import { courseSchedulingScreen } from '../frontend/src/screens/course-scheduling.js';

const courseBase = {
  row_id: 'lang-1',
  activity_name: 'קורס שפה',
  activity_no: 'lang-1',
  activity_type: 'קורס',
  activity_season: 'school_2027',
  status: 'פתוח',
  school: 'בית ספר א',
  school_address: 'רחוב 1, חיפה',
  authority: 'חיפה',
  education_level: 'elementary',
  required_instructor_gender: 'any',
  start_time: '10:00',
  end_time: '11:00',
  meetings: [{ date: '2027-09-05', start_time: '10:00', end_time: '11:00' }]
};

const instructor = { emp_id: '1', full_name: 'נועה', active: 'yes', address: 'חיפה' };
const heProfile = { gender: 'female', instruction_languages: ['he'], education_levels: ['elementary'], course_restriction_mode: 'all', course_ids: [] };
const arProfile = { gender: 'female', instruction_languages: ['ar'], education_levels: ['elementary'], course_restriction_mode: 'all', course_ids: [] };
const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];

test('resolveInstructionLanguage defaults missing/null/empty to he', () => {
  assert.equal(resolveInstructionLanguage(null), 'he');
  assert.equal(resolveInstructionLanguage(undefined), 'he');
  assert.equal(resolveInstructionLanguage(''), 'he');
  assert.equal(resolveInstructionLanguage({}), 'he');
  assert.equal(resolveInstructionLanguage({ instruction_language: null }), 'he');
  assert.equal(resolveInstructionLanguage({ instruction_language: '' }), 'he');
  assert.equal(resolveInstructionLanguage({ instruction_language: '   ' }), 'he');
});

test('resolveInstructionLanguage canonicalizes he/עברית and ar/ערבית', () => {
  assert.equal(resolveInstructionLanguage({ instruction_language: 'he' }), 'he');
  assert.equal(resolveInstructionLanguage({ instruction_language: 'עברית' }), 'he');
  assert.equal(resolveInstructionLanguage({ instruction_language: 'ar' }), 'ar');
  assert.equal(resolveInstructionLanguage({ instruction_language: 'ערבית' }), 'ar');
  assert.equal(resolveInstructionLanguage('HE'), 'he');
  assert.equal(resolveInstructionLanguage('AR'), 'ar');
});

test('missingCourseInformation lists missing instruction language', () => {
  for (const language of [null, '', undefined]) {
    const missing = missingCourseInformation({ ...courseBase, instruction_language: language });
    assert.ok(missing.includes('שפת הדרכה'), `language=${language}`);
  }
  assert.ok(!missingCourseInformation({ ...courseBase, instruction_language: 'he' }).includes('שפת הדרכה'));
});

test('null instruction language keeps course out of recommendation until loaded', () => {
  const result = calculateCourseSchedule({
    activities: [{ ...courseBase, instruction_language: null }],
    instructors: [instructor],
    profiles: { 1: heProfile },
    rules: { 1: rules },
    exceptions: {}
  })[0];
  assert.equal(result, undefined);
});

test('instructor without Hebrew fails default Hebrew course', () => {
  const result = evaluateInstructor({
    instructor,
    profile: arProfile,
    rules,
    activity: { ...courseBase, instruction_language: null }
  });
  assert.equal(result.eligible, false);
  assert.match(result.failures.join('|'), /עברית/);
});

test('explicit Arabic still requires an Arabic-speaking instructor', () => {
  const hebrewOnly = evaluateInstructor({
    instructor,
    profile: heProfile,
    rules,
    activity: { ...courseBase, instruction_language: 'ar' }
  });
  assert.equal(hebrewOnly.eligible, false);
  assert.match(hebrewOnly.failures.join('|'), /ערבית/);

  const arabicLabel = evaluateInstructor({
    instructor,
    profile: arProfile,
    rules,
    activity: { ...courseBase, instruction_language: 'ערבית' }
  });
  assert.equal(arabicLabel.eligible, true);

  const arabicCode = evaluateInstructor({
    instructor,
    profile: { ...arProfile, instruction_languages: ['ערבית'] },
    rules,
    activity: { ...courseBase, instruction_language: 'ar' }
  });
  assert.equal(arabicCode.eligible, true);
});

test('profileSpeaksLanguage matches canonical and Hebrew labels', () => {
  assert.equal(profileSpeaksLanguage(['עברית'], 'he'), true);
  assert.equal(profileSpeaksLanguage(['he'], 'עברית'), true);
  assert.equal(profileSpeaksLanguage(['ar'], 'he'), false);
});

test('course details UI does not show course missing instruction language as ready', () => {
  assert.equal(instructionLanguageLabel({ instruction_language: null }), 'עברית');
  assert.equal(instructionLanguageLabel({ instruction_language: 'ar' }), 'ערבית');
  const html = courseSchedulingScreen.render({
    activities: [{
      ...courseBase,
      instruction_language: null,
      start_date: '2027-09-05',
      date_1: '2027-09-05'
    }],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, {
    state: {
      user: { role: 'admin' },
      courseSchedulingTab: 'courses',
      courseSchedulingSelectedId: 'lang-1'
    }
  });
  assert.match(html, /אין קורסים|חסרי מידע/);
});
