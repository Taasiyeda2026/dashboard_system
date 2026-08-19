import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { monthDayCardsHtml } from '../frontend/src/screens/shared/day-session-cards.js';

// manager-board-runtime.js / manager-board-workspace-runtime.js / manager-board-interactions-runtime.js
// bootstrap themselves against `document` at import time, so (like the existing
// tests/calendar-navigation.test.mjs convention for month.js/week.js/dashboard.js) their behaviour is
// verified via source-shape assertions here instead of importing them into a DOM-less node:test run.
const runtimeSrc = fs.readFileSync(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const workspaceSrc = fs.readFileSync(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const interactionsSrc = fs.readFileSync(new URL('../frontend/src/manager-board-interactions-runtime.js', import.meta.url), 'utf8');
const monthSrc = fs.readFileSync(new URL('../frontend/src/screens/month.js', import.meta.url), 'utf8');

test('monthDayCardsHtml default behaviour matches the original month.js day drawer (no subtitle, instructor meta)', () => {
  const html = monthDayCardsHtml(
    [{ RowID: 'r1', activity_name: 'חוג רובוטיקה', instructor_name: 'דני כהן', instructor_name_2: '' }],
    '2026-09-10'
  );
  assert.ok(html.includes('monthsession|2026-09-10|r1'));
  assert.ok(html.includes('חוג רובוטיקה'));
  assert.ok(html.includes('דני כהן'));
  assert.ok(!html.includes('ds-interactive-card__subtitle'));
});

test('monthDayCardsHtml supports optional subtitle/meta builders for the manager board (school, time, instructor)', () => {
  const html = monthDayCardsHtml(
    [{ RowID: 'r2', activity_name: 'סדנת מדעים', instructor_name: 'רותי לוי' }],
    '2026-09-11',
    {
      subtitleText: () => 'בית ספר אורט',
      metaText: () => '10:00–11:00 · רותי לוי'
    }
  );
  assert.ok(html.includes('בית ספר אורט'));
  assert.ok(html.includes('10:00–11:00'));
  assert.ok(html.includes('ds-interactive-card__subtitle'));
});

test('monthDayCardsHtml empty state is unchanged', () => {
  const html = monthDayCardsHtml([], '2026-09-10');
  assert.ok(html.includes('אין פעילויות מתמשכות ביום זה'));
});

test('month.js reuses the shared day-session-cards module instead of a local copy', () => {
  assert.ok(monthSrc.includes("from './shared/day-session-cards.js'"));
  assert.ok(!monthSrc.includes('function monthDayCardsHtml'));
});

test('manager board shows a single title with no duplicated eyebrow', () => {
  assert.ok(!runtimeSrc.includes('manager-board-eyebrow'));
  assert.ok(runtimeSrc.includes('<h1>לוח מנהל פעילות</h1>'));
});

test('manager board KPI cards drop meetings-count and planned-hours, keep a stable-identity activity count', () => {
  const kpiBlock = runtimeSrc.slice(runtimeSrc.indexOf('manager-board-kpis">'), runtimeSrc.indexOf('manager-board-layout">'));
  assert.ok(!kpiBlock.includes('מפגשים בחודש'));
  assert.ok(!kpiBlock.includes('<span>שעות מתוכננות</span>'));
  assert.ok(runtimeSrc.includes('uniqueActivityRows.size'));
  assert.ok(runtimeSrc.includes('activity.row_id || activity.id'));
});

test('active team strip renders inside the workspace shell, filtered by manager and active flag', () => {
  assert.ok(runtimeSrc.includes('צוות המדריכים הפעיל'));
  assert.ok(runtimeSrc.includes('workspaceShellHtml(activeTeamStripHtml(activeTeamNames))'));
  assert.ok(runtimeSrc.includes('INACTIVE_INSTRUCTOR_VALUES'));
});

test('control points panel covers the selected month and the next month in one frame', () => {
  assert.ok(runtimeSrc.includes('נקודות בקרה – החודש'));
  assert.ok(runtimeSrc.includes('נקודות בקרה – חודש הבא'));
  assert.ok(runtimeSrc.includes('shiftMonth(ym, 1)'));
});

test('"תאריכים חשובים" replaces the ministry-calendar card and is not manager-filtered', () => {
  assert.ok(!runtimeSrc.includes('לוח משרד החינוך'));
  assert.ok(!runtimeSrc.includes('חגים ואירועים רלוונטיים לחודש'));
  assert.ok(runtimeSrc.includes('<h2>תאריכים חשובים</h2>'));
  assert.ok(runtimeSrc.includes('importantDateEntries(schoolEvents, data.birthdays, ym)'));
});

test('birthdays reuse the existing employee_birthdays loader instead of a new source', () => {
  assert.ok(runtimeSrc.includes("from './birthday-calendar.js'"));
  assert.ok(!runtimeSrc.includes('employee_birthdays'));
});

test('calendar day cell exposes a whole-cell click target with a clear activity count, not per-event handlers', () => {
  assert.ok(runtimeSrc.includes('data-manager-board-day'));
  assert.ok(runtimeSrc.includes('manager-board-calendar-day__count'));
});

test('active-instructor filter treats only explicit inactive markers as inactive', () => {
  assert.ok(runtimeSrc.includes("new Set(['no', 'false', '0', 'לא', 'לא פעיל', 'inactive', 'n'])"));
});

test('day cell click opens the month.js-style day drawer before any activity detail (no direct jump)', () => {
  assert.ok(interactionsSrc.includes('data-manager-board-day'));
  assert.ok(interactionsSrc.includes("from './screens/shared/day-session-cards.js'"));
  assert.ok(interactionsSrc.includes('monthsession|'));
  assert.ok(interactionsSrc.includes('activityWorkDrawerHtml'));
  assert.ok(!interactionsSrc.includes('resolveCalendarActivity'));
  assert.ok(!interactionsSrc.includes('eventDescriptor'));
});

test('management tab renders nothing async so tab round-trips cannot reflow it (layout-shift fix)', () => {
  assert.ok(workspaceSrc.includes("if (activeTab === 'management') return;"));
});

test('"דיווחים חשובים" moved to the attendance tab and is not duplicated in management', () => {
  const managementAlertsDefinitionCount = (workspaceSrc.match(/function managementAlertsHtml/g) || []).length;
  assert.equal(managementAlertsDefinitionCount, 1);
  assert.ok(!workspaceSrc.includes('function renderManagement('));
  assert.ok(workspaceSrc.includes('view.innerHTML = `${managementAlertsHtml(roster, summary)}'));
});
