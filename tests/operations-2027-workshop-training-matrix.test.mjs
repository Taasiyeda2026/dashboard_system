import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkshopTrainingMatrix } from '../frontend/src/screens/operations-summer-training-matrix.js';

function fixture(overrides = {}) {
  return {
    instructors: [
      { full_name: 'מדריך פעיל א', active: true },
      { full_name: 'מדריך פעיל ב', active: 'yes' },
      { full_name: 'מדריך לא פעיל', active: 'no' }
    ],
    catalogRows: [
      { category: 'activity_names', type: 'workshop', active: true, activity_no: '001', activity_name: 'סדנה פעילה', stock_group_key: 'active-a' },
      { category: 'activity_names', activity_type: 'workshop', active: 'yes', activity_no: '002', activity_name: 'סדנה ללא היסטוריה', stock_group_key: 'active-b' },
      { category: 'activity_names', type: 'course', active: true, activity_no: '003', activity_name: 'לא סדנה' }
    ],
    trainings: [
      { workshop_name: 'סדנה היסטורית', instructor_name: 'מדריך פעיל א', is_trained: true },
      { workshop_name: 'סדנה פעילה', instructor_name: 'מדריך פעיל ב', is_trained: false },
      { workshop_name: 'סדנת מדריך לא פעיל', instructor_name: 'מדריך לא פעיל', is_trained: true }
    ],
    activities: [
      { activity_season: 'school_2027', activity_type: 'workshop', activity_no: '001', activity_name: 'סדנה פעילה', instructor_name: 'מדריך פעיל ב' }
    ],
    ...overrides
  };
}

function cell(matrix, workshopName, instructorName) {
  const workshop = matrix.workshops.find((item) => item.name === workshopName);
  assert.ok(workshop, `missing workshop ${workshopName}`);
  const key = `${workshop.key}::${instructorName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return {
    trained: matrix.trainingMap.get(key) === true,
    assigned: matrix.assignedPairs.has(key)
  };
}

test('workshop training matrix shows active instructors only and recognizes yes/no activity states', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture());
  assert.deepEqual(matrix.rows, ['מדריך פעיל א', 'מדריך פעיל ב']);
  assert.equal(matrix.rows.includes('מדריך לא פעיל'), false);
});

test('workshop training matrix includes active catalog workshops and historical workshops for active instructors without 2027 activities', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture({ activities: [] }));
  assert.deepEqual(matrix.workshops.map((item) => item.name).sort(), ['סדנה היסטורית', 'סדנה ללא היסטוריה', 'סדנה פעילה'].sort());
  assert.equal(cell(matrix, 'סדנה היסטורית', 'מדריך פעיל א').trained, true);
  assert.equal(cell(matrix, 'סדנה ללא היסטוריה', 'מדריך פעיל א').assigned, false);
  assert.equal(matrix.assignedPairs.size, 0);
});

test('workshop training cell inputs distinguish trained, assigned untrained, and empty states', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture());
  assert.deepEqual(cell(matrix, 'סדנה היסטורית', 'מדריך פעיל א'), { trained: true, assigned: false });
  assert.deepEqual(cell(matrix, 'סדנה פעילה', 'מדריך פעיל ב'), { trained: false, assigned: true });
  assert.deepEqual(cell(matrix, 'סדנה ללא היסטוריה', 'מדריך פעיל א'), { trained: false, assigned: false });
});

test('inactive instructor training does not create a row or historical workshop column', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture());
  assert.equal(matrix.rows.includes('מדריך לא פעיל'), false);
  assert.equal(matrix.workshops.some((item) => item.name === 'סדנת מדריך לא פעיל'), false);
});

test('deleted, cancelled, and instructorless workshop activities do not create assigned-untrained cells', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture({
    trainings: [],
    activities: [
      { activity_type: 'workshop', activity_no: '001', status: 'נמחק', instructor_name: 'מדריך פעיל א' },
      { activity_type: 'workshop', activity_no: '001', status: 'מבוטל', instructor_name: 'מדריך פעיל ב' },
      { activity_type: 'workshop', activity_no: '001', status: 'פתוח', instructor_name: '' }
    ]
  }));
  assert.equal(matrix.assignedPairs.size, 0);
});

test('instructor_name_2 creates assignment for a valid active instructor', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture({
    trainings: [],
    activities: [{ activity_type: 'workshop', activity_no: '001', status: 'פתוח', instructor_name: '', instructor_name_2: 'מדריך פעיל א' }]
  }));
  assert.deepEqual(cell(matrix, 'סדנה פעילה', 'מדריך פעיל א'), { trained: false, assigned: true });
});

test('workshop matching rejects partial names, applies explicit aliases, and keeps similar unaliased names separate', () => {
  const matrix = buildWorkshopTrainingMatrix(fixture({
    catalogRows: [
      { category: 'activity_names', type: 'workshop', active: true, activity_name: 'פרוגי המקפצת' },
      { category: 'activity_names', type: 'workshop', active: true, activity_name: 'פרוגי' },
      { category: 'activity_names', type: 'workshop', active: true, activity_name: 'שעון רובוט' }
    ],
    trainings: [
      { workshop_name: 'פרוגי המקפצת', instructor_name: 'מדריך פעיל א', is_trained: true },
      { workshop_name: 'שעון רובוט - הזמן שלנו', instructor_name: 'מדריך פעיל א', is_trained: true }
    ],
    activities: [
      { activity_type: 'workshop', activity_name: 'פרוגי', instructor_name: 'מדריך פעיל ב' },
      { activity_type: 'workshop', activity_name: 'שעון רובוט', instructor_name: 'מדריך פעיל ב' }
    ]
  }));
  const names = matrix.workshops.map((item) => item.name);
  assert.ok(names.includes('פרוגי המקפצת'));
  assert.ok(names.includes('פרוגי'));
  assert.ok(names.includes('שעון רובוט'));
  assert.ok(names.includes('שעון רובוט - הזמן שלנו'));
  assert.deepEqual(cell(matrix, 'פרוגי המקפצת', 'מדריך פעיל ב'), { trained: false, assigned: false });
  assert.deepEqual(cell(matrix, 'פרוגי', 'מדריך פעיל ב'), { trained: false, assigned: true });
});

test('workshop training matrix builder is read-only and does not expose write or RPC operations', () => {
  const source = buildWorkshopTrainingMatrix.toString();
  assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.rpc\s*\(/);
});
