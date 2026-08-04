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
const {
  proposalGroupOptions,
  proposalPreviewBodyHtml
} = await import('../frontend/src/screens/proposals-agreements.js');

const MIGRATION_FILE = new URL('../supabase/migrations/20260729192000_add_workshops_to_next_year_proposals.sql', import.meta.url);
const TEMPLATE_FIX_MIGRATION_FILE = new URL('../supabase/migrations/20260729210000_keep_next_year_workshops_on_next_year_template.sql', import.meta.url);
const LABEL_MIGRATION_FILE = new URL('../supabase/migrations/20260729230000_label_next_year_subgroups.sql', import.meta.url);

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
  { pricing_key: 'workshop_inactive', parent_pricing_key: 'maker_workshop', activity_name: 'סדנה לא פעילה', proposal_group: 'summer', group_key: 'summer', item_type: 'סדנה', unit_price: 650, is_active_for_proposals: false },
  { pricing_key: 'digital_escape_room', activity_name: 'חדרי בריחה', proposal_group: 'summer', group_key: 'summer', item_type: 'חדר בריחה', unit_price: 450, proposal_display_mode: 'bundle_parent' },
  { pricing_key: 'escape_digital_room_detail', parent_pricing_key: 'digital_escape_room', activity_name: 'חדר בריחה דיגיטלי', proposal_group: 'summer', group_key: 'summer', item_type: 'חדר בריחה', unit_price: 450, proposal_display_mode: 'bundle_child' }
];

test('next-year payload exposes separate course and workshop sections without escape rooms', () => {
  const payload = augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });

  const nextYear = payload.proposalActivityGroups.find((group) => group.group_key === 'next_year');
  assert.deepEqual(nextYear.included_group_keys, ['next_year_courses', 'next_year_workshops']);
  assert.equal(payload.proposalActivityGroups.find((group) => group.group_key === 'next_year_courses').display_name, 'תשפ״ז (קורסים)');
  assert.equal(payload.proposalActivityGroups.find((group) => group.group_key === 'next_year_workshops').display_name, 'תשפ״ז (סדנאות)');

  const courseAliases = payload.proposalActivityPricing.filter((row) => row.group_key === 'next_year_courses');
  const workshopAliases = payload.proposalActivityPricing.filter((row) => row.group_key === 'next_year_workshops');
  assert.deepEqual(courseAliases.map((row) => row.activity_name), ['קורס לדוגמה']);
  assert.deepEqual(workshopAliases.map((row) => row.activity_name).sort(), ['מערכת השמש', 'סדנאות STEM', 'סדנאות חלל', 'רוטוקופטר'].sort());
  assert.equal(workshopAliases.some((row) => /בריחה/.test(row.activity_name)), false);
  assert.equal(workshopAliases.some((row) => row.is_active_for_proposals === false), false);
  assert.equal(workshopAliases.every((row) => row.template_key === 'next_year'), true);
  assert.equal(workshopAliases.find((row) => row.activity_name === 'מערכת השמש').proposal_display_mode, 'single');
  assert.equal(workshopAliases.find((row) => row.activity_name === 'רוטוקופטר').proposal_display_mode, 'single');
  assert.equal(workshopAliases.find((row) => row.activity_name === 'סדנאות STEM').proposal_display_mode, 'bundle_parent');
  assert.equal(workshopAliases.find((row) => row.activity_name === 'סדנאות חלל').proposal_display_mode, 'bundle_parent');
  assert.equal(payload.proposalActivityGroups.find((group) => group.group_key === 'next_year_workshops').template_key, 'next_year');
  assert.deepEqual(new Set(proposalGroupOptions(payload, [], payload.proposalActivityPricing).map((option) => option.value)), new Set(['next_year', 'summer']));
});

test('pricing augmentation is idempotent', () => {
  const once = augmentNextYearPricingRows(basePricing);
  const twice = augmentNextYearPricingRows(once);
  const identities = twice.map((row) => [row.group_key, row.pricing_key, row.activity_name].join('|'));
  assert.equal(new Set(identities).size, identities.length);
});

test('mixed next-year document keeps workshops in one unified activities table', () => {
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
  assert.match(normalized, /pa-next-year-activities-table|pa-next-year-course-table/);
  assert.match(normalized, /פעילויות ומחירים/);
  assert.doesNotMatch(normalized, /pa-next-year-workshop-table/);
  assert.doesNotMatch(normalized, /סה״כ קורסים|סה״כ סדנאות/);
  assert.match(normalized, /10,300/);
  assert.equal((normalized.match(/סדנאות STEM/g) || []).length, 1);
});

test('next-year editor and preview labels use the unified activities title', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<div>
    <div data-pa-items-group="next_year_courses"><div class="ds-pa-items-header"><span class="ds-pa-items-section-label">תשפ״ז</span></div></div>
    <div data-pa-items-group="next_year_workshops"><div class="ds-pa-items-header"><span class="ds-pa-items-section-label">תשפ״ז</span></div></div>
    <section class="proposal-document">
      <section class="pa-section"><h3 class="pa-section-heading">תשפ״ז</h3><div class="pa-section-body">קורסים</div></section>
      <section class="pa-section"><h3 class="pa-section-heading">תשפ״ז</h3><div class="pa-section-body">סדנאות</div></section>
      <table class="pa-next-year-course-table"><tbody><tr><td>קורס</td></tr></tbody></table>
    </section>
  </div>`;
  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  const parsed = new JSDOM(normalized).window.document;
  assert.equal(parsed.querySelector('[data-pa-items-group="next_year_courses"] .ds-pa-items-section-label').textContent, 'פעילויות ומחירים');
  assert.equal(parsed.querySelector('[data-pa-items-group="next_year_workshops"] .ds-pa-items-section-label').textContent, 'פעילויות ומחירים');
  const headings = Array.from(parsed.querySelectorAll('.proposal-document .pa-section > .pa-section-heading')).map((element) => element.textContent);
  assert.deepEqual(headings, ['פעילויות ומחירים', 'פעילויות ומחירים']);
  const table = parsed.querySelector('.pa-next-year-course-table, .pa-next-year-activities-table');
  assert.equal(table.style.width, '85%');
  assert.equal(table.style.marginInline, 'auto');
  assert.equal(table.style.tableLayout, 'fixed');
});

test('workshop-only next-year document stays on one unified activities table', () => {
  augmentNextYearPricingRows(basePricing);
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document"><table class="pa-next-year-course-table">
    <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
    <tbody><tr><td>סדנאות חלל</td><td></td><td></td><td>1</td><td></td><td>₪ 500</td><td>₪ 500</td></tr></tbody>
    <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td>₪ 500</td></tr></tfoot>
  </table></section>`;
  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  assert.match(normalized, /pa-next-year-activities-table|pa-next-year-course-table/);
  assert.doesNotMatch(normalized, /pa-next-year-workshop-table/);
  assert.match(normalized, /סה״כ לתשלום/);
});

test('installer augments loaders and normalizes saved snapshots', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const saved = [];
  const fakeApi = {
    async proposalsAgreements() {
      return { proposalActivityGroups: baseGroups, proposalActivityPricing: basePricing };
    },
    async proposalsAgreementsEditorDeps() {
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
  const editorDeps = await fakeApi.proposalsAgreementsEditorDeps();
  assert.equal(editorDeps.proposalActivityPricing.some((row) => row.group_key === 'next_year_workshops'), true);
  assert.deepEqual(
    editorDeps.proposalActivityGroups.find((group) => group.group_key === 'next_year').included_group_keys,
    ['next_year_courses', 'next_year_workshops']
  );

  const source = `<section class="proposal-document"><table class="pa-next-year-course-table"><tbody>
    <tr><td>סדנאות STEM</td><td></td><td></td><td>1</td><td></td><td>₪ 650</td><td>₪ 650</td></tr>
  </tbody><tfoot><tr><td colspan="6">סה״כ</td><td>₪ 650</td></tr></tfoot></table></section>`;
  await fakeApi.uploadProposalFinalPdf('proposal-1', { documentHtmlSnapshot: source });
  assert.match(saved[0].payload.documentHtmlSnapshot, /pa-next-year-activities-table|pa-next-year-course-table/);
  assert.doesNotMatch(saved[0].payload.documentHtmlSnapshot, /pa-next-year-workshop-table/);
});

test('normalization leaves internal editor select options untouched', () => {
  const dom = new JSDOM('<form data-pa-form><select><option value="next_year_courses">קורסים</option><option value="next_year_workshops">סדנאות</option></select></form>');
  const normalized = normalizeNextYearWorkshopHtml(dom.serialize(), dom.window.document);
  assert.match(normalized, /value="next_year_courses"/);
  assert.match(normalized, /value="next_year_workshops"/);
});

test('real next-year preview renders workshop-only, course-only and mixed saved items in one table', () => {
  const payload = augmentNextYearProposalPayload({
    proposalActivityGroups: baseGroups,
    proposalActivityPricing: basePricing
  });
  proposalGroupOptions(payload, [], payload.proposalActivityPricing);
  const row = { activity_type_group: 'next_year', proposal_date: '2026-07-29' };
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

  const workshopOnly = proposalPreviewBodyHtml(row, [workshop], []);
  assert.match(workshopOnly, /פעילויות ומחירים/);
  assert.match(workshopOnly, /רוטוקופטר/);
  assert.match(workshopOnly, /1,300/);
  assert.doesNotMatch(workshopOnly, /pa-next-year-workshop-table/);
  assert.doesNotMatch(workshopOnly, /שם הסדנה/);

  const courseOnly = proposalPreviewBodyHtml(row, [course], []);
  assert.match(courseOnly, /pa-next-year-course-table|pa-next-year-activities-table/);
  assert.match(courseOnly, /פעילויות ומחירים/);
  assert.doesNotMatch(courseOnly, /pa-next-year-workshop-table/);
  assert.doesNotMatch(courseOnly, /קורסים ותוכניות/);

  const mixed = proposalPreviewBodyHtml(row, [course, workshop], []);
  assert.match(mixed, /pa-next-year-course-table|pa-next-year-activities-table/);
  assert.doesNotMatch(mixed, /pa-next-year-workshop-table/);
  assert.match(mixed, /סה״כ לתשלום/);
  assert.doesNotMatch(mixed, /סה״כ קורסים|סה״כ סדנאות|סה״כ כולל להצעה/);
  assert.match(mixed, /10,300/);
  assert.equal((mixed.match(/רוטוקופטר/g) || []).length, 1);
});

test('the editor live preview normalizes only its freshly rendered host', async () => {
  const screenSource = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  const renderStart = screenSource.indexOf('const renderLivePreview = (form) =>');
  const renderBody = screenSource.slice(renderStart, screenSource.indexOf('// ── Items calc', renderStart));
  assert.match(renderBody, /previewHost\.innerHTML = proposalPreviewBodyHtml/);
  assert.match(renderBody, /proposalPdfDocumentNormalizer\?\.\(previewHost\)/);
  assert.doesNotMatch(renderBody, /normalizeNextYearWorkshopTables\(document/);

  const payload = augmentNextYearProposalPayload({ proposalActivityGroups: baseGroups, proposalActivityPricing: basePricing });
  proposalGroupOptions(payload, [], payload.proposalActivityPricing);
  const mixed = proposalPreviewBodyHtml(
    { activity_type_group: 'next_year', proposal_date: '2026-08-02' },
    [
      { item_name: 'קורס לדוגמה', proposal_group: 'next_year_courses', quantity: 1, unit_price: 9000, total_price: 9000, gefen_number: '6089' },
      { item_name: 'רוטוקופטר', proposal_group: 'next_year_workshops', quantity: 1, unit_price: 650, total_price: 650 }
    ],
    []
  );
  assert.match(mixed, /pa-next-year-course-table|pa-next-year-activities-table/);
  assert.doesNotMatch(mixed, /pa-next-year-workshop-table/);
  assert.doesNotMatch(mixed, /pa-next-year-combined-total/);
});

test('migration creates internal sections and leaves escape room excluded', async () => {
  const migration = await readFile(MIGRATION_FILE, 'utf8');
  const templateFixMigration = await readFile(TEMPLATE_FIX_MIGRATION_FILE, 'utf8');
  const labelMigration = await readFile(LABEL_MIGRATION_FILE, 'utf8');
  assert.match(migration, /next_year_courses/);
  assert.match(migration, /next_year_workshops/);
  assert.match(migration, /included_group_keys = array\['next_year_courses', 'next_year_workshops'\]/);
  assert.match(migration, /קורסים, סדנאות או שילוב ביניהם/);
  assert.match(migration, /digital escape room intentionally remains summer-only/i);
  assert.match(migration, /Historical proposal items, locked snapshots and sent PDFs are not modified/);
  assert.match(templateFixMigration, /where group_key = 'next_year_workshops'/);
  assert.match(templateFixMigration, /template_key = 'next_year'/);
  assert.doesNotMatch(templateFixMigration, /proposal_activity_pricing/);
  assert.match(labelMigration, /תשפ״ז \(קורסים\)/);
  assert.match(labelMigration, /תשפ״ז \(סדנאות\)/);
});
