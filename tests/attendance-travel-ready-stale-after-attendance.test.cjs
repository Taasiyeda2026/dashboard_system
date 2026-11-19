const test = require('node:test');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {};
    this.attrs = {}; this.style = { setProperty() {} }; this.disabled = false; this.hidden = false;
    this._text = ''; this._value = ''; this.className = '';
    this.classList = {
      add: (...s) => { this.className += ' ' + s.join(' '); },
      remove() {}, toggle() {},
    };
  }
  append(...nodes) {
    for (const n of nodes) {
      this.children.push(typeof n === 'string' ? Object.assign(new El('text'), { textContent: n }) : n);
      if (n && typeof n === 'object') n.parent = this;
    }
  }
  prepend(...nodes) {
    const prepared = nodes.map((n) => (typeof n === 'string'
      ? Object.assign(new El('text'), { textContent: n })
      : n));
    for (const n of prepared) {
      if (n && typeof n === 'object') n.parent = this;
    }
    this.children.unshift(...prepared);
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  get isConnected() { return true; }
  closest() { return null; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((n) => n.textContent).join(''); }
  set innerHTML(t) { this.textContent = t; }
  get innerHTML() { return this.textContent; }
  set value(v) { this._value = String(v); }
  get value() { return this._value || (this.tagName === 'select' ? this.options[0]?.value || '' : ''); }
  get options() { return this.children.filter((n) => n.tagName === 'option'); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); }
  async fire(type) {
    let node = this;
    const event = { type, target: this, preventDefault() {} };
    while (node) {
      for (const fn of node.listeners[type] || []) await fn(event);
      node = node.parent;
    }
  }
  contains(n) { return n === this || this.children.some((c) => c.contains?.(n)); }
  focus() {}
  blur() {}
  matches(s) {
    if (s.startsWith('.')) return this.className.split(/\s+/).filter(Boolean).includes(s.slice(1));
    if (s.startsWith('#')) return this.id === s.slice(1);
    const data = s.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (data) {
      const key = data[1].replace(/-([a-z])/g, (_, a) => a.toUpperCase());
      return key in this.dataset && (data[2] === undefined || this.dataset[key] === data[2]);
    }
    return this.tagName === s;
  }
  querySelectorAll(s) {
    return this.children.flatMap((n) => [...(n.matches?.(s) ? [n] : []), ...(n.querySelectorAll?.(s) || [])]);
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}

function setupMohammedScenario() {
  const document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => Object.assign(new El('text'), { textContent: t }),
    addEventListener() {},
  };
  const ctx = {
    console, document, Event: class { constructor(type) { this.type = type; } },
    Date, Number, Map, Set, JSON, Promise, Boolean,
  };
  vm.createContext(ctx);
  for (const f of [
    'components/field.js',
    'components/compact-select.js',
    'components/bounded-month-picker.js',
    'services/daily-travel.js',
    'services/travel-readiness-sync.js',
  ]) {
    const s = fs.readFileSync(`${__dirname}/../attendance/src/${f}`, 'utf8')
      .replace(/^import .*?;\n/gm, '')
      .replace(/export /g, '');
    vm.runInContext(s, ctx);
  }

  let assigned = [
    { date: '2026-11-04', ready: true, review_status: 'pending_review', activities: 'פעילות' },
    { date: '2026-11-09', ready: false, review_status: 'missing', activities: 'פעילות' },
    { date: '2026-11-10', ready: false, review_status: 'missing', activities: 'פעילות א · פעילות ב' },
  ];
  const saved = new Map([
    ['2026-11-04', {
      travel_date: '2026-11-04', review_status: 'pending_review', no_travel: false,
      total_km: 40, total_minutes: 60, public_transport_cost: 0,
      legs: [
        { kind: 'outbound', from: 'בית', to: 'ס1', minutes: 30, kilometers: 20, mode: 'car', transportCost: 0 },
        { kind: 'return', from: 'ס1', to: 'בית', minutes: 30, kilometers: 20, mode: 'car', transportCost: 0 },
      ],
    }],
  ]);
  const legsFor = (d) => [
    { kind: 'outbound', from: 'בית', to: 'בית ספר ' + d, minutes: null, kilometers: null, gapMinutes: null, sameLocation: false },
    { kind: 'return', from: 'בית ספר ' + d, to: 'בית', minutes: null, kilometers: null, gapMinutes: null, sameLocation: false },
  ];

  Object.assign(ctx, {
    window: { alert() {}, confirm: () => true, addEventListener() {} },
    createUnsavedChangesGuard(root) {
      const guard = {
        root,
        dirty: false,
        busy: false,
        markClean() { guard.dirty = false; },
        confirmLeave() { return true; },
      };
      root.addEventListener('input', () => { guard.dirty = true; });
      root.addEventListener('change', () => { guard.dirty = true; });
      return guard;
    },
    saveHistoricalTravel: async () => ({}),
    getMonthApproval: async () => null,
    invalidateAttendanceCache() {},
    supabase: {},
    canEditMonth: () => true,
    formatMonthLabel: (x) => String(x),
    listInstructorDisplayMonths: async () => ['2026-11'],
    readHistoricalAttendance: async () => ({ rows: [], approval: null }),
    historicalTravelDays: () => [],
    historicalTravelReports: () => [],
    isHistoricTravelMonth: () => false,
    monthStatusLabel: () => '',
    createReportedTravelTable: () => {
      const wrap = new El('div');
      wrap.render = () => {};
      return wrap;
    },
    withTravelDeadline: async (fn) => (typeof fn === 'function' ? fn({ aborted: false }) : fn),
    savedTravelMatchesDraft: () => true,
    summarizeDailyTravel: ctx.summarizeDailyTravel,
    getAssignedTravelDays: async () => assigned.map((row) => ({ ...row })),
    getDailyTravelReports: async () => [...saved.values()],
    getDailyTravelReport: async (_emp, date) => saved.get(date) || null,
    getDailyTravelActivityLegs: async (_emp, date) => legsFor(date),
    saveDailyTravel: async (date, legs, noTravel) => {
      const row = {
        travel_date: date, review_status: 'pending_review', no_travel: !!noTravel,
        total_km: 40, total_minutes: 60, public_transport_cost: 0, legs,
      };
      saved.set(date, row);
      assigned = assigned.map((day) => (day.date === date
        ? { ...day, ready: true, review_status: 'pending_review' }
        : day));
      return row;
    },
    markAttendanceSaved(date) {
      assigned = assigned.map((day) => (day.date === date
        ? { ...day, ready: true, review_status: 'missing' }
        : day));
    },
    markAttendanceRemoved(date) {
      assigned = assigned.map((day) => (day.date === date
        ? { ...day, ready: false, review_status: 'missing' }
        : day));
    },
    failNextAssignedDays: false,
  });
  const originalAssigned = ctx.getAssignedTravelDays;
  ctx.getAssignedTravelDays = async (...args) => {
    if (ctx.failNextAssignedDays) {
      ctx.failNextAssignedDays = false;
      throw new Error('timeout');
    }
    return originalAssigned(...args);
  };

  const source = fs.readFileSync(`${__dirname}/../attendance/src/screens/daily-travel-tab.js`, 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '')
    .replace(/export /g, '');
  vm.runInContext(source, ctx);
  const tab = ctx.createDailyTravelTab({ empId: 1538, initialDate: '2026-11-04' });
  const status = () => tab.panel.querySelector('.av2-daily-travel__status').textContent;
  const save = () => [...tab.panel.querySelectorAll('button')]
    .find((button) => String(button.textContent || '').includes('שמירת נסיעות'));
  const dayLabel = () => tab.panel.querySelector('#av2-travel-day-selector-trigger')?.textContent || '';
  return { ctx, tab, status, save, dayLabel };
}

test('Mohammed repro: visit travel before attendance, save attendance, return — day becomes ready without remount', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.match(a.dayLabel(), /נשמר/);

  // Switch away, then open the not-yet-attended day while cache still says ready:false.
  a.tab.panel.hidden = true;
  a.tab.setDate('2026-11-09');
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.match(a.status(), /יש להשלים תחילה דיווח נוכחות/);
  assert.equal(a.save().hidden, true);

  // Attendance is saved on the other tab while travel cache is still mounted.
  a.ctx.markAttendanceSaved('2026-11-09');
  a.tab.panel.hidden = true;
  const invalidated = a.tab.invalidateAttendanceContext();
  assert.equal(invalidated.stale, true);
  assert.equal(invalidated.reloaded, false);

  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.doesNotMatch(a.status(), /יש להשלים תחילה דיווח נוכחות/);
  assert.match(a.dayLabel(), /טרם דווח/);
  assert.equal(a.save().hidden, false);
  assert.equal(a.save().disabled, false);
});

test('multi-activity day becomes ready after attendance invalidate', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  a.tab.setDate('2026-11-10');
  await a.tab.load();
  assert.match(a.status(), /יש להשלים תחילה דיווח נוכחות/);
  a.ctx.markAttendanceSaved('2026-11-10');
  a.tab.panel.hidden = true;
  a.tab.invalidateAttendanceContext();
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.equal(a.save().hidden, false);
  assert.match(a.dayLabel(), /טרם דווח/);
});

test('unsaved travel draft is not wiped when attendance context goes stale', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  // Edit the already-saved day so legs are visible, then mark dirty.
  const edit = a.tab.panel.querySelector('.av2-daily-travel__saved-edit');
  assert.ok(edit);
  await edit.fire('click');
  const km = a.tab.panel.querySelector('[data-field="kilometers"]');
  assert.ok(km);
  km.value = '55';
  await km.fire('input');
  a.ctx.markAttendanceSaved('2026-11-09');
  const result = a.tab.invalidateAttendanceContext();
  assert.equal(result.reloaded, false);
  const still = a.tab.panel.querySelector('[data-field="kilometers"]');
  assert.equal(still.value, '55');
});

test('success message path in new-report only follows createRecord success', () => {
  const source = fs.readFileSync(`${__dirname}/../attendance/src/screens/new-report-screen.js`, 'utf8');
  const finish = source.slice(
    source.indexOf('function finishSuccessfulSave'),
    source.indexOf('async function uploadPendingFiles'),
  );
  const createBlock = source.slice(
    source.indexOf('const record = await createRecord'),
    source.indexOf('finishSuccessfulSave(record, dateStr)'),
  );
  assert.match(finish, /notifyTravelAttendanceChanged\(\)/);
  assert.match(finish, /successBanner\.textContent = 'דיווח הנוכחות נשמר בהצלחה'/);
  assert.match(createBlock, /notifyTravelAttendanceChanged\(\)/);
  assert.doesNotMatch(createBlock, /successBanner\.textContent/);
});

test('deleting attendance makes a previously ready day blocked again after invalidate', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.match(a.dayLabel(), /נשמר/);
  a.ctx.markAttendanceRemoved('2026-11-04');
  a.tab.panel.hidden = true;
  a.tab.invalidateAttendanceContext();
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.match(a.status(), /יש להשלים תחילה דיווח נוכחות/);
  assert.equal(a.save().hidden, true);
});

test('attendance update on a day that already has travel keeps the day editable', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  a.ctx.markAttendanceSaved('2026-11-04');
  a.tab.panel.hidden = true;
  a.tab.invalidateAttendanceContext();
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.match(a.dayLabel(), /נשמר|ממתין|טרם/);
  assert.doesNotMatch(a.status(), /יש להשלים תחילה דיווח נוכחות/);
  const edit = a.tab.panel.querySelector('.av2-daily-travel__saved-edit');
  assert.ok(edit);
  assert.equal(edit.hidden, false);
});

test('day and month switches clear stale day selection safely', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  a.tab.setDate('2026-11-09');
  await a.tab.load();
  assert.match(a.status(), /יש להשלים תחילה דיווח נוכחות/);
  const month = a.tab.panel.querySelector('#av2-travel-month-selector');
  assert.ok(month);
  month.value = '2026-11';
  await month.fire('change');
  await new Promise(setImmediate);
  assert.equal(a.tab.dateInput.value === '' || a.tab.dateInput.value.startsWith('2026-11'), true);
});

test('assigned-days timeout shows retry and does not unlock save with stale ready', async () => {
  const a = setupMohammedScenario();
  a.tab.panel.hidden = false;
  await a.tab.load();
  a.tab.setDate('2026-11-09');
  await a.tab.load();
  assert.equal(a.save().hidden, true);
  a.ctx.failNextAssignedDays = true;
  a.tab.panel.hidden = true;
  a.tab.invalidateAttendanceContext();
  a.tab.panel.hidden = false;
  await a.tab.load();
  assert.match(a.status(), /timeout|ניתן לנסות שוב/);
  assert.equal(a.save().hidden, true);
});
