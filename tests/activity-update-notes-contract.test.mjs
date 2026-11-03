import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('shared activity updates preserve original notes and use latest-first collapsed history', () => {
  const view = read('frontend/src/activity-update-notes.js');
  const detail = read('frontend/src/screens/shared/activity-detail-html.js');
  const layout = read('frontend/src/activity-drawer-inline-layout.js');
  assert.match(view, /activity_update_notes/);
  assert.match(view, /order\('created_at', \{ ascending: false \}\)/);
  assert.match(view, /create\(doc, 'details'/);
  assert.match(view, /dateHe\(note\.created_at\)/);
  assert.match(view, /note\.author_name/);
  assert.match(view, /notes\[0\], true/);
  assert.match(detail, /מידע נוסף/);
  assert.match(layout, /label\.textContent = 'מידע נוסף'/);
  assert.match(detail, /name: 'notes'/);
});

test('operational notes are restricted to the operations role and excluded from shared data', () => {
  const api = read('frontend/src/api.js');
  const db = read('supabase/migrations/20261104000001_isolate_operations_private_notes.sql');
  assert.match(api, /state\?\.user\?\.role \|\| ''\)\.trim\(\) === 'operation_manager'/);
  assert.match(api, /from\('operations_private_notes'\)/);
  assert.match(db, /app_current_role\(\)='operation_manager'/);
  assert.match(db, /operations_private_notes=null/);
  assert.match(db, /enforce_private_operational_note/);
  assert.doesNotMatch(db, /app_current_role\(\) in \('admin'/);
});

test('note author and timestamp are server assigned', () => {
  const db = read('supabase/migrations/20261104000000_activity_update_notes.sql');
  assert.match(db, /new\.author_auth_user_id:=auth\.uid\(\)/);
  assert.match(db, /new\.created_at:=now\(\)/);
  assert.match(db, /new\.author_name:=v_name/);
});
