import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

globalThis.__ACTIVITY_DRAWER_INLINE_LAYOUT_TEST__ = true;
const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');
const { enhanceActivityDrawerForm } = await import('../frontend/src/activity-drawer-inline-layout.js');

const tour = {
  row_id: 'TOUR-LOCATION-TEST',
  activity_name: 'התנסות בתעשייה',
  activity_type: 'tour',
  item_type: 'tour',
  activity_season: 'school_2027',
  tour_location: 'מפעל אשקלון',
  status: 'פתוח',
  authority: 'אשקלון',
  school: 'בית ספר',
  start_time: '11:30',
  end_time: '13:30'
};

test('tour drawer displays its location and a short editable input with no counter', () => {
  const dom = new JSDOM(`<main>${activityWorkDrawerHtml(tour)}</main>`);
  const doc = dom.window.document;
  const field = doc.querySelector('[data-tour-location-field]');
  const input = doc.querySelector('input[name="tour_location"]');
  assert.ok(field);
  assert.equal(field.hidden, false);
  assert.equal(input.maxLength, 15);
  assert.equal(input.value, tour.tour_location);
  assert.match(doc.body.textContent, /מיקום הסיור/);
  assert.doesNotMatch(doc.body.textContent, /0\/15|11\/15|מונה תווים/);
  dom.window.close();
});

test('historical tour has no location field or caption at all', () => {
  const html = activityWorkDrawerHtml({ ...tour, activity_season: 'regular' });
  const dom = new JSDOM(`<main>${html}</main>`);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-tour-location-field]'), null);
  assert.equal(doc.querySelector('[name="tour_location"]'), null);
  assert.doesNotMatch(doc.body.textContent, /מיקום הסיור/);
  dom.window.close();
});

test('non-tour drawer keeps tour field hidden', () => {
  const dom = new JSDOM(`<main>${activityWorkDrawerHtml({ ...tour, activity_type: 'course', item_type: 'course', tour_location: null })}</main>`);
  const field = dom.window.document.querySelector('[data-tour-location-field]');
  assert.ok(field);
  assert.equal(field.hidden, true);
  dom.window.close();
});

test('inline drawer shows location only for tours and reacts to type changes', () => {
  const dom = new JSDOM(`<div class="ds-drawer">${activityWorkDrawerHtml(tour)}</div>`, { url: 'https://example.com/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;
  const form = dom.window.document.querySelector('[data-drawer-form]');
  assert.equal(enhanceActivityDrawerForm(form), true);
  const field = form.querySelector('.activity-drawer-inline__field--tour-location');
  const input = field.querySelector('[name="tour_location"]');
  assert.ok(field);
  assert.equal(field.hidden, false);
  assert.equal(input.maxLength, 15);
  assert.equal(field.querySelector('[data-mode="view"]').textContent.trim(), tour.tour_location);

  const typeSelect = form.querySelector('[name="activity_type"]');
  typeSelect.value = 'course';
  typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(field.hidden, true);
  typeSelect.value = 'tour';
  typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(field.hidden, false);
  dom.window.close();
});

test('create form, edit save and Supabase API all enforce tour-only 15-character location', async () => {
  const [activities, editor, api, migration] = await Promise.all([
    readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20261030145300_add_tour_location_to_activities.sql', import.meta.url), 'utf8')
  ]);
  assert.match(activities, /data-tour-location-field hidden[^\n]*maxlength="15"/);
  assert.match(activities, /function syncAddTourLocation\(form\)/);
  assert.match(activities, /selectedType === 'tour' && activitySeason === ACTIVITY_SEASON_SCHOOL_2027/);
  assert.match(editor, /isSchool2027TourScope && initialType === 'tour'/);
  assert.match(api, /'tour_location'/);
  assert.match(api, /invalid_tour_location_length/);
  assert.match(api, /tour_location_requires_tour/);
  assert.match(api, /tour_location_requires_school_2027/);
  assert.match(api, /required_instructor_gender,tour_location/);
  assert.match(migration, /char_length\(tour_location\) <= 15/);
  const restrictedMigration = await readFile(new URL('../supabase/migrations/20261030190000_restrict_tour_location_to_school_2027.sql', import.meta.url), 'utf8');
  assert.match(restrictedMigration, /coalesce\(activity_season, ''\) = 'school_2027'/);
});
