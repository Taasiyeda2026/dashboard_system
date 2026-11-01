import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const scopedFunction = source.slice(source.indexOf('function buildScopedAttendanceApi('), source.indexOf('function scopedAttendanceState()'));

for (const mutation of ['attendanceControlUpdateRecord', 'attendanceControlApproveRecord', 'reviewAttendanceTravelCompensation']) {
  test(`${mutation} discards captured attendance snapshot before reloading`, async () => {
    const snapshots = new Map([['old', true]]);
    const summaries = new Map([['old', true]]);
    let reads = 0;
    const api = {
      [mutation]: async () => ({ success: true }),
      attendanceControlRecords: async () => { reads++; return [{ employeeId: '1507', notes: 'fresh' }]; },
      attendanceControlDashboardSources: async () => ({ fresh: true })
    };
    const factory = new Function('api', 'text', 'rawEmployeeId', 'SYNTHETIC_TEAM_ID', 'SYNTHETIC_MANAGER_ID', 'attendanceReviewSnapshotCache', 'attendanceSummaryCache', `${scopedFunction}; return buildScopedAttendanceApi;`);
    const build = factory(api, value => String(value ?? ''), row => row.employeeId, 'team', 'manager', snapshots, summaries);
    const scoped = build([{ emp_id: '1507' }], { records: [{ employeeId: '1507', notes: 'stale' }], sources: { stale: true } });
    assert.equal((await scoped.attendanceControlRecords())[0].notes, 'stale');
    await scoped[mutation]('record', {});
    assert.equal((await scoped.attendanceControlRecords())[0].notes, 'fresh');
    assert.equal(reads, 1);
    assert.deepEqual(await scoped.attendanceControlDashboardSources(), { fresh: true });
    assert.equal(snapshots.size, 0);
    assert.equal(summaries.size, 0);
  });
}
