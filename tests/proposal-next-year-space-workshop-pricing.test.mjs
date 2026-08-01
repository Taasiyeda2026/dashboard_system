import test from 'node:test';
import assert from 'node:assert/strict';

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
  applyNextYearSpaceWorkshopPrice,
  normalizeNextYearSpaceWorkshopPayload,
  installNextYearSpaceWorkshopPricing
} = await import('../frontend/src/proposal-next-year-space-workshop-pricing.js');

const rows = [
  {
    pricing_key: 'workshop_034',
    parent_pricing_key: 'space_workshop',
    activity_name: 'מערכת השמש',
    group_key: 'summer',
    unit_price: 450,
    hourly_price: 450
  },
  {
    pricing_key: 'space_workshop',
    activity_name: 'סדנאות חלל',
    group_key: 'next_year_workshops',
    unit_price: 450,
    hourly_price: 450
  },
  {
    pricing_key: 'workshop_034',
    parent_pricing_key: 'space_workshop',
    activity_name: 'מערכת השמש',
    group_key: 'next_year_workshops',
    unit_price: 450,
    hourly_price: 450
  },
  {
    pricing_key: 'workshop_003',
    parent_pricing_key: 'maker_workshop',
    activity_name: 'רוטוקופטר',
    group_key: 'next_year_workshops',
    unit_price: 650,
    hourly_price: 650
  }
];

test('sets only next-year space workshop prices to 500', () => {
  const updated = applyNextYearSpaceWorkshopPrice(rows);

  assert.equal(updated[0].unit_price, 450, 'summer source price must remain unchanged');
  assert.equal(updated[1].unit_price, 500);
  assert.equal(updated[1].hourly_price, 500);
  assert.equal(updated[2].unit_price, 500);
  assert.equal(updated[2].hourly_price, 500);
  assert.equal(updated[3].unit_price, 650, 'STEM workshop pricing must remain unchanged');
});

test('normalizes proposal payload and API loaders', async () => {
  const payload = normalizeNextYearSpaceWorkshopPayload({ proposalActivityPricing: rows });
  assert.equal(payload.proposalActivityPricing[2].unit_price, 500);

  const fakeApi = {
    async proposalsAgreements() {
      return { proposalActivityPricing: rows };
    },
    async proposalsAgreementsEditorDeps() {
      return { proposalActivityPricing: rows };
    },
    async readProposalActivityPricing() {
      return rows;
    }
  };

  assert.equal(installNextYearSpaceWorkshopPricing(fakeApi), true);
  assert.equal(installNextYearSpaceWorkshopPricing(fakeApi), false);

  const loadedPayload = await fakeApi.proposalsAgreements();
  const loadedDeps = await fakeApi.proposalsAgreementsEditorDeps();
  const loadedRows = await fakeApi.readProposalActivityPricing();
  assert.equal(loadedPayload.proposalActivityPricing[1].unit_price, 500);
  assert.equal(loadedDeps.proposalActivityPricing[1].unit_price, 500);
  assert.equal(loadedRows[2].hourly_price, 500);
});
