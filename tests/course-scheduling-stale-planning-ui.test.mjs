import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  courseSchedulingScreen,
  schedulingPlanningStatusHtml,
  stalePlanningRowForDisplay
} from '../frontend/src/screens/course-scheduling.js';

if (!globalThis.sessionStorage) {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key))
  };
}
if (!globalThis.document) globalThis.document = { dispatchEvent: () => true };

const liron = {
  emp_id: '1550',
  full_name: 'לירון נחום-בלילה',
  availability: {
    0: ['09:30', '15:00'],
    1: ['10:00', '14:00'],
    2: ['09:30', '15:00'],
    3: ['09:30', '15:00'],
    4: null,
    5: null,
    6: null
  }
};

function activity(overrides = {}) {
  return {
    row_id: 'liron-ai-netanya',
    activity_season: 'school_2027',
    activity_type: 'קורס',
    status: 'פתוח',
    activity_name: 'בינה מלאכותית',
    school: 'בית ספר נתניה',
    authority: 'נתניה',
    start_date: '2027-01-04',
    range_max: '2027-01-29',
    ...overrides
  };
}

function proposal(courseId, meeting) {
  return {
    courseId,
    kind: 'proposal',
    instructorEmpId: liron.emp_id,
    instructorName: liron.full_name,
    startDate: meeting.date,
    startTime: meeting.start_time,
    endTime: meeting.end_time,
    meetings: [meeting],
    options: [{
      instructorEmpId: liron.emp_id,
      instructorName: liron.full_name,
      meetings: [meeting]
    }]
  };
}

function render(rows, activities = [activity()]) {
  return courseSchedulingScreen.render({
    activities,
    instructors: [liron],
    scheduling: {},
    planningCatalog: [],
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, {
    state: {
      user: { role: 'admin' },
      routes: ['instructors', 'course-scheduling'],
      courseSchedulingPlanningRows: rows,
      courseSchedulingPlanningSharedLoaded: true,
      courseSchedulingPlanningCalculatedAt: '03.10.2026, 12:00',
      courseSchedulingPlanningAffectedIds: rows.filter((row) => row.needsRecalc).map((row) => row.courseId)
    }
  });
}

test('Liron stale Monday 13:30–15:00 recommendation is contextual only and cannot be selected', () => {
  const stale = stalePlanningRowForDisplay(proposal('liron-ai-netanya', {
    date: '2027-01-04', start_time: '13:30', end_time: '15:00'
  }));
  const html = render([stale]);

  assert.equal(liron.availability[1][1], '14:00');
  assert.match(html, /data-planning-stale="true"/);
  assert.match(html, /הצעה לא מעודכנת · נדרש עדכון תכנון/);
  assert.match(html, /13:30–15:00 · מידע ישן/);
  assert.match(html, /aria-disabled="true">נדרש עדכון תכנון/);
  assert.doesNotMatch(html, /data-planning-pick-option/);
  assert.doesNotMatch(html, /data-confirm-planning-draft/);
  assert.doesNotMatch(html, /data-planning-unlock/);
});

test('Liron stale proposal after range_max is also blocked', () => {
  const course = activity({ row_id: 'liron-industry-holon', activity_name: 'התנסות בתעשייה', authority: 'חולון' });
  const stale = stalePlanningRowForDisplay(proposal(course.row_id, {
    date: '2027-02-15', start_time: '09:30', end_time: '11:30'
  }));
  const html = render([stale], [course]);

  assert.ok(stale.meetings[0].date > course.range_max);
  assert.match(html, /15\/02\/2027/);
  assert.match(html, /מידע ישן/);
  assert.doesNotMatch(html, /data-planning-pick-option/);
});

test('pending status says update is required until an actual planning run starts', () => {
  const idle = schedulingPlanningStatusHtml({
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '03.10.2026, 12:00',
    courseSchedulingPlanningAffectedIds: ['a', 'b']
  });
  assert.match(idle, /נדרש עדכון · 2 פעילויות/);
  assert.match(idle, /data-run-course-planning>עדכן/);
  assert.match(idle, /aria-busy="false"/);
  assert.doesNotMatch(idle, /מעדכן 2 פעילויות/);

  const running = schedulingPlanningStatusHtml({
    courseSchedulingPlanningLoading: true,
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningAffectedIds: ['a', 'b'],
    courseSchedulingPlanningProgress: { phase: 'עדכון שינויים בלבד · 2 פעילויות', completed: 0, total: 2 }
  });
  assert.match(running, /מעדכן 2 פעילויות שהושפעו…/);
  assert.match(running, /aria-busy="true"/);
});

test('successful replacement row becomes actionable again without the stale snapshot', () => {
  const current = proposal('liron-ai-netanya', {
    date: '2027-01-04', start_time: '12:30', end_time: '14:00'
  });
  const html = render([current]);
  assert.doesNotMatch(html, /data-planning-stale="true"/);
  assert.doesNotMatch(html, /מידע ישן/);
  assert.match(html, /data-planning-pick-option/);
});

test('explicit update remains incremental, screen entry stays passive, and point mutation auto-refresh remains enabled', () => {
  const source = readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /targetCourseIds,[\s\S]*allowGlobalRepair: fullRun/);
  assert.match(source, /const fullRun = forceFull[\s\S]*unrecoverableGlobalContextChange/);
  assert.match(source, /Entering the screen only restores the shared plan\. Recalculation is always explicit\./);
  assert.match(source, /event\?\.detail\?\.autoRefresh !== true[\s\S]*scheduleBackgroundPlanning\(\{ forceFull: false, reuseSnapshot: true \}\)/);
});
