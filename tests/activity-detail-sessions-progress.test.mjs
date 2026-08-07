import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityWorkDrawerHtml, patchDrawerDatesSection, resolveActivitySessionTotal } from '../frontend/src/screens/shared/activity-detail-html.js';

function renderDrawer(row, options = {}) {
  const dom = new JSDOM(activityWorkDrawerHtml(row, { canEdit: true, canDirectEdit: true, ...options }));
  return dom.window.document;
}

const editRows = (document) => document.querySelectorAll('[data-meeting-dates-edit] .activity-drawer__date-card');

test('existing 10-session course renders ten empty edit rows and correct progress', () => {
  const document = renderDrawer({ activity_type: 'course', sessions: '10', meeting_schedule: [] });
  assert.equal(editRows(document).length, 10);
  assert.equal(editRows(document)[9].querySelector('.activity-drawer__meeting-index').textContent, 'מפגש 10');
  assert.match(document.querySelector('[data-dates-progress-meta]').textContent, /0 מתוך 10 מפגשים/);
});

test('partial dates keep the persisted row count and their original positions', () => {
  for (const schedule of [[{ date: '2026-09-01' }], Array.from({ length: 5 }, (_, i) => ({ date: `2026-09-0${i + 1}` }))]) {
    const document = renderDrawer({ activity_type: 'course', sessions: '10', meeting_schedule: schedule });
    assert.equal(editRows(document).length, 10);
    assert.equal(document.querySelector('input[data-meeting-idx="0"]').value, '2026-09-01');
  }
});

test('empty asynchronous schedule cannot shrink persisted edit rows or progress total', () => {
  const document = renderDrawer({ activity_type: 'course', sessions: '10', meeting_schedule: [] }, { datesLoading: true });
  const section = document.querySelector('[data-dates-section]');
  patchDrawerDatesSection(section, { activity_type: 'course', meeting_schedule: [] });
  assert.equal(editRows(document).length, 10);
  assert.match(section.querySelector('[data-dates-progress-meta]').textContent, /0 מתוך 10 מפגשים/);
});

test('asynchronously loaded dates map onto matching persisted rows', () => {
  const document = renderDrawer({ activity_type: 'course', sessions: '10', meeting_schedule: [] });
  const section = document.querySelector('[data-dates-section]');
  patchDrawerDatesSection(section, { activity_type: 'course', meeting_schedule: [{ date: '2026-10-01' }, { date: '2026-10-08' }] });
  assert.equal(editRows(document).length, 10);
  assert.equal(section.querySelector('input[data-meeting-idx="0"]').value, '2026-10-01');
  assert.equal(section.querySelector('input[data-meeting-idx="1"]').value, '2026-10-08');
});

test('session total resolver enforces priority, fallbacks, bounds, and one-day types', () => {
  assert.equal(resolveActivitySessionTotal({ activity_type: 'course', sessions: '10', meetings_total: 7 }, []), 10);
  assert.equal(resolveActivitySessionTotal({ activity_type: 'course', sessions: '0', meetings_total: 7 }, []), 7);
  assert.equal(resolveActivitySessionTotal({ activity_type: 'course', sessions: 'invalid', date_5: '2026-11-01' }, []), 5);
  assert.equal(resolveActivitySessionTotal({ activity_type: 'course', sessions: '50' }, []), 1);
  for (const activity_type of ['workshop', 'tour', 'escape_room']) {
    assert.equal(resolveActivitySessionTotal({ activity_type, sessions: '10' }, Array(10).fill({})), 1);
  }
});

test('activity drawer progress uses persisted sessions when the loaded schedule is partial', () => {
  const dom = new JSDOM(`
    <section data-dates-section>
      <div data-dates-progress-meta></div>
      <div class="activity-drawer__progress-fill"></div>
      <strong data-computed-end-display></strong>
      <div data-dates-view-chips></div>
      <div data-meeting-dates-edit></div>
    </section>
  `);
  const section = dom.window.document.querySelector('[data-dates-section]');
  patchDrawerDatesSection(section, {
    activity_type: 'course',
    sessions: 11,
    meeting_schedule: []
  });

  assert.match(section.querySelector('[data-dates-progress-meta]').textContent, /0 מתוך 11 מפגשים/);
});
