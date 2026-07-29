import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const {
  augmentNextYearPricingRows,
  augmentNextYearProposalPayload,
  normalizeNextYearWorkshopHtml,
  installProposalNextYearWorkshops
} = await import('../frontend/src/proposal-next-year-workshops.js');

const MIGRATION_FILE = new URL('../supabase/migrations/20260729192000_add_workshops_to_next_year_proposals.sql', import.meta.url);

const baseGroups = [
  { group_key: 'summer', display_name: 'פעילויות קיץ', template_key: 'summer', included_group_keys: [] },
  { group_key: 'next_year', display_name: 'שנה הבאה', template_key: 'next_year', included_group_keys: [] }
];

const basePricing = [
  { pricing_key: 'course_1', activity_name: 'קורס לדוגמה', proposal_group: 'next_year', group_key: 'next_year', item_type: 'תוכנית', unit_price: 9000 },
  { pricing_key: 'maker_workshop', activity_name: 'סדנאות STEM', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 650, proposal_display_mode: 'bundle_parent' },
  { pricing_key: 'workshop_001', parent_pricing_key: 'maker_workshop', activity_name: 'רוטוקופטר', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 650, proposal_display_mode: 'bundle_child' },
  { pricing_key: 'space_workshop', activity_name: 'סדנאות חלל', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 500, proposal_display_mode: 'bundle_parent' },
  { pricing_key: 'workshop_034', parent_pricing_key: 'space_workshop', activity_name: 'מערכת השמש', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 450, proposal_display_mode: 'bundle_child' },
  { pricing_key: 'digital_escape_room', activity_name: 'חדרי בריחה', proposal_group: 'summer', group_key: 'summer', item_type: 'חדר בריחה', unit_price: 450, proposal_display_mode: 'bundle_parent' },
  { pricing_key: 'escape_digital_room_detail', parent_pricing_key: 'digital_escape_room', activity_name: 'חדר בריחה דיגיטלי', proposal_group: 'summer', group_key: 'summer', item_type: 'חדר בריחה', unit_price: 450, proposal_display_mode: 'bundle_child' }
];

test('next-year payload exposes separate course and workshop sections without duplicating escape rooms', () => {
  const payload = augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });

  const nextYear = payload.proposalActivityGroups.find((group) => group.group_key === 'next_year');
  assert.deepEqual(nextYear.included_group_keys, ['next_year_courses', 'next_year_workshops']);
  assert.equal(payload.proposalActivityGroups.find((group) => group.group_key === 'next_year_courses').display_name, 'קורסים');
  assert.equal(payload.proposalActivityGroups.find((group) => group.group_key === 'next_year_workshops').display_name, 'סדנאות');

  const courseAliases = payload.proposalActivityPricing.filter((row) => row.group_key === 'next_year_courses');
  const workshopAliases = payload.proposalActivityPricing.filter((row) => row.group_key === 'next_year_workshops');
  assert.deepEqual(courseAliases.map((row) => row.activity_name), ['קורס לדוגמה']);
  assert.deepEqual(workshopAliases.map((row) => row.activity_name).sort(), ['מערכת השמש', 'סדנאות STEM', 'סדנאות חלל', 'רוטוקופטר'].sort());
  assert.equal(workshopAliases.some((row) => /בריחה/.test(row.activity_name)), false);
  assert.equal(workshopAliases.every((row) => row.template_key === 'summer'), true);
});

test('pricing augmentation is idempotent', () => {
  const once = augmentNextYearPricingRows(basePricing);
  const twice = augmentNextYearPricingRows(once);
  const identities = twice.map((row) => [row.group_key, row.pricing_key, row.activity_name].join('|'));
  assert.equal(new Set(identities).size, identities.length);
});

test('mixed next-year document splits workshops into a dedicated table', () => {
  augmentNextYearPricingRows(basePricing);
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document"><table class="pa-item-details-table pa-activities-table pa-next-year-course-table">
    <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
    <tbody>
      <tr><td>קורס לדוגמה</td><td>6089</td><td>10</td><td>1</td><td>15</td><td>₪ 600</td><td>₪ 9,000</td></tr>
      <tr><td>סדנאות STEM</td><td></td><td></td><td>2</td><td></td><td>₪ 650</td><td>₪ 1,300</td></tr>
    </tbody>
    <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td><span class="pa-currency-amount">₪ 10,300</span></td></tr></tfoot>
  </table></section>`;

  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  assert.match(normalized, /pa-next-year-workshop-table/);
  assert.match(normalized, /קורסים ותוכניות/);
  assert.match(normalized, /סדנאות/);
  assert.match(normalized, /משך פעילות/);
  assert.match(normalized, /45 דקות/);
  assert.match(normalized, /סה״כ קורסים/);
  assert.match(normalized, /סה״כ סדנאות/);
  assert.match(normalized, /10,300/);
  assert.equal((normalized.match(/סדנאות STEM/g) || []).length, 1);
});

test('workshop-only next-year document removes the empty course table', () => {
  augmentNextYearPricingRows(basePricing);
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document"><table class="pa-next-year-course-table">
    <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
    <tbody><tr><td>סדנאות חלל</td><td></td><td></td><td>1</td><td></td><td>₪ 500</td><td>₪ 500</td></tr></tbody>
    <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td>₪ 500</td></tr></tfoot>
  </table></section>`;
  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  assert.match(normalized, /pa-next-year-workshop-table/);
  assert.doesNotMatch(normalized, /pa-next-year-course-table/);
  assert.match(normalized, /סה״כ לתשלום/);
});

test('installer augments loaders and normalizes saved snapshots', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const saved = [];
  const fakeApi = {
    async proposalsAgreements() {
      return { proposalActivityGroups: baseGroups, proposalActivityPricing: basePricing };
    },
    async readProposalActivityPricing() { return basePricing; },
    async readProposalActivityGroups() { return baseGroups; },
    async uploadProposalFinalPdf(id, payload) { saved.push({ id, payload }); return { ok: true }; },
    async lockAndSendProposalAgreement(id, payload) { saved.push({ id, payload }); return { ok: true }; }
  };

  assert.equal(installProposalNextYearWorkshops(fakeApi, dom.window), true);
  assert.equal(installProposalNextYearWorkshops(fakeApi, dom.window), false);
  const loaded = await fakeApi.proposalsAgreements();
  assert.equal(loaded.proposalActivityPricing.some((row) => row.group_key === 'next_year_workshops'), true);

  const source = `<section class="proposal-document"><table class="pa-next-year-course-table"><tbody>
    <tr><td>סדנאות STEM</td><td></td><td></td><td>1</td><td></td><td>₪ 650</td><td>₪ 650</td></tr>
  </tbody><tfoot><tr><td colspan="6">סה״כ</td><td>₪ 650</td></tr></tfoot></table></section>`;
  await fakeApi.uploadProposalFinalPdf('proposal-1', { documentHtmlSnapshot: source });
  assert.match(saved[0].payload.documentHtmlSnapshot, /pa-next-year-workshop-table/);
});

test('migration creates internal sections, updates next-year copy and leaves escape room excluded', async () => {
  const migration = await readFile(MIGRATION_FILE, 'utf8');
  assert.match(migration, /next_year_courses/);
  assert.match(migration, /next_year_workshops/);
  assert.match(migration, /included_group_keys = array\['next_year_courses', 'next_year_workshops'\]/);
  assert.match(migration, /קורסים, סדנאות או שילוב ביניהם/);
  assert.match(migration, /digital escape room intentionally remains summer-only/i);
  assert.match(migration, /Historical proposal items, locked snapshots and sent PDFs are not modified/);
});
