import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogActivityChangesFromRows } from '../frontend/src/activity-catalog-identity.js';

test('Gefen course save uses proposal short name when lists has a different long name', () => {
  const changes = catalogActivityChangesFromRows({
    selection: {
      activity_name: 'בינה מלאכותית',
      activity_no: '9545',
      gefen_number: '9545'
    },
    listRow: {
      activity_name: 'סודות ויסודות הבינה המלאכותית',
      label: 'סודות ויסודות הבינה המלאכותית',
      activity_no: '9545',
      gefen_number: '9545',
      activity_type: 'course'
    },
    pricingRow: {
      activity_name: 'סודות ויסודות הבינה המלאכותית',
      activity_no: '9545',
      gefen_number: '9545',
      item_type: 'course',
      meetings_count: 8
    },
    courseRow: {
      gefen_number: '9545',
      short_name: 'בינה מלאכותית',
      meetings_count: '8.00'
    }
  });

  assert.equal(changes.activity_name, 'בינה מלאכותית');
  assert.equal(changes.activity_no, '9545');
  assert.equal(changes.gefen_number, '9545');
  assert.equal(changes.sessions, 8);
  assert.equal(changes.activity_type, 'course');
  assert.equal(changes.item_type, 'course');
});
