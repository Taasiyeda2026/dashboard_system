import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

const {
  NEXT_YEAR_SHORT_NAMES_BY_GEFEN,
  formatProposalHours,
  formatProposalHourlyPrice,
  normalizeProposalPricingTables,
  normalizeProposalPricingHtml,
  installProposalNextYearPricingDisplay
} = await import('../frontend/src/proposal-next-year-pricing-display.js');

const MIGRATION_FILE = new URL('../supabase/migrations/20260729153500_update_proposal_activity_next_year_pricing.sql', import.meta.url);

test('next-year hours and hourly prices use clean rounded display', () => {
  assert.equal(formatProposalHours('15.00'), '15');
  assert.equal(formatProposalHours('16.50'), '16.5');
  assert.equal(formatProposalHours('12.54'), '12.5');
  assert.equal(formatProposalHourlyPrice('633.3333'), '633');
  assert.equal(formatProposalHourlyPrice('571.4286'), '571');
  assert.equal(formatProposalHourlyPrice('643'), '643');
});

test('next-year course tables use approved short names and rounded numeric display', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <table class="pa-next-year-course-table">
      <tbody>
        <tr>
          <td>יישומי הבינה המלאכותית</td>
          <td>53819</td>
          <td>10</td>
          <td>1</td>
          <td>15.00</td>
          <td><span class="pa-currency-amount money-amount" dir="ltr">₪ 633.33</span></td>
          <td>₪ 9,500</td>
        </tr>
        <tr>
          <td><div class="pa-course-name">אופק יזמות פרימיום לתעשייה</div><div class="pa-course-note">הערה נשמרת</div></td>
          <td>52279</td>
          <td>14</td>
          <td>1</td>
          <td>21.00</td>
          <td><span class="pa-currency-amount money-amount" dir="ltr">₪ 642.8571</span></td>
          <td>₪ 13,500</td>
        </tr>
      </tbody>
    </table>
  </body>`);

  normalizeProposalPricingTables(dom.window.document);

  const rows = dom.window.document.querySelectorAll('tbody > tr');
  assert.equal(rows[0].cells[0].textContent, 'יישומי AI בשיתוף GOOGLE');
  assert.equal(rows[0].cells[4].textContent, '15');
  assert.equal(rows[0].cells[5].textContent, '₪ 633');
  assert.equal(rows[1].querySelector('.pa-course-name').textContent, 'אופק פרימיום');
  assert.equal(rows[1].querySelector('.pa-course-note').textContent, 'הערה נשמרת');
  assert.equal(rows[1].cells[4].textContent, '21');
  assert.equal(rows[1].cells[5].textContent, '₪ 643');
});

test('GEFEN approval table uses the same approved short names', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <table class="pa-gefen-course-table pa-gefen-approval-table">
      <tbody><tr>
        <td>☐</td><td>אופק יזמות פרימיום לתעשייה</td><td>52279</td><td>14</td>
        <td>21.00</td><td><span class="pa-currency-amount">₪ 642.8571</span></td><td>1</td><td>₪ 13,500</td>
      </tr></tbody>
    </table>
  </body>`);

  normalizeProposalPricingTables(dom.window.document);
  const cells = dom.window.document.querySelector('tbody > tr').cells;
  assert.equal(cells[1].textContent, NEXT_YEAR_SHORT_NAMES_BY_GEFEN['52279']);
  assert.equal(cells[4].textContent, '21');
  assert.equal(cells[5].textContent, '₪ 643');
});

test('saved HTML snapshots are normalized before upload and lock', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const calls = [];
  const fakeApi = {
    async uploadProposalFinalPdf(id, payload) {
      calls.push({ method: 'upload', id, payload });
      return { ok: true };
    },
    async lockAndSendProposalAgreement(id, payload) {
      calls.push({ method: 'lock', id, payload });
      return { ok: true };
    }
  };

  assert.equal(installProposalNextYearPricingDisplay(fakeApi, dom.window), true);
  assert.equal(installProposalNextYearPricingDisplay(fakeApi, dom.window), false);

  const sourceHtml = `<table class="pa-next-year-course-table"><tbody><tr>
    <td>יישומי הבינה המלאכותית</td><td>53819</td><td>10</td><td>1</td><td>15.00</td>
    <td><span class="pa-currency-amount">₪ 633.3333</span></td><td>₪ 9,500</td>
  </tr></tbody></table>`;

  await fakeApi.uploadProposalFinalPdf('proposal-1', { documentHtmlSnapshot: sourceHtml });
  await fakeApi.lockAndSendProposalAgreement('proposal-1', { documentHtmlSnapshot: sourceHtml });

  for (const call of calls) {
    assert.match(call.payload.documentHtmlSnapshot, /יישומי AI בשיתוף GOOGLE/);
    assert.match(call.payload.documentHtmlSnapshot, />15<\/td>/);
    assert.match(call.payload.documentHtmlSnapshot, /₪(?: |&nbsp;)633/);
    assert.doesNotMatch(call.payload.documentHtmlSnapshot, /633\.3333/);
  }

  const normalized = normalizeProposalPricingHtml(sourceHtml, dom.window.document);
  assert.match(normalized, /יישומי AI בשיתוף GOOGLE/);
});

test('pricing migration updates both active sources with the approved values', async () => {
  const migration = await readFile(MIGRATION_FILE, 'utf8');
  assert.match(migration, /update public\.proposal_activity_pricing/i);
  assert.match(migration, /insert into public\.proposal_gefen_courses/i);
  assert.match(migration, /'יישומי AI בשיתוף GOOGLE', 'יישומי AI במציאות טכנולוגית חדשנית', '53819', 10[^\n]*633[^\n]*15[^\n]*9500/);
  assert.match(migration, /'אופק פרימיום', 'אופק יזמות פרימיום בתעשייה', '52279', 14[^\n]*643[^\n]*21[^\n]*13500/);
  assert.match(migration, /'משחקי קופסה', 'פיתוח ופיצוח משחקי לוח', '27342', 12[^\n]*550[^\n]*18[^\n]*9900/);
  assert.match(migration, /'מנהיגות ירוקה', 'מנהיגות ירוקה', '67867', 10[^\n]*640[^\n]*15[^\n]*9600/);
  assert.match(migration, /'השמיים אינם הגבול', 'השמיים אינם הגבול - תוכנית חלל', '57646', 10[^\n]*640[^\n]*15[^\n]*9600/);
  assert.match(migration, /Historical proposal_agreement_items and locked proposal snapshots are intentionally not changed/);
});