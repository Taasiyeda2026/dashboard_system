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

test('course drawer hides internal season and participants while retaining central funding and course dates', () => {
  const html = activityWorkDrawerHtml({
    id: 'activity-1',
    row_id: '1',
    activity_type: 'course',
    activity_name: 'ביומימיקרי',
    activity_season: 'school_2027',
    participants_count: 24,
    funding: 'ערך מימון ישן',
    funding_sources: [{ id: 'gefen', name: 'גפן', amount: 7500 }],
    price: 7500,
    sessions: 2,
    start_date: '2026-09-09',
    end_date: '2027-01-06',
    date_1: '2026-09-09',
    date_2: '2027-01-06'
  }, { settings, canEdit: true, canDirectEdit: true });
  const rendered = new JSDOM(html).window.document;

  assert.doesNotMatch(rendered.body.textContent, /עונת פעילות/);
  assert.doesNotMatch(rendered.body.textContent, /מספר משתתפים/);
  assert.doesNotMatch(rendered.body.textContent, /ערך מימון ישן/);
  assert.match(html, /name="funding_sources"/);
  assert.match(html, /data-funding-amount="7500"/);
  assert.match(html, /תאריך התחלה[\s\S]*09\/09\/2026[\s\S]*תאריך סיום[\s\S]*06\/01\/2027/);
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
