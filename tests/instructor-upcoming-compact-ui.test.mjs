import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { instructorDashboardScreen } from '../frontend/src/screens/instructor-portal/dashboard.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('upcoming activity cards stay compact and open activity details', async () => {
  const css = await read('frontend/src/styles/instructor-mobile-contract.css');
  const index = await read('index.html');
  const sw = await read('frontend/sw.js');
  assert.match(css, /\.instructor-portal-focus\s*\{[\s\S]*padding:\s*8px 10px/);
  assert.match(css, /\.instructor-portal-dashboard\s*\{[\s\S]*gap:\s*8px/);
  assert.match(index, /instructor-mobile-contract\.css\?v=20261123-instructor-mobile-compact-v1/);
  assert.match(sw, /const CACHE_VERSION = 2133/);

  const activity = {
    RowID: 'act-1',
    emp_id: 'A-1',
    activity_name: 'סדנת בדיקה',
    activity_type: 'סדנה',
    school: 'בית ספר',
    authority: 'רשות',
    start_date: '2026-11-24',
    date_1: '2026-11-24',
    start_time: '09:00',
    end_time: '12:00'
  };
  const resolvedMeetings = [{
    date: '2026-11-24',
    meeting_date: '2026-11-24',
    row_id: 'act-1',
    RowID: 'act-1',
    activity_name: 'סדנת בדיקה',
    school: 'בית ספר',
    authority: 'רשות',
    start_time: '09:00',
    end_time: '12:00'
  }];
  const state = { user: { emp_id: 'A-1', role: 'instructor' } };
  const dom = new JSDOM(instructorDashboardScreen.render(
    { rows: [activity], resolvedMeetings },
    { state }
  )).window.document;
  const card = dom.querySelector('[data-upcoming-activity="act-1"]');
  assert.ok(card);
  assert.equal(card.getAttribute('role'), 'button');

  let opened = '';
  instructorDashboardScreen.bind({
    root: dom,
    data: { rows: [activity], resolvedMeetings, resolvedActivities: [activity] },
    state,
    ui: { openDrawer: ({ content }) => { opened = content; } }
  });
  card.click();
  assert.match(opened, /instructor-activity-drawer-shell/);
});
