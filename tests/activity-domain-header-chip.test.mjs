import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';

const ROOT = new URL('../', import.meta.url);

function headerOnly(row, opts = {}) {
  return activityWorkDrawerHtml(row, { exportAction: false, ...opts })
    .split('<div class="activity-drawer__body">')[0];
}

test('activity domain appears in the top header as E or Y only', () => {
  const base = {
    activity_name: 'טכנולוגיות החלל',
    activity_type: 'course',
    status: 'open',
    authority: 'אום אל-פחם',
    school: 'אלחיאם',
    activity_season: 'school_2027'
  };

  assert.match(headerOnly({ ...base, activity_domain: 'E' }), />E<\/span>/);
  assert.match(headerOnly({ ...base, activity_domain: 'y' }), />Y<\/span>/);
  assert.doesNotMatch(headerOnly({ ...base, activity_domain: 'X' }), />X<\/span>/);
  assert.doesNotMatch(headerOnly({ ...base, activity_domain: '' }), /activity-drawer__meta-tag--domain/);
  assert.doesNotMatch(headerOnly({ ...base, activity_domain: 'E' }, { instructorLimited: true }), /activity-drawer__meta-tag--domain/);
});

test('activity domain remains editable in the 2027 activity form', async () => {
  const detail = await readFile(
    new URL('frontend/src/screens/shared/activity-detail-html.js', ROOT),
    'utf8'
  );

  assert.match(detail, /name: 'activity_domain'/);
  assert.match(detail, /'תחום פעילות',[\s\S]*name: 'activity_domain'/);
});
