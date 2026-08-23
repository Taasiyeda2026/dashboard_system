import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const popupRuntime = await readFile(new URL('../frontend/src/staff-message-popup-runtime.js', import.meta.url), 'utf8');
const adminRuntime = await readFile(new URL('../frontend/src/admin-messages-runtime.js', import.meta.url), 'utf8');
const cardRuntime = await readFile(new URL('../frontend/src/admin-messages-card-runtime.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260823061500_add_staff_messages.sql', import.meta.url), 'utf8');

test('admin management hub gets a Messages card that is admin-only', () => {
  assert.match(cardRuntime, /<strong>הודעות<\/strong>/);
  assert.match(cardRuntime, /יצירה ותזמון הודעות לעובדים/);
  assert.match(cardRuntime, /toLowerCase\(\) === 'admin'/);
  assert.match(cardRuntime, /admin-management-grid/);
  assert.match(cardRuntime, /openAdminMessagesManager/);
});

test('admin message form stays intentionally simple', () => {
  assert.match(adminRuntime, /כותרת/);
  assert.match(adminRuntime, /תוכן ההודעה/);
  assert.match(adminRuntime, /חד־פעמית/);
  assert.match(adminRuntime, /כל חודש/);
  assert.match(adminRuntime, /שעה/);
  assert.match(adminRuntime, /חשיבות/);
  assert.match(adminRuntime, /קהל יעד: כל העובדים ללא מדריכים/);
  assert.match(adminRuntime, /רגילה/);
  assert.match(adminRuntime, /חשובה/);
  assert.match(adminRuntime, /קריטית/);
});

test('employees only see title, body and an approval button', () => {
  assert.match(popupRuntime, /staff-message-popup-title/);
  assert.match(popupRuntime, /staff-message-popup-text/);
  assert.match(popupRuntime, />אישור<\/button>/);
  assert.doesNotMatch(popupRuntime, /data-message-edit/);
  assert.match(popupRuntime, /role !== 'instructor'/);
});

test('overdue messages queue in priority then scheduled-time order', () => {
  assert.match(popupRuntime, /IMPORTANCE_RANK/);
  assert.match(popupRuntime, /importanceDiff/);
  assert.match(popupRuntime, /a\.dueAt\.localeCompare\(b\.dueAt\)/);
  assert.match(popupRuntime, /for \(const item of pending\)/);
  assert.match(popupRuntime, /messageOccurrenceDates/);
  assert.match(popupRuntime, /scheduleType === 'monthly'/);
});

test('acknowledgements are per user, message and occurrence', () => {
  assert.match(migration, /primary key \(message_id, user_id, occurrence_date\)/i);
  assert.match(popupRuntime, /message_id: item\.message\.id/);
  assert.match(popupRuntime, /user_id: authUserId/);
  assert.match(popupRuntime, /occurrence_date: item\.occurrenceDate/);
});

test('Supabase tables use RLS and explicit Data API grants', () => {
  assert.match(migration, /alter table public\.staff_messages enable row level security/i);
  assert.match(migration, /alter table public\.staff_message_acknowledgements enable row level security/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.staff_messages to authenticated/i);
  assert.match(migration, /grant select, insert on table public\.staff_message_acknowledgements to authenticated/i);
  assert.match(migration, /app_current_role\(\).*'admin'/s);
  assert.match(migration, /not in \('', 'instructor'\)/);
});

test('staff message runtimes are loaded and cache is bumped', () => {
  assert.match(indexHtml, /admin-messages-card-runtime\.js\?v=20260823-v1/);
  assert.match(indexHtml, /staff-message-popup-runtime\.js\?v=20260823-v1/);
  assert.match(sw, /const CACHE_VERSION = 1592/);
});
