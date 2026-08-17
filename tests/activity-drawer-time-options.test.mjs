import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityTimeOptions, syncActivityEndTimeOptions } from '../frontend/src/screens/shared/activity-time-options.js';

test('activity time options are chronological and end options start at the selected start time', () => {
  assert.deepEqual(activityTimeOptions().slice(0, 5), ['00:00', '00:15', '00:30', '00:45', '01:00']);
  assert.deepEqual(activityTimeOptions({ minimum: '10:00' }).slice(0, 4), ['10:00', '10:15', '10:30', '10:45']);
  assert.deepEqual(activityTimeOptions({ selected: '10:22' }).filter((time) => time.startsWith('10:')), ['10:00', '10:15', '10:22', '10:30', '10:45']);
});

test('changing start time keeps a valid end time and clamps an earlier end immediately', () => {
  const document = new JSDOM('<select name="start_time"><option>10:00</option></select><select name="end_time"><option>09:30</option></select>').window.document;
  const start = document.querySelector('[name="start_time"]');
  const end = document.querySelector('[name="end_time"]');
  assert.equal(syncActivityEndTimeOptions(start, end), '10:00');
  assert.equal(end.options[0].value, '10:00');

  end.value = '11:30';
  start.replaceChildren(Object.assign(document.createElement('option'), { value: '10:30', textContent: '10:30' }));
  assert.equal(syncActivityEndTimeOptions(start, end), '11:30');
});
