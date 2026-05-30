import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const { dashboardScreen } = await import('../frontend/src/screens/dashboard.js');

function state() {
  return { dashboardMonthYm: '2026-04', user: { display_role: 'admin' }, screenDataCache: {} };
}

test('dashboard district cards display total active activities including summer/short rows', () => {
  const html = dashboardScreen.render({
    month: '2026-04',
    summary: {
      active_type_counts: { course: 1, workshop: 1 },
      active_instructors: ['מדריכה א'],
      ending_courses_current_month: 0,
      exceptions_count: 0,
      totalExceptionInstances: 0
    },
    kpi_cards: [],
    totals: { total_activities: 2 },
    by_activity_manager: [
      {
        activity_manager: 'מחוז צפון',
        total_long: 1,
        total_short: 1,
        total_activities: 2,
        num_instructors: 1,
        exceptions: 0,
        course_endings: 0
      }
    ]
  }, { state: state() });

  assert.match(html, /פעילויות פעילות/);
  assert.match(html, /mstat\|%D7%9E%D7%97%D7%95%D7%96%20%D7%A6%D7%A4%D7%95%D7%9F\|activities/);
  assert.match(html, /<span class="ds-manager-stat__value">2<\/span>/);
});
