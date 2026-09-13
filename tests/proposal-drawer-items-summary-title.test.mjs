import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

const {
  drawerHtml,
  itemsSummaryHtml
} = await import('../frontend/src/screens/proposals-agreements.js');

function sampleProposalRow() {
  return {
    id: 'proposal-title-regression',
    proposal_number: 'P-100',
    quote_number: '100',
    status: 'draft',
    activity_type_group: 'קיץ תשפ״ו',
    school_framework: 'הגורן',
    semel_mosad: '312397',
    client_authority: 'מועצה לדוגמה',
    total_amount: 1500,
    contact_name: 'נועה',
    contact_role: 'מנהלת',
    phone: '050-0000000',
    email: 'noa@example.com'
  };
}

function adminState() {
  return {
    user: { display_role: 'admin', role: 'admin', user_id: 1, username: 'admin' },
    clientSettings: { dropdown_options: { activity_names: [] } }
  };
}

test('itemsSummaryHtml keeps activity cards without nested שורות הצעה title', () => {
  const html = itemsSummaryHtml([
    { item_name: 'סדנת רובוטיקה', quantity: 1, unit_price: 500, total_price: 500 },
    { item_name: 'סיור מדע', quantity: 2, unit_price: 250, total_price: 250 }
  ]);

  assert.match(html, /סדנת רובוטיקה/);
  assert.match(html, /סיור מדע/);
  assert.match(html, /ds-pa-item-cards/);
  assert.doesNotMatch(html, /<h4\b[^>]*>\s*שורות הצעה\s*<\/h4>/);
  assert.doesNotMatch(html, /ds-pa-card-title[^>]*>\s*שורות הצעה/);
});

test('proposal detail shows פעילויות ומחירים and not שורות הצעה after items fill', () => {
  const drawerMarkup = drawerHtml(sampleProposalRow(), [], adminState());
  assert.match(drawerMarkup, /<h4 class="ds-pa-card-title">פעילויות ומחירים<\/h4>/);

  const dom = new JSDOM(`<!doctype html><html><body>${drawerMarkup}</body></html>`, {
    url: 'http://localhost/'
  });
  const drawer = dom.window.document.querySelector('[data-pa-drawer]');
  assert.ok(drawer);

  const itemsHost = drawer.querySelector('[data-pa-drawer-items]');
  assert.ok(itemsHost);
  itemsHost.innerHTML = itemsSummaryHtml([
    { item_name: 'פעילות ראשונה', quantity: 1, unit_price: 100, total_price: 100 },
    { item_name: 'פעילות שנייה', quantity: 1, unit_price: 200, total_price: 200 }
  ]);

  const section = drawer.querySelector('.ds-pa-activities-wide');
  assert.ok(section);
  assert.match(section.textContent, /פעילויות ומחירים/);
  assert.match(section.textContent, /פעילות ראשונה/);
  assert.match(section.textContent, /פעילות שנייה/);
  assert.match(section.textContent, /סה״כ לתשלום/);

  const nestedRowsTitle = [...section.querySelectorAll('h4.ds-pa-card-title')]
    .map((node) => node.textContent.trim())
    .filter((title) => title === 'שורות הצעה');
  assert.deepEqual(nestedRowsTitle, [], 'drawer must not render nested שורות הצעה heading');
});
