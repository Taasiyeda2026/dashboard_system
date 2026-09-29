import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseAutomaticCancellationLabel,
  reconcileChangedTravelContext,
} from '../attendance/src/services/time-cancellation.helpers.js';
import {
  normalizeScheduledTraining,
  scheduledTrainingReportFields,
} from '../attendance/src/services/training-schedule.helpers.js';

const runtime = await readFile(new URL('../attendance/src/attendance-followup-runtime-v2.js', import.meta.url), 'utf8');
const reports = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const newReport = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const activities = await readFile(new URL('../attendance/src/services/activities.service.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260929120000_attendance_time_cancellation_and_online_training.sql', import.meta.url), 'utf8');

test('zero cancellation remains resolved and editable, including after positive to zero and reload', () => {
  assert.match(reports, /calculation_status === 'resolved'.*Number\.isFinite/s);
  assert.doesNotMatch(reports, /final_cancellation_minutes\) > 0/);
  assert.match(runtime, /resolved: minutes != null/);
  assert.match(runtime, /input\.value = state\.label/);
});

test('saved manual correction is recognized after reload with the current audit label', () => {
  assert.equal(parseAutomaticCancellationLabel('תוקן ידנית (אוטומטי: 0:35)'), '0:35');
  assert.equal(parseAutomaticCancellationLabel('נערך ידנית · מחושב במקור: 1:05'), '1:05');
  assert.match(runtime, /parseAutomaticCancellationLabel\(audit\)/);
});

test('zero to positive correction is written against the source record', () => {
  assert.match(runtime, /overrideTravelCompensation\(recordId, desiredMinutes\)/);
  assert.match(service, /p_source_id: sourceRecordId/);
  assert.match(service, /p_final_minutes: Math\.max\(0/);
});

test('manual override can return to the automatic calculation', () => {
  assert.match(runtime, /חזור לחישוב האוטומטי/);
  assert.match(runtime, /resetTravelCompensationOverride/);
  assert.match(service, /return overrideTravelCompensation\(sourceRecordId, calculatedMinutes\)/);
});

test('override failure after source save is visible to the instructor', () => {
  assert.match(runtime, /role.*alert/);
  assert.match(runtime, /הדיווח נשמר, אך עדכון ביטול הזמן נכשל/);
  assert.match(runtime, /עדכון ביטול הזמן לא הושלם/);
});

test('route context reset succeeds only after a resolved recalculation', async () => {
  const result = await reconcileChangedTravelContext(async () => ({ eligible: true, status: 'resolved' }), 'source-1');
  assert.equal(result.status, 'resolved');
  assert.match(runtime, /await reconcileChangedTravelContext\(reconcileTravelCompensation, recordId\)/);
  assert.match(runtime, /התיקון הידני אופס וביטול הזמן חושב מחדש/);
});

test('route context recalculation failure is propagated for a visible error', async () => {
  await assert.rejects(
    reconcileChangedTravelContext(async () => ({ eligible: true, status: 'unavailable' }), 'source-1'),
    /החישוב מחדש של ביטול הזמן נכשל/,
  );
  assert.match(runtime, /איפוס וחישוב ביטול הזמן נכשלו/);
});

test('source report date changes synchronize the generated cancellation row', () => {
  assert.match(reports, /report_date:\s+reportDateField\.input\.value/);
  assert.match(migration, /after update of report_date/);
  assert.match(migration, /set report_date = new\.report_date/);
  assert.match(migration, /generation_kind = 'travel_time_cancellation'/);
});

test('training stays training while distinguishing online and physical delivery', () => {
  assert.match(newReport, /label: 'אופן ההכשרה \*'/);
  assert.match(newReport, /value: 'physical', label: 'פרונטלי'/);
  assert.match(newReport, /value: 'online', label: 'מקוון'/);
  assert.match(newReport, /activity_type: reportType/);
  assert.match(newReport, /training_mode: reportType === TRAINING_REPORT_TYPE/);
  assert.match(activities, /instructor_training_schedule/);
  assert.match(activities, /map\(normalizeScheduledTraining\)/);
  assert.match(migration, /public\.app_current_role\(\) = 'instructor'/);
  assert.match(migration, /participant_scope = 'open'/);
  assert.match(migration, /emp_id = \([\s\S]*u\.auth_user_id = auth\.uid\(\)/);
});

test('scheduled physical training saves and reloads without requiring a school', () => {
  const selected = normalizeScheduledTraining({
    id: '11111111-1111-1111-1111-111111111111',
    course_name: 'הדרכת מדריכים',
    start_time: '09:00',
    end_time: '12:00',
    is_online: false,
    location_name: 'מרכז ההדרכה',
    location_address: 'רחוב ההדרכה 1, תל אביב',
  });
  const saved = { activity_type: 'הכשרה', ...scheduledTrainingReportFields(selected) };
  assert.equal(saved.activity_type, 'הכשרה');
  assert.equal(saved.training_mode, 'physical');
  assert.equal(saved.school_id, null);
  assert.equal(saved.school_name_snapshot, null);
  assert.equal(saved.destination_address_snapshot, 'רחוב ההדרכה 1, תל אביב');
  assert.equal(saved.authority_name_snapshot, 'מרכז ההדרכה');
  assert.equal(saved.training_schedule_id, selected.training_schedule_id);
  assert.match(migration, /where t\.id = new\.training_schedule_id[\s\S]*t\.training_date = new\.report_date/);
  assert.match(migration, /new\.destination_address_snapshot := case[\s\S]*scheduled_training\.location_address/);
  assert.match(migration, /s\.training_schedule_id is not null[\s\S]*destination_address := nullif\(btrim\(s\.destination_address_snapshot\)/);
});

test('scheduled online training reloads without location or travel data', () => {
  const selected = normalizeScheduledTraining({
    id: '22222222-2222-2222-2222-222222222222',
    course_name: 'הדרכה מקוונת',
    is_online: true,
    location_name: 'Zoom',
    location_address: 'https://example.invalid/meeting',
  });
  const saved = { activity_type: 'הכשרה', ...scheduledTrainingReportFields(selected) };
  assert.equal(saved.training_mode, 'online');
  assert.equal(saved.authority_name_snapshot, null);
  assert.equal(saved.school_id, null);
  assert.equal(saved.destination_address_snapshot, null);
  assert.equal(saved.roundtrip_km, 0);
  assert.equal(saved.public_transport, false);
});

test('online training has no location, kilometres, public transport, or cancellation', () => {
  assert.match(newReport, /const hasNoLocation = isOpen \|\| isOnlineTraining\(\)/);
  assert.match(newReport, /const usesPublicTransport = !isOnline/);
  assert.match(newReport, /const kmValue = \(!isOnline/);
  assert.match(service, /onlineTraining.*roundtrip_km: 0/s);
  assert.match(migration, /training_mode = 'online'[\s\S]*destination_address_snapshot := null/);
});

test('physical to online transition removes an existing generated cancellation before reconciliation', async () => {
  const result = await reconcileChangedTravelContext(async () => ({ eligible: false, status: 'not_applicable' }), 'source-1');
  assert.equal(result.linkedCancellationRemoved, true);
  assert.match(migration, /old\.training_mode is distinct from new\.training_mode/);
  assert.match(migration, /delete from public\.attendance_records child[\s\S]*generation_kind = 'travel_time_cancellation'/);
  assert.match(migration, /delete from public\.attendance_travel_compensations/);
});
