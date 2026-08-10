import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const moduleUrl = new URL('../frontend/src/proposal-workflow-completion.js', import.meta.url);
const source = await readFile(moduleUrl, 'utf8');
const {
  calculateFormTotals,
  ensureTypeFilterOptions,
  ensureSummerTab,
  installProposalWorkflowCompletion,
  normalizeProposalWorkflowDocument
} = await import(moduleUrl.href);

const course = {
  activity_name: 'אופק יזמות פרימיום בתעשייה',
  activity_no: '52279',
  gefen_number: '52279',
  proposal_group: 'next_year',
  item_type: 'תוכנית',
  unit_price: 13500,
  sort_order: 1,
  is_active_for_proposals: true
};
const workshop = {
  activity_name: 'סדנאות חלל',
  pricing_key: 'space_workshop',
  parent_pricing_key: 'space_workshop',
  proposal_group: 'summer',
  item_type: 'סדנה',
  unit_price: 500,
  proposal_display_mode: 'bundle_parent',
  sort_order: 2,
  is_active_for_proposals: true
};

await (async () => {
  const fakeApi = {
    proposalsAgreements: async () => ({ proposalActivityPricing: [course, workshop] }),
    proposalsAgreementsEditorDeps: async () => ({ proposalActivityPricing: [course, workshop] })
  };
  installProposalWorkflowCompletion(fakeApi, {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });
  await fakeApi.proposalsAgreements();
})();

test('mixed next-year document is normalized into course and workshop tables with restored intro', () => {
  const dom = new JSDOM(`<article class="proposal-document">
    <section class="pa-section">
      <h3 class="pa-section-heading">הפעילות המוצעת</h3>
      <p>להלן הפעילויות המוצעות לשנת הלימודים תשפ״ז. בהתאם לבחירה, ההצעה יכולה לכלול קורסים, סדנאות או שילוב ביניהם.</p>
      <div class="pa-cost-table-block">
        <table class="pa-cost-table pa-activities-table">
          <thead><tr><th>פעילות</th><th>כמות</th><th>מחיר</th><th>סה״כ</th></tr></thead>
          <tbody>
            <tr><td>אופק יזמות פרימיום בתעשייה</td><td>1</td><td>₪ 13,500</td><td>₪ 13,500</td></tr>
            <tr><td>סדנאות חלל</td><td>2</td><td>₪ 500</td><td>₪ 1,000</td></tr>
          </tbody>
          <tfoot><tr><td colspan="3">סה״כ</td><td>₪ 14,500</td></tr></tfoot>
        </table>
      </div>
    </section>
  </article>`);
  normalizeProposalWorkflowDocument(dom.window.document);
  const documentRoot = dom.window.document.querySelector('.proposal-document');
  assert.equal(documentRoot.querySelectorAll('.pa-next-year-course-table tbody tr').length, 1);
  assert.equal(documentRoot.querySelectorAll('.pa-next-year-workshop-table tbody tr').length, 1);
  assert.match(documentRoot.querySelector('.pa-next-year-course-table tfoot').textContent, /סה״כ קורסים/);
  assert.match(documentRoot.querySelector('.pa-next-year-workshop-table tfoot').textContent, /סה״כ סדנאות/);
  assert.match(documentRoot.querySelector('.pa-next-year-combined-total').textContent, /14,500/);
  const summary = documentRoot.querySelector('.pa-next-year-selected-summary').textContent;
  assert.match(summary, /להלן הפעילויות המוצעות לשנת הלימודים תשפ״ז/);
  assert.match(summary, /אופק יזמות פרימיום לתעשייה/);
  assert.match(summary, /סדנאות מייקרים STEM/);
  assert.doesNotMatch(documentRoot.textContent, /ההצעה יכולה לכלול קורסים, סדנאות או שילוב ביניהם/);
});

test('GEFEN editor totals update row, group and proposal total', () => {
  const dom = new JSDOM(`<form data-pa-form>
    <section data-pa-items-group="gefen"><div data-pa-item-row>
      <input data-pa-item-qty value="2"><input data-pa-item-price value="8000">
      <input data-pa-item-total><output data-pa-item-total-display>₪ 0</output>
    </div><strong data-pa-group-total="gefen">₪ 0</strong></section>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select>
    <input data-pa-discount-value value="0">
    <strong data-pa-grand-total>₪ 0</strong><strong data-pa-summary-total>₪ 0</strong>
    <span data-pa-summary-subtotal>₪ 0</span><span data-pa-summary-discount>₪ 0</span>
  </form>`);
  const form = dom.window.document.querySelector('form');
  assert.equal(calculateFormTotals(form), 16000);
  assert.equal(form.querySelector('[data-pa-item-total]').value, '16000.00');
  assert.match(form.querySelector('[data-pa-group-total="gefen"]').textContent, /16,000/);
  assert.match(form.querySelector('[data-pa-grand-total]').textContent, /16,000/);
});

test('proposal type filter is populated and a dedicated summer tab is added', () => {
  const dom = new JSDOM(`<div class="ds-pa-screen">
    <button data-pa-tab="records" class="ds-pa-screen-tab is-active">הצעות</button>
    <select data-pa-filter="activity_type_group"><option value="">הכול</option></select>
    <table data-pa-table><tbody>
      <tr data-pa-row-id="1"><td>1</td><td>קיץ</td></tr>
      <tr data-pa-row-id="2"><td>2</td><td>תשפ״ז</td></tr>
    </tbody></table>
  </div>`);
  const previousEvent = globalThis.Event;
  globalThis.Event = dom.window.Event;
  try {
    ensureTypeFilterOptions(dom.window.document);
    ensureSummerTab(dom.window.document);
  } finally {
    globalThis.Event = previousEvent;
  }
  const values = Array.from(dom.window.document.querySelector('[data-pa-filter]').options).map((option) => option.value);
  assert.deepEqual(values, ['', 'next_year', 'gefen', 'summer', 'tour', 'combined']);
  assert.equal(dom.window.document.querySelectorAll('[data-pa-summer-tab]').length, 1);
});

test('runtime prewarms editor dependencies and leaves approval/PDF ownership to the integrity runtime', () => {
  assert.match(source, /proposalEditorDepsMemoized/);
  assert.match(source, /requestIdleCallback/);
  assert.doesNotMatch(source, /dataset\.paGenerateGefenApproval/);
  assert.doesNotMatch(source, /data-pa-status-action="approved"/);
  assert.doesNotMatch(source, /scheduleAutomaticPdf/);
  assert.match(source, /uploadProposalFinalPdf/);
  assert.match(source, /lockAndSendProposalAgreement/);
});

test('completion runtime delegates Gefen pricing events to the core editor', () => {
  assert.match(source, /isCoreOwnedGefenPricingTarget\(target\)/);
});
