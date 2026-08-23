import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('activity drawer shows E/Y as a compact header tag and keeps domain editable', async () => {
  const detail = await readFile(
    new URL('frontend/src/screens/shared/activity-detail-html.js', ROOT),
    'utf8'
  );

  assert.match(detail, /const domainRaw = String\(row\?\.activity_domain \|\| ''\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(detail, /const domainVal = \['E', 'Y'\]\.includes\(domainRaw\) \? domainRaw : ''/);
  assert.match(detail, /domainVal \? `<span class="activity-drawer__meta-tag">\$\{escapeHtml\(domainVal\)\}<\/span>` : ''/);
  assert.match(detail, /statusVal[\s\S]*domainVal[\s\S]*authorityVal[\s\S]*schoolVal/);
  assert.match(detail, /name: 'activity_domain'/);
  assert.match(detail, /'תחום פעילות',[\s\S]*name: 'activity_domain'/);
});
