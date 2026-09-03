import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const {
  augmentNextYearProposalPayload,
  normalizeNextYearWorkshopHtml
} = await import('../frontend/src/proposal-next-year-workshops.js');
const {
  proposalGroupOptions,
  proposalPreviewBodyHtml,
  nextYearInternalSectionTitle
} = await import('../frontend/src/screens/proposals-agreements.js');

const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);

const baseGroups = [
  { group_key: 'summer', display_name: 'פעילויות קיץ', template_key: 'summer', included_group_keys: [] },
  { group_key: 'next_year', display_name: 'שנה הבאה', template_key: 'next_year', included_group_keys: [] },
  { group_key: 'gefen', display_name: 'גפן', template_key: 'gefen', included_group_keys: [] },
  { group_key: 'tour', display_name: 'סיור', template_key: 'tour', included_group_keys: [] }
];

const basePricing = [
  { pricing_key: 'course_1', activity_name: 'קורס לדוגמה', proposal_group: 'next_year', group_key: 'next_year', item_type: 'תוכנית', unit_price: 9000, meetings_count: 10, hours_count: 15, gefen_number: '6089' },
  { pricing_key: 'course_2', activity_name: 'ביומימיקרי', proposal_group: 'next_year', group_key: 'next_year', item_type: 'תוכנית', unit_price: 8000, meetings_count: 8, hours_count: 12, gefen_number: '6090' },
  { pricing_key: 'maker_workshop', activity_name: 'סדנאות STEM', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 650, proposal_display_mode: 'bundle_parent' },
  { pricing_key: 'workshop_001', parent_pricing_key: 'maker_workshop', activity_name: 'רוטוקופטר', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 650, proposal_display_mode: 'bundle_child' },
  { pricing_key: 'space_workshop', activity_name: 'סדנאות חלל', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 500, proposal_display_mode: 'bundle_parent' }
];

function preview(items) {
  const payload = augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });
  proposalGroupOptions(payload, [], payload.proposalActivityPricing);
  return proposalPreviewBodyHtml(
    { activity_type_group: 'next_year', proposal_date: '2026-08-04' },
    items,
    []
  );
}

test('internal section titles keep separate program and workshop labels', () => {
  assert.equal(nextYearInternalSectionTitle('next_year_courses'), 'קורסים ותוכניות');
  assert.equal(nextYearInternalSectionTitle('next_year_workshops'), 'סדנאות');
  assert.equal(nextYearInternalSectionTitle('gefen'), '');
  assert.equal(nextYearInternalSectionTitle('tour'), '');
});

test('תשפ״ז preview keeps programs and workshops in separate tables', () => {
  const course = {
    item_name: 'קורס לדוגמה', proposal_group: 'next_year_courses', quantity: 1,
    unit_price: 9000, total_price: 9000, meetings_count: 10, hours_count: 15,
    hourly_price: 600, gefen_number: '6089', proposal_display_mode: 'single'
  };
  const workshop = {
    item_name: 'רוטוקופטר', proposal_group: 'next_year_workshops', quantity: 2,
    unit_duration: '45 דקות', unit_price: 650, total_price: 1300,
    proposal_display_mode: 'single'
  };

  const courseOnly = preview([course]);
  assert.match(courseOnly, /קורסים ותוכניות/);
  assert.match(courseOnly, /pa-next-year-course-table/);
  assert.match(courseOnly, /6089|קורס לדוגמה/);
  assert.match(courseOnly, /9,000/);
  assert.doesNotMatch(courseOnly, /pa-next-year-workshop-table/);
  assert.doesNotMatch(courseOnly, /pa-next-year-combined-total/);

  const workshopOnly = preview([workshop]);
  assert.match(workshopOnly, /סדנאות/);
  assert.match(workshopOnly, /pa-next-year-workshop-table/);
  assert.match(workshopOnly, /שם הסדנה/);
  assert.match(workshopOnly, /רוטוקופטר/);
  assert.match(workshopOnly, /1,300/);
  assert.doesNotMatch(workshopOnly, /pa-next-year-course-table/);
  assert.doesNotMatch(workshopOnly, /pa-next-year-combined-total/);

  const mixed = preview([course, workshop]);
  assert.match(mixed, /pa-next-year-course-table/);
  assert.match(mixed, /pa-next-year-workshop-table/);
  assert.match(mixed, /קורסים ותוכניות/);
  assert.match(mixed, /סדנאות/);
  assert.match(mixed, /סה״כ קורסים/);
  assert.match(mixed, /סה״כ סדנאות/);
  assert.match(mixed, /סה״כ כולל להצעה/);
  assert.match(mixed, /10,300/);
  assert.doesNotMatch(mixed, /פעילויות ומחירים/);
  assert.doesNotMatch(mixed, /pa-next-year-activities-table|data-pa-next-year-unified-table/);
});

test('legacy mixed snapshots stay split into course and workshop tables', () => {
  augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document">
    <table class="pa-item-details-table pa-activities-table pa-next-year-course-table">
      <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
      <tbody>
        <tr><td>קורס לדוגמה</td><td>6089</td><td>10</td><td>1</td><td>15</td><td>₪ 600</td><td>₪ 9,000</td></tr>
        <tr><td>סדנאות STEM</td><td></td><td></td><td>2</td><td></td><td>₪ 650</td><td>₪ 1,300</td></tr>
      </tbody>
      <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td><span class="pa-currency-amount">₪ 10,300</span></td></tr></tfoot>
    </table>
  </section>`;

  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  const parsed = new JSDOM(normalized).window.document;
  assert.equal(parsed.querySelectorAll('.pa-next-year-course-table').length, 1);
  assert.equal(parsed.querySelectorAll('.pa-next-year-workshop-table').length, 1);
  assert.match(parsed.body.textContent, /קורסים ותוכניות/);
  assert.match(parsed.body.textContent, /סדנאות/);
  assert.match(parsed.body.textContent, /סה״כ קורסים/);
  assert.match(parsed.body.textContent, /סה״כ סדנאות/);
  assert.match(parsed.body.textContent, /10,300/);
});

test('editor keeps a shared catalog with explicit add controls in both typed sections', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screenSource, /data-pa-next-year-shared-picker="yes"/);
  assert.match(screenSource, /\+ הוסף פעילות/);
  assert.match(screenSource, /renderGroupSection\('next_year_courses'/);
  assert.match(screenSource, /renderGroupSection\('next_year_workshops'/);
  assert.match(screenSource, /data-pa-items-group="\$\{escapeHtml\(groupKey\)\}"/);
  assert.match(screenSource, /data-pa-add-item-group="\$\{escapeHtml\(groupKey\)\}"/);
  assert.doesNotMatch(screenSource, /NEXT_YEAR_UNIFIED_SECTION_TITLE = 'פעילויות ומחירים'/);
});

test('gefen and tour proposal types are unchanged by the תשפ״ז shared-picker payload', () => {
  const payload = augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });
  const options = proposalGroupOptions(payload, [], payload.proposalActivityPricing).map((option) => option.value);
  assert.ok(options.includes('gefen'));
  assert.ok(options.includes('tour'));
  assert.ok(options.includes('next_year'));
  assert.ok(!options.includes('next_year_courses'));
  assert.ok(!options.includes('next_year_workshops'));
});
