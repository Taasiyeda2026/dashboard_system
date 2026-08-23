import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('frontend/src/screens/shared/activity-time-options.js', 'utf8');

test('activity drawer keeps start/end as clear select controls', () => {
  assert.match(source, /activity-inline-time-editor/);
  assert.match(source, /התחלה/);
  assert.match(source, /סיום/);
  assert.match(source, /משך:/);
  assert.match(source, /optionMinutes <= startMinutes/);
  assert.match(source, /data-activity-time-select/);
});
