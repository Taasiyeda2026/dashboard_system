import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../frontend/public/summer-feedback/admin-response-view.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/public/summer-feedback/admin-response-view.css', import.meta.url), 'utf8');

test('summer feedback loads the admin response viewer and its styles', () => {
  assert.ok(html.includes('href="./admin-response-view.css"'));
  assert.ok(html.includes('src="./admin-response-view.js"'));
});

test('admin response viewer is restricted to an active admin and reads saved feedback data', () => {
  assert.ok(viewer.includes(".from('users')"));
  assert.ok(viewer.includes("normalizeRole(userRecord?.role) !== 'admin'"));
  assert.ok(viewer.includes('userRecord?.is_active !== true'));
  assert.ok(viewer.includes(".from('summer_feedback_responses')"));
  assert.ok(viewer.includes(".from('summer_feedback_activity_ratings')"));
  assert.ok(viewer.includes(".from('summer_feedback_assignments')"));
});

test('admin button opens actual saved answers in read-only mode instead of a blank preview', () => {
  assert.ok(viewer.includes("button.textContent = available ? 'צפייה בתשובות' : 'אין תשובות עדיין'"));
  assert.ok(viewer.includes('const response = data.responses.find'));
  assert.ok(viewer.includes('const ratings = data.ratings.filter'));
  assert.ok(viewer.includes('renderResponseView(selected)'));
  assert.ok(viewer.includes('מוצגות התשובות שנשמרו'));
  assert.ok(viewer.includes('מצב קריאה בלבד'));
  assert.equal(viewer.includes("state.response = {\n    id: 'preview'"), false);
});

test('admin response viewer performs no feedback writes', () => {
  assert.equal(viewer.includes('.insert('), false);
  assert.equal(viewer.includes('.update('), false);
  assert.equal(viewer.includes('.upsert('), false);
  assert.ok(styles.includes('.admin-response-question'));
  assert.ok(styles.includes('button[data-preview][disabled]'));
});
