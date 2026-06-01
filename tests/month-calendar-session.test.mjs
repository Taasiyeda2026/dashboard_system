import { test } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries).map(([k, v]) => [k, String(v)]));
  }
  get length() { return this.store.size; }
  key(index) { return Array.from(this.store.keys())[index] ?? null; }
  getItem(key) { return this.store.has(String(key)) ? this.store.get(String(key)) : null; }
  setItem(key, value) { this.store.set(String(key), String(value)); }
  removeItem(key) { this.store.delete(String(key)); }
  clear() { this.store.clear(); }
}

const RealDate = globalThis.Date;
function installFixedJune2026Date() {
  globalThis.Date = class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate('2026-06-01T12:00:00Z');
      return new RealDate(...args);
    }
    static now() { return new RealDate('2026-06-01T12:00:00Z').getTime(); }
    static parse(value) { return RealDate.parse(value); }
    static UTC(...args) { return RealDate.UTC(...args); }
  };
}

test.after(() => {
  globalThis.Date = RealDate;
});

async function importFreshState() {
  return import(`../frontend/src/state.js?month-session-test=${Date.now()}-${Math.random()}`);
}

test('legacy localStorage month does not set the month screen default on a new entry', async () => {
  installFixedJune2026Date();
  globalThis.localStorage = new MemoryStorage({
    dashboard_user: JSON.stringify({ user_id: 'u1' }),
    dashboard_token: 'token',
    'dashboard_calendar_month_ym:u1': '2026-05'
  });
  globalThis.sessionStorage = new MemoryStorage({ ds_session_alive: '1' });

  const { state } = await importFreshState();
  assert.equal(state.monthYm, '');
  assert.equal(globalThis.localStorage.getItem('dashboard_calendar_month_ym:u1'), null);

  const { monthScreen } = await import('../frontend/src/screens/month.js');
  let requestedYm = '';
  await monthScreen.load({
    state,
    api: { month: ({ ym }) => { requestedYm = ym; return Promise.resolve({ month: ym, cells: [], items_by_id: {} }); } }
  });

  assert.equal(requestedYm, '2026-06');
});

test('sessionStorage month is used only as the temporary month selection for the active session', async () => {
  installFixedJune2026Date();
  globalThis.localStorage = new MemoryStorage({
    dashboard_user: JSON.stringify({ user_id: 'u1' }),
    dashboard_token: 'token',
    'dashboard_calendar_month_ym:u1': '2026-04'
  });
  globalThis.sessionStorage = new MemoryStorage({
    ds_session_alive: '1',
    'dashboard_calendar_month_ym_session:u1': '2026-05'
  });

  const { state, calendarMonthSessionKey } = await importFreshState();
  assert.equal(calendarMonthSessionKey('u1'), 'dashboard_calendar_month_ym_session:u1');
  assert.equal(state.monthYm, '2026-05');
  assert.equal(globalThis.localStorage.getItem('dashboard_calendar_month_ym:u1'), null);

  const { monthScreen } = await import('../frontend/src/screens/month.js');
  let requestedYm = '';
  await monthScreen.load({
    state,
    api: { month: ({ ym }) => { requestedYm = ym; return Promise.resolve({ month: ym, cells: [], items_by_id: {} }); } }
  });

  assert.equal(requestedYm, '2026-05');
});
