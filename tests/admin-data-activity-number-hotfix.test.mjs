import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hotfixSrc = fs.readFileSync(new URL('../frontend/src/admin-data-activity-number-hotfix.js', import.meta.url), 'utf8');
const bootstrapSrc = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('admin data district summary groups by activity_no before display name', () => {
  assert.match(hotfixSrc, /activity\?\.activity_no/);
  assert.match(hotfixSrc, /activity\?\.gefen_number/);
  assert.match(hotfixSrc, /const key = number \? `number:\$\{number\}` : `name:\$\{name\}`/);
  assert.match(hotfixSrc, /row\.quantity \+= 1/);
  assert.match(hotfixSrc, /row\.amount \+= money\(activity\?\.price\)/);
});

test('admin data district summary requests activity_no and sorts numbered activities numerically', () => {
  assert.match(hotfixSrc, /activity_no,gefen_number/);
  assert.match(hotfixSrc, /return aNumber - bNumber/);
});

test('admin data number grouping hotfix is loaded after the base admin data tool', () => {
  const baseIndex = bootstrapSrc.indexOf("./admin-data-tool.js?v=20260823-v2");
  const hotfixIndex = bootstrapSrc.indexOf("./admin-data-activity-number-hotfix.js?v=20260823-v1");
  assert.ok(baseIndex >= 0);
  assert.ok(hotfixIndex > baseIndex);
});
