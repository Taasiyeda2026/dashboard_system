import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCREEN = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);
const CAMERA_CSS = new URL('../frontend/src/styles/activity-drawer-inline-layout.css', import.meta.url);
const HEADER = new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url);

test('expanded school area contains documents once, without repeated school and course detail headings', async () => {
  const src = await readFile(SCREEN, 'utf8');
  const a = src.indexOf('  function fileRows(group) {');
  const b = src.indexOf('  function operationalNames(names)', a);
  assert.ok(a > 0 && b > a);
  const block = src.slice(a, b);
  assert.match(block, /group\.documents\.map\(\(file\)/);
  assert.match(block, /group\.activityCount > 1/);
  assert.match(block, /safe\(file\.ownerActivity\?\.activity_name/);
  assert.match(block, /safe\(file\.file_name\)/);
  assert.match(block, /class="pc-file-name"/);
  assert.match(block, /data-pc-view/);
  assert.match(block, /data-pc-download/);
  assert.match(block, /data-pc-replace/);
  assert.match(block, /data-pc-delete/);
  assert.doesNotMatch(block, /pc-file-list-title|אישורי צילום ·|מנהל פעילות:|מדריך:/);
  assert.match(src, /pc-file-row:first-child\{border-top:0\}/);
  assert.match(src, /pc-file-context/);
});

test('school name is the sole expand control, with no redundant actions column or toggle button', async () => {
  const src = await readFile(SCREEN, 'utf8');
  assert.match(src, /function schoolButton\(group, expanded\)/);
  assert.match(src, /data-pc-toggle/);
  assert.match(src, /pc-school-chevron/);
  assert.match(src, /<td colspan="6">/);
  assert.match(src, /<th>אישורים<\/th>/);
  assert.doesNotMatch(src, /<th>פעולות<\/th>|הצגת אישורים|const action = '<button type="button" class="pc-action" data-pc-toggle=/);
  assert.match(src, /class="pc-mobile-documents"/);
  assert.match(src, /pc-file-row \.pc-action\{flex:1\}/);
});

test('saved camera uses a dark green circle with precisely centered white SVG', async () => {
  const [css, header] = await Promise.all([readFile(CAMERA_CSS, 'utf8'), readFile(HEADER, 'utf8')]);
  assert.match(css, /activity-drawer__photo-upload \{\s*display: inline-grid !important;\s*place-items: center !important;/);
  assert.match(css, /width: 32px !important;/);
  assert.match(css, /height: 32px !important;/);
  assert.match(css, /padding: 0 !important;/);
  assert.match(css, /border-radius: 50% !important;/);
  assert.match(css, /line-height: 0 !important;/);
  assert.match(css, /activity-drawer__photo-upload svg \{[\s\S]*?display: block !important;[\s\S]*?width: 18px !important;/);
  assert.match(css, /background: #166534 !important;/);
  assert.match(css, /color: #fff !important;/);
  assert.match(css, /stroke: #fff !important;/);
  assert.match(header, /data-activity-photo-upload/);
});
