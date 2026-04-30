import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const WEEK_MODULE = new URL('../frontend/src/screens/week.js', import.meta.url).href;
const MONTH_MODULE = new URL('../frontend/src/screens/month.js', import.meta.url).href;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.localStorage = dom.window.localStorage;
  return dom;
}

async function freshModules() {
  const week = await import(`${WEEK_MODULE}?v=${Date.now()}-${Math.random()}`);
  const month = await import(`${MONTH_MODULE}?v=${Date.now()}-${Math.random()}`);
  return { weekScreen: week.weekScreen, monthScreen: month.monthScreen };
}

test('month nav: next/prev update ym, trigger rerender, and do single fetch', async () => {
  setupDom();
  const { monthScreen } = await freshModules();
  const state = { monthYm: '2026-04', monthNavLoading: false, screenDataCache: {} };
  const root = document.createElement('div');
  root.innerHTML = monthScreen.render({ month: '2026-04', cells: [], items_by_id: {} }, { state });
  let rerenders = 0;
  const calls = [];
  const api = { month: async (payload) => { calls.push(payload); return { month: payload.ym, cells: [], items_by_id: {} }; } };
  monthScreen.bind({ root, ui: { bindInteractiveCards() {} }, data: { month: '2026-04', cells: [], items_by_id: {} }, state, rerender: () => { rerenders += 1; }, api });

  const nextBtn = root.querySelector('[data-month-next]');
  const prevBtn = root.querySelector('[data-month-prev]');
  assert.equal(nextBtn?.disabled, false);
  assert.equal(prevBtn?.disabled, false);

  nextBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.monthYm, '2026-05');
  assert.equal(calls.length, 1);

  state.monthNavLoading = false;
  prevBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.monthYm, '2026-04');
  assert.equal(calls.length, 2);
  assert.ok(rerenders >= 2);
});

test('week nav: next/prev update weekOffset, trigger rerender, and do single fetch per click', async () => {
  setupDom();
  const { weekScreen } = await freshModules();
  const state = { weekOffset: 0, weekNavLoading: false, screenDataCache: {}, clientSettings: {}, user: {} };
  const data = { days: [], items_by_id: {} };
  const root = document.createElement('div');
  root.innerHTML = weekScreen.render(data, { state });
  let rerenders = 0;
  const calls = [];
  const api = { week: async (payload) => { calls.push(payload); return data; } };
  weekScreen.bind({ root, ui: { bindInteractiveCards() {}, openDrawer() {} }, data, state, rerender: () => { rerenders += 1; }, api });

  const nextBtn = root.querySelector('[data-week-next]');
  const prevBtn = root.querySelector('[data-week-prev]');
  assert.equal(nextBtn?.disabled, false);
  assert.equal(prevBtn?.disabled, false);

  nextBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.weekOffset, 1);
  assert.equal(calls.length, 1);

  state.weekNavLoading = false;
  prevBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.weekOffset, 0);
  assert.equal(calls.length, 2);
  assert.ok(rerenders >= 2);
});

test('navigation logic is independent from diagnostics/read-model hooks', async () => {
  const fs = await import('node:fs/promises');
  const weekSrc = await fs.readFile(new URL('../frontend/src/screens/week.js', import.meta.url), 'utf8');
  const monthSrc = await fs.readFile(new URL('../frontend/src/screens/month.js', import.meta.url), 'utf8');
  assert.equal(/diagnosticsPing|diagnosticsConsistency|readModel|prefetch/i.test(weekSrc), false);
  assert.equal(/diagnosticsPing|diagnosticsConsistency|readModel|prefetch/i.test(monthSrc), false);
});
