import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');

const settings = {
  dropdown_options: {
    funding_source_records: [
      { id: 'gefen', name: 'גפן' },
      { id: 'wizo', name: 'ויצו' }
    ]
  }
};

test('course drawer keeps polished dates, meeting notes, edit-only scheduling fields, and coordination action', () => {
  const html = activityWorkDrawerHtml({
    id: 'activity-1',
    row_id: '1',
    activity_type: 'course',
    status: 'open',
    activity_name: 'ביומימיקרי',
    activity_season: 'school_2027',
    participants_count: 24,
    funding: 'ערך מימון ישן',
    funding_sources: [{ id: 'gefen', name: 'גפן', amount: 7500 }],
    price: 7500,
    sessions: 3,
    start_date: '2026-09-09',
    end_date: '2027-01-06',
    date_1: '2026-09-09',
    date_2: '2027-01-06',
    meeting_schedule: [
      { date: '2026-09-09', performed: 'no', note: 'להביא ערכות' },
      { date: '2026-09-09', performed: 'no', note: '' },
      { date: '2027-01-06', performed: 'no', note: '' }
    ]
  }, { settings, canEdit: true, canDirectEdit: true, canSchedule: true });
  const rendered = new JSDOM(html).window.document;

  assert.doesNotMatch(rendered.body.textContent, /עונת פעילות/);
  assert.doesNotMatch(rendered.body.textContent, /מספר משתתפים/);
  assert.doesNotMatch(rendered.body.textContent, /ערך מימון ישן/);
  assert.match(html, /name="funding_sources"/);
  assert.match(html, /data-funding-amount="7500"/);
  assert.match(html, /תאריך התחלה:[\s\S]*09\/09\/2026[\s\S]*תאריך סיום:[\s\S]*06\/01\/2027/);
  const boundaries = [...rendered.querySelectorAll('.activity-drawer__date-boundary')];
  assert.deepEqual(boundaries.map((node) => node.textContent.trim().split(':')[0]), ['תאריך התחלה', 'תאריך סיום']);
  const progressRow = rendered.querySelector('.activity-drawer__progress-row');
  assert.ok(progressRow.querySelector('.activity-drawer__progress-track').compareDocumentPosition(boundaries[0]) & 4);
  assert.ok(boundaries[0].compareDocumentPosition(boundaries[1]) & 4);

  const cards = [...rendered.querySelectorAll('[data-dates-view-chips] [data-date-card]')];
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /2 מפגשים/);
  assert.equal(cards[0].querySelectorAll('.activity-drawer__date-note-icon').length, 1);
  assert.ok(cards[0].querySelector('.activity-drawer__date-note-icon'));
  assert.equal(cards[0].querySelector('.activity-drawer__date-note-icon').title, 'להביא ערכות');
  assert.equal(cards[1].querySelector('.activity-drawer__date-note-icon'), null);
  assert.doesNotMatch(cards[0].textContent, /להביא ערכות/);
  assert.equal(rendered.querySelectorAll('[data-meeting-note-idx]').length, 3);

  assert.equal(rendered.querySelector('[data-scheduling-summary]'), null);
  assert.equal(rendered.querySelector('[data-find-instructor]'), null);
  const schedulingFields = rendered.querySelector('[data-scheduling-fields]');
  assert.ok(schedulingFields);
  assert.equal(schedulingFields.getAttribute('data-mode'), 'edit');
  assert.ok(schedulingFields.querySelector('[name="required_instructor_gender"]'));
  assert.ok(schedulingFields.querySelector('[name="instruction_language"]'));
  const actions = rendered.querySelector('[data-activity-actions]');
  assert.ok(actions.querySelector('[data-coordination-approval]'));
  assert.equal(actions.textContent.trim(), 'אישור תיאום');
});

test('participant-supporting activity retains its participant count', () => {
  const html = activityWorkDrawerHtml({
    row_id: '2',
    activity_type: 'workshop',
    activity_name: 'סדנה',
    activity_season: 'school_2027',
    participants_count: 18,
    date_1: '2026-09-09'
  }, { settings });
  assert.match(html, /מספר משתתפים/);
  assert.match(html, />18</);
});
