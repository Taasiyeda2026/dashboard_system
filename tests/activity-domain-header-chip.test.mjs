import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('activity domain stays editable without exposing internal E/Y codes in view mode', async () => {
  const detail = await readFile(
    new URL('frontend/src/screens/shared/activity-detail-html.js', ROOT),
    'utf8'
  );

  const headerStart = detail.indexOf('function headerHtml');
  const headerEnd = detail.indexOf('function blockActivityDetails');
  const headerSource = detail.slice(headerStart, headerEnd);
  assert.doesNotMatch(headerSource, /domainVal|domainRaw|activity_domain/);
  assert.match(detail, /name: 'activity_domain'/);
  assert.match(detail, /'תחום פעילות',[\s\S]*name: 'activity_domain'/);
});
