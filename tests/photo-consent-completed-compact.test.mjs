import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  photoConsentActivityCompleted,
  photoConsentIsraelToday,
  splitPhotoConsentActivities
} from '../frontend/src/screens/shared/photo-consent-completion.js';

const SCREEN = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);

test('use the Israel civil day for deciding when a school activity ended', () => {
  assert.equal(photoConsentIsraelToday(new Date('2026-10-11T18:30:00.000Z')), '2026-10-11');
  assert.equal(photoConsentIsraelToday(new Date('2026-10-11T21:30:00.000Z')), '2026-10-12');
});

test('completed activity classification is based on end date, without archiving future activities', () => {
  assert.equal(photoConsentActivityCompleted({ end_date: '2026-09-30', status: 'סגור' }, '2026-10-11'), true);
  assert.equal(photoConsentActivityCompleted({ end_date: '2026-10-11', status: 'סגור' }, '2026-10-11'), false);
  assert.equal(photoConsentActivityCompleted({ end_date: '2026-12-06', status: 'סגור' }, '2026-10-11'), false);
  assert.equal(photoConsentActivityCompleted({ end_date: '2026-12-06', status: 'פתוח' }, '2026-10-11'), false);
  assert.equal(photoConsentActivityCompleted({ end_date: null, status: 'הסתיים' }, '2026-10-11'), true);
  assert.equal(photoConsentActivityCompleted({ end_date: null, status: 'פתוח' }, '2026-10-11'), false);
});

test('finished rows are excluded from the active table and sorted by latest end date', () => {
  const rows = [
    { id: 1, start_date: '2026-09-30', end_date: '2026-09-30', status: 'סגור' },
    { id: 2, start_date: '2026-10-06', end_date: '2026-12-06', status: 'פתוח' },
    { id: 3, start_date: '2026-10-01', end_date: '2026-10-02', status: 'סגור' },
    { id: 4, start_date: '2026-10-12', end_date: '2027-01-01', status: 'פתוח' }
  ];
  const { current, completed } = splitPhotoConsentActivities(rows, '2026-10-11');
  assert.deepEqual(current.map((r) => r.id), [2, 4]);
  assert.deepEqual(completed.map((r) => r.id), [3, 1]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4], 'classification should not mutate input');
});

test('management headers stay right aligned, with only the last-update date centered', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /\.pc-table th\{[^']*text-align:right/);
  assert.match(source, /\.pc-table th\.pc-date-th,\.pc-table td\.pc-date\{text-align:center\}/);
  assert.match(source, /<th class="pc-date-th">עדכון אחרון<\/th>/);
  assert.match(source, /class="pc-date"/);
  assert.match(source, /photoConsentSchoolManagementGroups/);
  assert.doesNotMatch(source, /completedOpen: false/);
  assert.doesNotMatch(source, /data-pc-completed-toggle/);
  assert.doesNotMatch(source, /data-pc-upload/);
  assert.match(source, /data-pc-replace/);
});
