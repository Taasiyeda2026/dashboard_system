import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrintKitSummary,
  isActiveInstructor,
  resolveCourseForActivity,
  resolveWorkshopStockKey,
  splitKitHoldersByActivity,
  trainingCellState
} from '../frontend/src/screens/shared/operations-2027-domain.js';

test('resolveCourseForActivity follows gefen matching order and does not use course_id', () => {
  const courses = [
    { id: 'wrong-id', gefen_number: '100', short_name: 'שם אחר', full_name: 'שם אחר מלא' },
    { id: 'by-activity-no', gefen_number: '200', short_name: 'קורס פעילות', full_name: 'קורס פעילות מלא' },
    { id: 'by-gefen', gefen_number: '300', short_name: 'קורס גפן', full_name: 'קורס גפן מלא' },
    { id: 'by-name', gefen_number: '400', short_name: 'שם מנורמל', full_name: 'שם מנורמל מלא' }
  ];

  assert.equal(resolveCourseForActivity({ course_id: 'wrong-id', activity_no: '200', gefen_number: '300', short_name: 'שם מנורמל' }, courses)?.id, 'by-activity-no');
  assert.equal(resolveCourseForActivity({ course_id: 'wrong-id', gefen_number: '300', short_name: 'שם מנורמל' }, courses)?.id, 'by-gefen');
  assert.equal(resolveCourseForActivity({ course_id: 'wrong-id', short_name: 'שם מנורמל' }, courses)?.id, 'by-name');
});

test('resolveCourseForActivity leaves premium AI entrepreneurship fixture unmatched without identifiers or exact name', () => {
  const courses = [
    { id: 'ai', gefen_number: '501', short_name: 'בינה מלאכותית', full_name: 'בינה מלאכותית' },
    { id: 'entrepreneurship', gefen_number: '502', short_name: 'יזמות פרימיום', full_name: 'יזמות פרימיום' }
  ];

  const activity = {
    activity_name: 'בינה מלאכותית-יזמות פרימיום',
    activity_no: null,
    gefen_number: null
  };

  assert.equal(resolveCourseForActivity(activity, courses), null);
});

test('trainingCellState maps trained and assigned flags to the display contract', () => {
  assert.deepEqual(trainingCellState({ trained: true, assigned: false }), { text: '✓', tone: 'green', state: 'trained' });
  assert.deepEqual(trainingCellState({ trained: false, assigned: true }), { text: '✕', tone: 'red', state: 'assigned_untrained' });
  assert.deepEqual(trainingCellState({ trained: false, assigned: false }), { text: '', tone: 'empty', state: 'empty' });
});

test('isActiveInstructor recognizes boolean and text active states', () => {
  assert.equal(isActiveInstructor(true), true);
  assert.equal(isActiveInstructor('yes'), true);
  assert.equal(isActiveInstructor('active'), true);
  assert.equal(isActiveInstructor('פעיל'), true);
  assert.equal(isActiveInstructor(false), false);
  assert.equal(isActiveInstructor('no'), false);
  assert.equal(isActiveInstructor('inactive'), false);
  assert.equal(isActiveInstructor('לא פעיל'), false);
});

test('splitKitHoldersByActivity classifies distribution rows with separate activeInstructors by normalized names', () => {
  const holders = [
    { instructor_name: 'מדריך פעיל' },
    { instructor_name: 'מדריך לא פעיל' },
    { instructor_name: 'מדריך חסר' },
    { instructor_name: 'מסונן', has_print_kit: false },
    { instructor_name: '' }
  ];

  const activeInstructors = [
    { full_name: 'מדריך פעיל', active: 'yes' },
    { full_name: 'מדריך לא פעיל', active: 'no' }
  ];

  assert.deepEqual(splitKitHoldersByActivity(holders, activeInstructors), {
    active: [holders[0]],
    inactive: [holders[1], holders[2]]
  });
});

test('buildPrintKitSummary includes all locations and holder groups without double counting holders', () => {
  const summary = buildPrintKitSummary({
    warehouse: 3,
    hila: 2,
    idan: 1,
    gil: 4,
    holders: [
      { id: 'distribution-a-1', instructor_name: 'מדריך א' },
      { id: 'distribution-a-2', instructor_name: '  מדריך   א  ' },
      { id: 'distribution-b-1', instructor_name: 'מדריך ב' },
      { id: 'distribution-c-1', instructor_name: '' },
      { id: 'distribution-d-1', instructor_name: 'מדריך ד', has_print_kit: false }
    ],
    activeInstructors: [
      { full_name: 'מדריך א', active: 'yes' },
      { full_name: 'מדריך ב', active: 'no' },
      { full_name: '', active: 'yes' }
    ]
  });

  assert.deepEqual(summary, {
    warehouse: 3,
    hila: 2,
    idan: 1,
    gil: 4,
    activeInstructorKits: 1,
    inactiveInstructorKits: 1,
    totalUnique: 12
  });
});

test('resolveWorkshopStockKey uses stock_group_key, activity_no, explicit aliases and only then normalized names', () => {
  const aliases = {
    'פרוגי המקפצת': 'froggy',
    'ציפור שיווי משקל': 'bird-balance',
    'קלידוסקופ': 'kaleidoscope',
    'שעון רובוט - הזמן שלנו': 'robot-clock'
  };

  assert.equal(resolveWorkshopStockKey({ stock_group_key: 'manual-key', activity_no: '900', short_name: 'פרוגי המקפצת' }, { aliases }), 'manual-key');
  assert.equal(resolveWorkshopStockKey({ activity_no: '900', short_name: 'פרוגי המקפצת' }, { aliases }), '900');
  assert.equal(resolveWorkshopStockKey({ short_name: 'פרוגי המקפצת' }, { aliases }), 'froggy');
  assert.equal(resolveWorkshopStockKey({ short_name: 'ציפור שיווי משקל' }, { aliases }), 'bird-balance');
  assert.equal(resolveWorkshopStockKey({ short_name: 'קלידוסקופ' }, { aliases }), 'kaleidoscope');
  assert.equal(resolveWorkshopStockKey({ short_name: 'שעון רובוט - הזמן שלנו' }, { aliases }), 'robot-clock');
  assert.notEqual(resolveWorkshopStockKey({ short_name: 'פרוגי' }, { aliases }), resolveWorkshopStockKey({ short_name: 'פרוגי המקפצת' }, { aliases }));
  assert.notEqual(resolveWorkshopStockKey({ short_name: 'ציפור' }, { aliases }), resolveWorkshopStockKey({ short_name: 'ציפור שיווי משקל' }, { aliases }));
  assert.notEqual(resolveWorkshopStockKey({ short_name: 'קליידסקופ' }, { aliases }), resolveWorkshopStockKey({ short_name: 'קלידוסקופ' }, { aliases }));
  assert.notEqual(resolveWorkshopStockKey({ short_name: 'שעון רובוט' }, { aliases }), resolveWorkshopStockKey({ short_name: 'שעון רובוט - הזמן שלנו' }, { aliases }));
});
