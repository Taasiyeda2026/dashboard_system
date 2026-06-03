import { test } from 'node:test';
import assert from 'node:assert/strict';

const { financeScreen } = await import('../frontend/src/screens/finance.js');

const rows = [
  {
    RowID: 'A1',
    activity_name: 'קורס רובוטיקה',
    activity_type: 'course',
    authority: 'רשות א',
    school: 'בית ספר א',
    funding: 'גפ״ן',
    finance_status: 'open',
    price: 1000,
    sessions: 5,
    Payment: 2,
    end_date: '2026-01-01',
    exception_type: 'missing_instructor'
  },
  {
    RowID: 'A2',
    activity_name: 'סדנת מדע',
    activity_type: 'workshop',
    authority: 'רשות ב',
    school: 'בית ספר ב',
    funding: 'רשות',
    finance_status: 'closed',
    price: 750,
    Payment: 750,
    end_date: '2026-04-01'
  },
  {
    RowID: 'A3',
    activity_name: 'סיור חלל',
    activity_type: 'tour',
    authority: 'רשות א',
    school: 'בית ספר ג',
    funding: '',
    finance_status: '',
    price: 500,
    end_date: '2026-05-01'
  }
];

function state(overrides = {}) {
  return {
    user: { display_role: 'finance', role: 'finance', finance_access: true },
    financeTab: 'active',
    ...overrides
  };
}

test('finance screen blocks users without finance_access', () => {
  const html = financeScreen.render({ rows }, { state: { user: { display_role: 'authorized_user', finance_access: false } } });
  assert.match(html, /אין הרשאה לעמוד כספים/);
  assert.doesNotMatch(html, /ריכוז גבייה לפי מימון ורשות/);
});

test('finance screen is based on activities rows with KPI, filters, groups, and exceptions', () => {
  const html = financeScreen.render({ rows }, { state: state() });
  assert.match(html, /עמוד פנימי מבוסס activities בלבד/);
  assert.match(html, /חריגות כספיות/);
  assert.match(html, /data-finance-filter="authority"/);
  assert.match(html, /data-finance-filter="exceptions"/);
  assert.match(html, /גפ״ן/);
  assert.match(html, /ללא מימון/);
  assert.doesNotMatch(html, /סדנת מדע/);
});

test('finance archive tab shows closed activity groups', () => {
  const html = financeScreen.render({ rows }, { state: state({ financeTab: 'archive' }) });
  assert.match(html, /רשות ב/);
  assert.match(html, /₪750/);
  assert.doesNotMatch(html, /גפ״ן/);
});

test('finance filters narrow activities by authority and exceptions-only', () => {
  const html = financeScreen.render({ rows }, { state: state({ financeAuthorityFilter: 'רשות א', financeExceptionsOnly: true }) });
  assert.match(html, /רשות א/);
  assert.doesNotMatch(html, /רשות ב/);
});
