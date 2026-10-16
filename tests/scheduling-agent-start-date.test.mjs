import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWeeklyScheduleFromStartDate } from '../frontend/src/screens/shared/school-calendar-logic.js';

const base = { calendarRows: [], sector: 'arab', startDate: '2026-11-09',
  startTime: '08:00', endTime: '10:00', sessions: 3 };
test('one weekly meeting and calculated end date', () => {
  const result = generateWeeklyScheduleFromStartDate(base);
  assert.deepEqual(result.dates, ['2026-11-09','2026-11-16','2026-11-23']);
  assert.equal(result.endDate, '2026-11-23');
});
test('skips active relevant holidays and completes meeting count', () => {
  const event = {start_date:'2026-11-16',end_date:'2026-11-16',is_active:true,
    blocks_scheduling:true,calendar_sector:'arab'};
  const result = generateWeeklyScheduleFromStartDate({...base,calendarRows:[event]});
  assert.deepEqual(result.dates,['2026-11-09','2026-11-23','2026-11-30']);
  assert.equal(result.deferred[0].skippedWeeks,1);
});
test('does not block Arab calendar for Jewish-only holiday', () => {
  const event = {start_date:'2026-11-16',is_active:true,
    blocks_scheduling:true,calendar_sector:'jewish'};
  assert.equal(generateWeeklyScheduleFromStartDate({...base,calendarRows:[event]}).dates[1],
    '2026-11-16');
});
test('respects shortened school days by advancing to next week', () => {
  const event = {start_date:'2026-11-09',is_active:true,
    enforce_end_time:true,school_day_end_time:'09:00',calendar_sector:'general'};
  assert.equal(generateWeeklyScheduleFromStartDate({...base,calendarRows:[event]}).dates[0],
    '2026-11-16');
});
test('does not silently use missing calendar snapshot', () => {
  assert.throws(() => generateWeeklyScheduleFromStartDate({...base,calendarRows:null}),
    /calendar_unavailable/);
});
test('invalid dates and times do not produce schedules', () => {
  assert.throws(() => generateWeeklyScheduleFromStartDate({...base,startDate:'2026-02-30'}),
    /invalid_start_date/);
  assert.throws(() => generateWeeklyScheduleFromStartDate({...base,startTime:'12:00',
    endTime:'10:00'}), /invalid_times/);
});
test('bounded skip prevents unending blocked sessions', () => {
  const event = {start_date:'2026-01-01',end_date:'2027-12-31',
    calendar_sector:'arab',is_active:true,blocks_scheduling:true};
  assert.throws(() => generateWeeklyScheduleFromStartDate({...base,calendarRows:[event],
    maxSkips:2}), /calendar_generation_exhausted/);
});
