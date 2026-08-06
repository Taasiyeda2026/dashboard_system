import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { patchDrawerDatesSection } from '../frontend/src/screens/shared/activity-detail-html.js';

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
