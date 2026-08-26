import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSchedulingInputScope,
  schedulingCourses
} from '../frontend/src/screens/course-scheduling-engine.js';

function readyCourse({ id, district, authority }) {
  return {
    row_id: id,
    activity_season: 'school_2027',
    activity_type: 'course',
    status: 'פתוח',
    school: `בית ספר ${id}`,
    school_id: id === 'south' ? 1 : 2,
    school_address: district === 'דרום' ? 'באר שבע' : 'חיפה',
    authority,
    district,
    activity_name: 'קורס בדיקה',
    instruction_language: 'he',
    start_time: '10:00',
    end_time: '11:00',
    date_1: '2026-10-01'
  };
}

test('ordinary district-only UI scope is carried into the planning engine', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, '[data-district-filter]');
      return { value: 'דרום' };
    }
  };

  try {
    const input = resolveSchedulingInputScope({ periodKey: 'h1', authority: '' });
    assert.equal(input.district, 'דרום');

    const courses = schedulingCourses([
      readyCourse({ id: 'south', district: 'דרום', authority: 'אופקים' }),
      readyCourse({ id: 'north', district: 'צפון', authority: 'חיפה' })
    ], input);
    assert.deepEqual(courses.map((course) => course.row_id), ['south']);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('explicit district used by district simulation is preserved', () => {
  const input = resolveSchedulingInputScope({ district: 'צפון', authority: '' });
  assert.equal(input.district, 'צפון');
});

test('authority-scoped calculation is not coupled to the DOM district fallback', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: () => ({ value: 'דרום' }) };
  try {
    const input = resolveSchedulingInputScope({ authority: 'חיפה' });
    assert.equal(input.authority, 'חיפה');
    assert.equal(Object.hasOwn(input, 'district'), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
