import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../frontend/src/proposal-next-year-approved-fix.js', import.meta.url),
  'utf8'
);

test('workshop metadata is checked before the generic next-year parent group', () => {
  const itemTypeCheck = source.indexOf("if (/סדנ|workshop/.test(itemType)");
  const genericGroupFallback = source.indexOf("if (group === COURSE_GROUP || /course|קורס/.test(group))");
  assert.ok(itemTypeCheck >= 0, 'missing workshop item-type classification');
  assert.ok(genericGroupFallback >= 0, 'missing course group fallback');
  assert.ok(itemTypeCheck < genericGroupFallback, 'generic next-year group must not override workshop metadata');
});

test('the runtime rebuilds tables only when both courses and workshops are selected', () => {
  assert.match(source, /if \(!courses\.length \|\| !workshops\.length\)/);
  assert.match(source, /courseTableHtml\(courses\)\s*\+ workshopTableHtml\(workshops\)/);
  assert.match(source, /pa-next-year-combined-total/);
});

test('refreshes are debounced and protected against duplicate installation', () => {
  assert.match(source, /clearTimeout\(refreshTimer\)/);
  assert.match(source, /if \(refreshRunning\) return/);
  assert.match(source, /if \(document\[INSTALL_KEY\]\) return/);
});
