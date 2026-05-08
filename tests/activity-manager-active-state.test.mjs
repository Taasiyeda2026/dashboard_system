import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityManagerDisplayName,
  getManagerUsers,
  NO_ACTIVITY_MANAGER_LABEL
} from '../frontend/src/screens/shared/activity-options.js';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';
import { collectFilterOptions } from '../frontend/src/screens/shared/activity-list-filters.js';

test('activity manager options include only active managers', () => {
  const settings = {
    dropdown_options: {
      activities_manager_users: [
        { name: 'מנהלת פעילה', is_active: true },
        { name: 'מנהל שעזב', is_active: false },
        { name: 'מנהלת פעילה 2', active: 'yes' },
        { name: 'מנהל כבוי', active: 'no' },
        { name: NO_ACTIVITY_MANAGER_LABEL, is_active: true },
        { name: 'unassigned', is_active: true }
      ]
    }
  };

  assert.deepEqual(getManagerUsers(settings), ['מנהלת פעילה', 'מנהלת פעילה 2']);
});

test('blank and textual null manager values are displayed as no manager', () => {
  for (const value of ['', '   ', null, undefined, 'NULL', 'null', 'undefined', 'unassigned', NO_ACTIVITY_MANAGER_LABEL]) {
    assert.equal(activityManagerDisplayName(value), NO_ACTIVITY_MANAGER_LABEL);
  }
});

test('existing inactive manager stays visible in the activity drawer history', () => {
  const html = activityWorkDrawerHtml(
    {
      RowID: 'A-1',
      activity_manager: 'מנהל שעזב',
      activity_type: 'course',
      status: 'active'
    },
    {
      settings: {
        dropdown_options: {
          activities_manager_users: [
            { name: 'מנהלת פעילה', is_active: true },
            { name: 'מנהל שעזב', is_active: false }
          ]
        }
      }
    }
  );

  assert.match(html, />מנהל שעזב</);
  assert.match(html, /<option value="מנהל שעזב" selected>מנהל שעזב<\/option>/);
  assert.match(html, /<option value="מנהלת פעילה">מנהלת פעילה<\/option>/);
});

test('no manager is collected as a separate filter category', () => {
  const rows = [{ activity_manager: 'מנהלת פעילה' }, { activity_manager: '   ' }, { activity_manager: 'null' }];
  const options = collectFilterOptions(rows, [
    { key: 'activity_manager', getValues: (row) => [activityManagerDisplayName(row.activity_manager)] }
  ]);

  assert.deepEqual(options.activity_manager, [NO_ACTIVITY_MANAGER_LABEL, 'מנהלת פעילה']);
});
