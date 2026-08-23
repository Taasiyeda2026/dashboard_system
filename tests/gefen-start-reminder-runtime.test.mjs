import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../frontend/src/gefen-start-reminder-runtime.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260823054500_add_gefen_start_reminder_acknowledgements.sql', import.meta.url), 'utf8');

test('Gefen reminder targets 2027 Gefen-only activities within ten days', () => {
  assert.match(runtime, /const REMINDER_YEAR = 2027/);
  assert.match(runtime, /const REMINDER_LEAD_DAYS = 10/);
  assert.match(runtime, /normalizeFunding\(activity\?\.funding\) === 'גפן'/);
  assert.match(runtime, /daysUntilStart >= 0 && daysUntilStart <= REMINDER_LEAD_DAYS/);
  assert.match(runtime, /start_date,date_1/);
});

test('Gefen reminder is shown to all authenticated dashboard users except instructors', () => {
  assert.match(runtime, /role !== 'instructor'/);
  assert.match(runtime, /isEligibleReminderUser\(state\?\.user\)/);
  assert.match(runtime, /האם עדכנתם תאריכים ואישרתם פעילות במערכת הגפן\?/);
  assert.match(runtime, /אישור והמשך עבודה/);
});

test('Gefen reminders are grouped into one popup with a single acknowledgement action', () => {
  assert.match(runtime, /function reminderDialogHtml\(activities, today\)/);
  assert.match(runtime, /activities\.map\(\(activity\) =>/);
  assert.match(runtime, /data-gefen-reminder-count/);
  assert.match(runtime, /const acknowledgementRows = activities\.map/);
  assert.match(runtime, /\.insert\(acknowledgementRows\)/);
  assert.match(runtime, /await showAndAcknowledgeReminders\(dueReminders, authUserId, today\)/);
  assert.doesNotMatch(runtime, /for \(const activity of dueReminders\)/);
});

test('Gefen reminder acknowledgement remains per activity and per authenticated user', () => {
  assert.match(migration, /primary key \(activity_id, user_id\)/i);
  assert.match(migration, /auth\.uid\(\).*user_id/s);
  assert.match(runtime, /activity_id: activity\.id/);
  assert.match(runtime, /user_id: authUserId/);
});

test('Gefen reminder runtime is loaded by the application shell', () => {
  assert.match(indexHtml, /gefen-start-reminder-runtime\.js\?v=20260823-v3/);
});
