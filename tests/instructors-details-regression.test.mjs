import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInstructorActivityDetailsForMonth,
  instructorsScreen
} from '../frontend/src/screens/instructors.js';

test('instructor details keep two distinct activities with same name, school and authority', () => {
  const rows = [
    { RowID: 'A-1', emp_id: 'EMP-1', activity_name: 'חוג מדעים', school: 'בית ספר א', authority: 'רשות א', date_1: '2026-05-04' },
    { RowID: 'A-2', emp_id: 'EMP-1', activity_name: 'חוג מדעים', school: 'בית ספר א', authority: 'רשות א', date_1: '2026-05-11' }
  ];

  const items = buildInstructorActivityDetailsForMonth(rows, {
    empId: 'EMP-1',
    instrName: 'מדריך בדיקה',
    targetYm: '2026-05'
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.activity_name), ['חוג מדעים', 'חוג מדעים']);
});

test('instructor details match activities by normalized instructor_name when emp_id is missing', () => {
  const rows = [{
    RowID: 'NAME-1',
    emp_id: '',
    emp_id_2: '',
    instructor_name: '  מדריך   בדיקה  ',
    activity_name: 'סיור שם בלבד',
    school: 'בית ספר ב',
    authority: 'רשות ב',
    date_1: '2026-05-07'
  }];

  const items = buildInstructorActivityDetailsForMonth(rows, {
    empId: 'מדריך בדיקה',
    instrName: 'מדריך בדיקה',
    targetYm: '2026-05'
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].activity_name, 'סיור שם בלבד');
});

test('instructor details use date_2/date_3 meeting dates and dedupe only by row_id/RowID', () => {
  const rows = [
    {
      RowID: 'MEET-1',
      emp_id: 'EMP-2',
      activity_name: 'פעילות מפגשים',
      school: 'בית ספר ג',
      authority: 'רשות ג',
      date_2: '2026-05-14'
    },
    {
      row_id: 'MEET-2',
      emp_id: 'EMP-2',
      activity_name: 'פעילות מפגשים',
      school: 'בית ספר ג',
      authority: 'רשות ג',
      date_3: '2026-05-21'
    },
    {
      row_id: 'MEET-2',
      emp_id: 'EMP-2',
      activity_name: 'פעילות מפגשים כפולה טכנית',
      school: 'בית ספר ג',
      authority: 'רשות ג',
      date_3: '2026-05-28'
    }
  ];

  const items = buildInstructorActivityDetailsForMonth(rows, {
    empId: 'EMP-2',
    instrName: 'מדריך מפגשים',
    targetYm: '2026-05'
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.activity_name), ['פעילות מפגשים', 'פעילות מפגשים']);
});

test('instructor details cache is keyed by instructor and selected month', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
    url: 'http://localhost/'
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;

  const state = {
    activityListFilters: {},
    _instrDateFilter: { from: '2026-05' },
    instructorsActivityDetailsCache: {}
  };
  const data = {
    rows: [{
      emp_id: 'EMP-3',
      full_name: 'מדריך מטמון',
      programs_count: 1,
      one_day_count: 0,
      earliest_start_date: '2026-05-01',
      latest_end_date: '2026-06-30',
      activity_type_counts: { course: 1 }
    }]
  };
  const root = document.getElementById('root');
  root.innerHTML = instructorsScreen.render(data, { state });

  let calls = 0;
  const api = {
    activities: async () => {
      calls += 1;
      return {
        rows: [{
          RowID: `CACHE-${calls}`,
          emp_id: 'EMP-3',
          activity_name: `פעילות חודש ${calls}`,
          school: 'בית ספר ד',
          authority: 'רשות ד',
          date_1: calls === 1 ? '2026-05-03' : '2026-06-03'
        }]
      };
    }
  };

  instructorsScreen.bind({ root, data, state, rerender: () => {}, api });
  const button = root.querySelector('[data-instructor-card="EMP-3"]');

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  state._instrDateFilter.from = '2026-06';
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls, 2);
  assert.ok(Array.isArray(state.instructorsActivityDetailsCache['EMP-3:2026-05']));
  assert.ok(Array.isArray(state.instructorsActivityDetailsCache['EMP-3:2026-06']));
  assert.equal(state.instructorsActivityDetailsCache['EMP-3:2026-05'][0].activity_name, 'פעילות חודש 1');
  assert.equal(state.instructorsActivityDetailsCache['EMP-3:2026-06'][0].activity_name, 'פעילות חודש 2');
});
