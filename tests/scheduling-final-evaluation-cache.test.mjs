import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDynamicCoursePlan } from '../frontend/src/screens/course-scheduling-planning.js';
import { adaptSinglePairRouteInvoke, createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';

test('flexible planning checks a scenario once and retains independently verified candidates', async () => {
  const activity = { row_id: 'flexible', activity_season: 'school_2027', activity_type: 'course', status: 'פתוח',
    activity_name: 'ביומימיקרי', school: 'בית ספר', authority: 'רשות', district: 'מרכז', calendar_sector: 'general',
    required_instructor_gender: 'any', school_id: 1, school_address: 'school', instruction_language: 'he', sessions: 1, date_1: '2026-10-11' };
  const instructors = [1, 2, 3].map(emp_id => ({ emp_id, full_name: `Instructor ${emp_id}`, active: 'yes', address: `home${emp_id}` }));
  const profiles = Object.fromEntries(instructors.map(i => [i.emp_id, { emp_id: i.emp_id, instruction_languages: ['he'], gender: 'male' }]));
  const rules = Object.fromEntries(instructors.map(i => [i.emp_id, [{ emp_id: i.emp_id, weekday: 0, available: true, start_time: '08:00', end_time: '09:30' }]]));
  const routeClient = createRouteClient({
    invoke: adaptSinglePairRouteInvoke(async ({ origin, destination }) => ({
      data: [origin, destination].includes('home3')
        ? { calculated: false, reason: 'route_not_found' }
        : { calculated: true, distance_km: 5, duration_minutes: 10 },
      error: null
    }))
  });
  const result = await buildDynamicCoursePlan({ activities: [activity], instructors, profiles, rules,
    catalog: [{ activity_name: 'ביומימיקרי', meetings_count: 1, hours_count: 1.5 }],
    exceptions: {}, schoolCalendar: [], today: '2026-09-29', routeClient, allowGlobalRepair: false, planningProfile: 'fast' });
  const row = result.rows[0];
  assert.equal(row.kind, 'proposal');
  assert.deepEqual([...new Set(row.options.map(o => o.instructorEmpId))].sort(), ['1', '2']);
  assert.ok(row.options.every(o => o.routeVerified));
  assert.ok(row.diagnostics.finalEvaluationCount > 0);
  assert.ok(row.diagnostics.finalEvaluationCount < row.diagnostics.routedAttemptCount, JSON.stringify(row.diagnostics));
});
