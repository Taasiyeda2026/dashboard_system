import test from 'node:test';
import assert from 'node:assert/strict';
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

test('internal section titles are unified under פעילויות ומחירים', () => {
  assert.equal(nextYearInternalSectionTitle('next_year_courses'), 'פעילויות ומחירים');
  assert.equal(nextYearInternalSectionTitle('next_year_workshops'), 'פעילויות ומחירים');
  assert.equal(nextYearInternalSectionTitle('gefen'), '');
  assert.equal(nextYearInternalSectionTitle('tour'), '');
});

test('תשפ״ז preview keeps programs and workshops in one activities table', () => {
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
  assert.match(courseOnly, /פעילויות ומחירים/);
  assert.match(courseOnly, /pa-next-year-activities-table|pa-next-year-course-table/);
  assert.match(courseOnly, /6089|ביומימיקרי|קורס לדוגמה/);
  assert.match(courseOnly, /9,000/);
  assert.doesNotMatch(courseOnly, /קורסים ותוכניות/);
  assert.doesNotMatch(courseOnly, /סה״כ קורסים/);

  const workshopOnly = preview([workshop]);
  assert.match(workshopOnly, /פעילויות ומחירים/);
  assert.match(workshopOnly, /רוטוקופטר/);
  assert.match(workshopOnly, /1,300/);
  assert.doesNotMatch(workshopOnly, /שם הסדנה/);
  assert.doesNotMatch(workshopOnly, /סה״כ סדנאות/);
  assert.doesNotMatch(workshopOnly, /pa-next-year-workshop-table/);

  const mixed = preview([course, workshop]);
  assert.match(mixed, /פעילויות ומחירים/);
  assert.match(mixed, /6089|ביומימיקרי|קורס לדוגמה/);
  assert.match(mixed, /רוטוקופטר/);
  assert.match(mixed, /10,300/);
  assert.equal((mixed.match(/פעילויות ומחירים/g) || []).length, 1);
  assert.doesNotMatch(mixed, /קורסים ותוכניות/);
  assert.doesNotMatch(mixed, /pa-next-year-workshop-heading|>סדנאות</);
  assert.doesNotMatch(mixed, /pa-next-year-combined-total/);
  assert.doesNotMatch(mixed, /סה״כ קורסים|סה״כ סדנאות/);
});

test('legacy dual-table snapshots collapse into one activities table', () => {
  augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document">
    <h4 class="pa-section-heading pa-next-year-course-heading">קורסים ותוכניות</h4>
    <table class="pa-item-details-table pa-activities-table pa-next-year-course-table">
      <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
      <tbody>
        <tr><td>קורס לדוגמה</td><td>6089</td><td>10</td><td>1</td><td>15</td><td>₪ 600</td><td>₪ 9,000</td></tr>
      </tbody>
      <tfoot><tr><td colspan="6">סה״כ קורסים</td><td><span class="pa-currency-amount">₪ 9,000</span></td></tr></tfoot>
    </table>
    <h4 class="pa-section-heading pa-next-year-workshop-heading">סדנאות</h4>
    <table class="pa-item-details-table pa-activities-table pa-next-year-workshop-table">
      <thead><tr><th>סדנה</th><th>משך פעילות</th><th>כמות</th><th>מחיר להפעלה</th><th>סה״כ</th></tr></thead>
      <tbody><tr><td>סדנאות STEM</td><td>45 דקות</td><td>2</td><td>₪ 650</td><td>₪ 1,300</td></tr></tbody>
      <tfoot><tr><td colspan="4">סה״כ סדנאות</td><td>₪ 1,300</td></tr></tfoot>
    </table>
    <table class="pa-cost-table pa-next-year-combined-total"><tbody><tr><td>סה״כ לתשלום</td><td>₪ 10,300</td></tr></tbody></table>
  </section>`;

  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  const parsed = new JSDOM(normalized).window.document;
  assert.equal(parsed.querySelectorAll('.pa-next-year-workshop-table').length, 0);
  assert.equal(parsed.querySelectorAll('.pa-next-year-combined-total').length, 0);
  assert.match(parsed.body.textContent, /פעילויות ומחירים/);
  assert.match(parsed.body.textContent, /קורס לדוגמה/);
  assert.match(parsed.body.textContent, /סדנאות STEM/);
  assert.doesNotMatch(parsed.body.textContent, /קורסים ותוכניות/);
  assert.doesNotMatch(parsed.body.textContent, /סה״כ קורסים/);
  assert.doesNotMatch(parsed.body.textContent, /סה״כ סדנאות/);
});

test('gefen and tour proposal types are unchanged by the תשפ״ז unifier payload', () => {
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
