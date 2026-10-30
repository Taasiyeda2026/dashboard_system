import test from 'node:test';
import assert from 'node:assert/strict';
import { courseListHtml, sortCourseRowsBySchool } from '../frontend/src/screens/course-scheduling.js';

const row = (id, school, bucket = 'open', activity = 'ביומימיקרי') => ({
  id,
  bucket,
  course: { row_id: id, school, authority: 'תל אביב', activity_name: activity },
  statusLabel: { open: 'טרם שובץ', draft: 'ממתין לאישור', assigned: 'משובץ' }[bucket],
  scheduleLabel: 'טרם נקבע',
  instructorLabel: bucket === 'assigned' ? 'מדריך משובץ' : '—',
  isAssigned: bucket === 'assigned',
  hasActualDraft: bucket === 'draft',
  hasPlanningDraft: false,
  planningRow: null
});
const displayedIds = (html) => [...html.matchAll(/data-course-card="([^"]+)"/g)].map(match => match[1]);

test('all activities are globally alphabetical by school, across all assignment statuses', () => {
  const rows = [
    row('assigned-g', 'גנים', 'assigned'),
    row('draft-b', 'ברושים', 'draft'),
    row('open-a', 'אורנים', 'open'),
    row('open-d', 'דקל', 'open')
  ];
  const originalOrder = rows.map(item => item.id);
  const html = courseListHtml(rows, '', { courseSchedulingBusinessStatus: 'all' });
  assert.deepEqual(displayedIds(html), ['open-a', 'draft-b', 'assigned-g', 'open-d']);
  assert.doesNotMatch(html, /<section class="course-scheduling-course-group">/,
    'the all view must not regroup activities by status');
  assert.deepEqual(rows.map(item => item.id), originalOrder, 'sorting must not change source records');
});

test('unassigned is sorted by school name and paginated after sorting', () => {
  const rows = [
    row('assigned-early', 'בית ספר 0', 'assigned'),
    ...Array.from({ length: 27 }, (_, index) => {
      const n = 27 - index;
      return row('s' + String(n).padStart(2, '0'), 'בית ספר ' + n, 'open');
    })
  ];
  const first = { courseSchedulingBusinessStatus: 'open', courseSchedulingListPage: 0 };
  const htmlFirst = courseListHtml(rows, '', first);
  assert.deepEqual(displayedIds(htmlFirst), Array.from({ length: 25 }, (_, index) => 's' + String(index + 1).padStart(2, '0')));
  assert.match(htmlFirst, /עמוד 1 מתוך 2 · 27 פעילויות/);
  const second = { courseSchedulingBusinessStatus: 'open', courseSchedulingListPage: 1 };
  const htmlSecond = courseListHtml(rows, '', second);
  assert.deepEqual(displayedIds(htmlSecond), ['s26', 's27']);
  assert.match(htmlSecond, /עמוד 2 מתוך 2 · 27 פעילויות/);
  assert.doesNotMatch(htmlFirst + htmlSecond, /data-course-card="assigned-early"/);
});

test('schools with the same name have stable ties and unnamed schools appear last', () => {
  const rows = [
    row('z', '', 'open'),
    row('b', 'נופים', 'draft', 'רובוטיקה'),
    row('a', 'נופים', 'assigned', 'ביומימיקרי'),
    row('x', 'אורנים', 'open'),
    row('y', '   ', 'open')
  ];
  assert.deepEqual(sortCourseRowsBySchool(rows).map(item => item.id), ['x', 'a', 'b', 'y', 'z']);
});
