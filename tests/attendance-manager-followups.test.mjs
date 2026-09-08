import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260908113000_attendance_operation_destination_address.sql', import.meta.url), 'utf8');
const attendanceRuntime = await readFile(new URL('../attendance/src/attendance-followup-runtime.js', import.meta.url), 'utf8');
const attendanceCss = await readFile(new URL('../attendance/src/styles/attendance-followup.css', import.meta.url), 'utf8');
const attendanceIndex = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const managerRuntime = await readFile(new URL('../frontend/src/manager-board-date-state-runtime.js', import.meta.url), 'utf8');
const managerCss = await readFile(new URL('../frontend/src/styles/manager-board-date-state.css', import.meta.url), 'utf8');
const rootIndex = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('time cancellation is a real column beside hours and the old inline editor is retired', () => {
  assert.match(attendanceRuntime, /hours\.insertAdjacentElement\('afterend', cancel\)/);
  assert.match(attendanceRuntime, /cancel\.textContent = 'ביטול זמן'/);
  assert.match(attendanceRuntime, /hours\.insertAdjacentElement\('afterend', cell\)/);
  assert.match(attendanceRuntime, /oldDetail\.style\.display = 'none'/);
  assert.match(attendanceCss, /time cancellation/);
  assert.match(attendanceCss, /grid-template-columns:[\s\S]*time cancellation/);
});

test('time cancellation override is available only through the row edit flow', () => {
  assert.match(attendanceRuntime, /aria-label'\)\) === 'עריכה'/);
  assert.match(attendanceRuntime, /showTimeCancelEditField\(row\)/);
  assert.match(attendanceRuntime, /data-av2-time-cancel-edit/);
  assert.match(attendanceRuntime, /reconcileTravelCompensation\(recordId\)/);
  assert.match(attendanceRuntime, /overrideTravelCompensation\(recordId, desiredMinutes\)/);
});

test('managed operation destination is snapshotted and used by trusted travel context', () => {
  assert.match(migration, /attendance_operation_options[\s\S]*add column if not exists address text/);
  assert.match(migration, /destination_address_snapshot/);
  assert.match(migration, /הרמת כוסית/);
  assert.match(migration, /המרד 29, תל אביב/);
  assert.match(migration, /excluded_type = 'תפעול'/);
  assert.match(migration, /destination_address := nullif\(btrim\(s\.destination_address_snapshot\)/);
  assert.match(attendanceRuntime, /select\('id,label,address,is_other'\)/);
  assert.match(attendanceRuntime, /label\.textContent = 'כתובת'/);
});

test('manager board highlights today and collapses elapsed items into a mini expander', () => {
  assert.match(managerRuntime, /row\.classList\.toggle\('is-today', iso === today\)/);
  assert.match(managerRuntime, /row\.classList\.toggle\('is-past', iso < today\)/);
  assert.match(managerRuntime, /document\.createElement\('details'\)/);
  assert.match(managerRuntime, /פתח.*שחלפו/);
  assert.match(managerCss, /\.manager-board-milestone\.is-today/);
  assert.match(managerCss, /var\(--ds-accent/);
  assert.match(managerCss, /font-weight:\s*900/);
});

test('new attendance and manager follow-up assets are loaded with cache-busting versions', () => {
  assert.match(attendanceIndex, /attendance-followup\.css\?v=57/);
  assert.match(attendanceIndex, /attendance-followup-runtime\.js\?v=57/);
  assert.match(rootIndex, /manager-board-date-state\.css\?v=20260908-date-state-v1/);
  assert.match(rootIndex, /manager-board-date-state-runtime\.js\?v=20260908-date-state-v1/);
});
