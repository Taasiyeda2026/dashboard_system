import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { decorateTeamCalendar, teamCalendarEventsForDate } from '../frontend/src/screens/shared/team-calendar-ui.js';

const rows = [
  ...Array.from({ length: 6 }, (_, index) => ({
    external_key: `task-${index + 1}`,
    event_date: '2026-09-01',
    title: `משימה ${index + 1}`,
    owner_name: index === 5 ? null : 'עדן',
    display_order: index + 1,
    is_active: true
  })),
  { external_key: 'task-1', event_date: '2026-09-01', title: 'כפילות', owner_name: 'עדן', display_order: 7, is_active: true }
];

test('team calendar data is deduplicated by stable external key', () => {
  const events = teamCalendarEventsForDate(rows, '2026-09-01');
  assert.equal(events.length, 6);
  assert.equal(events[0].title, 'משימה 1');
});

test('month decoration shows four tasks and a real remaining count without empty owner text', () => {
  const dom = new JSDOM(`<main id="app">
    <span class="ds-cal-nav__label">ספטמבר 2026</span>
    <div class="ds-cal-grid"><div class="ds-cal-slot-hit"><article class="ds-interactive-card--day-cell">
      <p class="ds-interactive-card__title">1</p><span data-birthday-calendar-label="month">🎂 יום הולדת</span>
      <p class="ds-interactive-card__subtitle" data-school-calendar-label>חופשת משרד החינוך</p>
    </article></div></div>
  </main>`);
  const app = dom.window.document.getElementById('app');
  decorateTeamCalendar(app, rows);
  assert.equal(app.querySelectorAll('.team-calendar-task').length, 4);
  assert.equal(app.querySelector('.team-calendar-more').textContent, 'ועוד 2');
  assert.equal(app.querySelectorAll('[data-birthday-calendar-label]').length, 1);
  assert.equal(app.querySelectorAll('[data-school-calendar-label]').length, 1);
  assert.doesNotMatch(app.textContent, /undefined|null/);

  decorateTeamCalendar(app, rows);
  assert.equal(app.querySelectorAll('.team-calendar-tasks').length, 1);
  assert.equal(app.querySelectorAll('.team-calendar-task').length, 4);
});

test('idempotent migration contains exactly 44 stable seed records', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260802190000_add_team_calendar_events.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/\('team-2026/g) || []).length, 44);
  assert.match(sql, /on conflict \(external_key\) do update/);
  assert.doesNotMatch(sql, /school_calendar|employee_birthdays/);
});
