import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { instructorContactsScreen } from '../frontend/src/screens/instructor-contacts.js';
import { createSharedInteractionLayer } from '../frontend/src/screens/shared/interactions.js';

async function withScreenDom(fn) {
  const dom = new JSDOM('<!doctype html><html><body><div id="screenRoot"></div></body></html>', { url: 'http://localhost/' });
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    requestAnimationFrame: globalThis.requestAnimationFrame
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  try {
    await fn(dom);
  } finally {
    Object.assign(globalThis, saved);
  }
}

function sampleRows(count = 24) {
  const employmentTypes = ['full_time', 'part_time', 'contractor', 'שכיר', null, '', undefined];
  return Array.from({ length: count }, (_, i) => ({
    emp_id: `E${1000 + i}`,
    full_name: `מדריך מספר ${i} לבדיקה`,
    mobile: '050-1234567',
    email: `test${i}@example.com`,
    address: i % 4 === 0 ? '' : 'רחוב הדוגמה 1, תל אביב',
    employment_type: employmentTypes[i % employmentTypes.length],
    direct_manager: i % 5 === 0 ? '' : `מנהל ${i % 3}`,
    active: i % 3 === 0 ? 'no' : 'yes'
  }));
}

function makeHarness(dom, rows) {
  const data = { rows };
  const state = { clientSettings: { hide_emp_id_on_screens: true }, instrContactsSearch: '' };
  const ui = createSharedInteractionLayer();
  const screenRoot = document.getElementById('screenRoot');
  let rerenderCount = 0;
  const doBind = () => {
    instructorContactsScreen.bind({
      root: screenRoot,
      data,
      state,
      api: {},
      ui,
      rerender: () => {
        rerenderCount += 1;
        screenRoot.innerHTML = instructorContactsScreen.render(data, { state });
        doBind();
      },
      clearScreenDataCache: () => {}
    });
  };
  screenRoot.innerHTML = instructorContactsScreen.render(data, { state });
  doBind();
  return { screenRoot, state, ui, getRerenderCount: () => rerenderCount };
}

test('renders 24 compact instructor contact cards without error', async () => {
  await withScreenDom(async () => {
    const { screenRoot } = makeHarness(null, sampleRows(24));
    const cards = screenRoot.querySelectorAll('[data-card-action]');
    assert.equal(cards.length, 24);
    assert.equal(screenRoot.querySelectorAll('.ic-contact-card--compact').length, 24);
  });
});

test('compact cards display only the instructor name; details stay in the drawer', async () => {
  await withScreenDom(async (dom) => {
    const { screenRoot } = makeHarness(null, sampleRows(3));
    const secondCard = screenRoot.querySelectorAll('[data-card-action]')[1];
    assert.equal(secondCard.textContent.trim(), 'מדריך מספר 1 לבדיקה');
    assert.equal(secondCard.querySelectorAll('.ic-contact-card__avatar, .ic-contact-card__status, .ic-contact-card__body').length, 0);
    assert.doesNotMatch(secondCard.textContent, /050-1234567|example\.com|מנהל 1|רחוב הדוגמה/);

    secondCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const drawerText = document.querySelector('.ds-drawer__content')?.textContent || '';
    assert.match(drawerText, /050-1234567/);
    assert.match(drawerText, /test1@example\.com/);
    assert.match(drawerText, /מנהל 1/);
    assert.match(drawerText, /רחוב הדוגמה 1/);
  });
});

test('rerender is never called as a side effect of the initial render+bind', async () => {
  await withScreenDom(async () => {
    const { getRerenderCount } = makeHarness(null, sampleRows(24));
    assert.equal(getRerenderCount(), 0);
  });
});

test('clicking a card opens the drawer exactly once', async () => {
  await withScreenDom(async (dom) => {
    const { screenRoot } = makeHarness(null, sampleRows(24));
    const firstCard = screenRoot.querySelector('[data-card-action]');
    firstCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const drawer = document.querySelector('.ds-drawer');
    assert.equal(drawer.getAttribute('aria-hidden'), 'false');
    assert.match(drawer.querySelector('.ds-drawer__title')?.innerHTML || '', /מדריך מספר 0/);
    // A second click on the same card must not stack another open (still exactly one drawer host).
    firstCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(document.querySelectorAll('.ds-drawer').length, 1);
    assert.equal(drawer.getAttribute('aria-hidden'), 'false');
  });
});

test('closing the drawer does not reopen it', async () => {
  await withScreenDom(async (dom) => {
    const { screenRoot } = makeHarness(null, sampleRows(24));
    const firstCard = screenRoot.querySelector('[data-card-action]');
    firstCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const drawer = document.querySelector('.ds-drawer');
    assert.equal(drawer.getAttribute('aria-hidden'), 'false');
    document.querySelector('[data-ui-close-drawer]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  });
});

test('clicking an active-filter chip triggers exactly one rerender', async () => {
  await withScreenDom(async (dom) => {
    const { screenRoot, getRerenderCount } = makeHarness(null, sampleRows(24));
    const before = getRerenderCount();
    screenRoot.querySelector('[data-active-filter="no"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(getRerenderCount(), before + 1);
  });
});

test('a full interaction sequence across 24 rows and adversarial data shapes never throws a stack overflow', async () => {
  const variants = [
    { name: 'string ids, yes/no active', rows: sampleRows(24) },
    {
      name: 'numeric emp_id',
      rows: sampleRows(24).map((r, i) => ({ ...r, emp_id: 1000 + i }))
    },
    {
      name: 'boolean active column',
      rows: sampleRows(24).map((r, i) => ({ ...r, active: i % 3 !== 0 }))
    },
    {
      name: 'falsy (0) emp_id on first row',
      rows: sampleRows(24).map((r, i) => (i === 0 ? { ...r, emp_id: 0 } : r))
    }
  ];

  for (const { name, rows } of variants) {
    await withScreenDom(async (dom) => {
      let threw = null;
      try {
        const { screenRoot } = makeHarness(null, rows);
        for (const filterVal of ['yes', 'no', '', 'yes']) {
          screenRoot.querySelector(`[data-active-filter="${filterVal}"]`)
            ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        }
        const cards = Array.from(screenRoot.querySelectorAll('[data-card-action]')).slice(0, 5);
        for (const card of cards) {
          card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
          document.querySelector('[data-ui-close-drawer]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        }
      } catch (err) {
        threw = err;
      }
      assert.equal(threw, null, `variant "${name}" must not throw (${threw?.message || ''})`);
    });
  }
});

test('inactive instructors stay under the "all" filter, drop out of "active", and appear under "inactive" for both string and boolean active columns', async () => {
  await withScreenDom(async (dom) => {
    const rows = [
      { emp_id: 'A1', full_name: 'פעיל מחרוזת', active: 'yes' },
      { emp_id: 'A2', full_name: 'לא פעיל מחרוזת', active: 'no' },
      { emp_id: 'A3', full_name: 'פעיל בוליאני', active: true },
      { emp_id: 'A4', full_name: 'לא פעיל בוליאני', active: false }
    ];
    const { screenRoot } = makeHarness(null, rows);
    assert.equal(screenRoot.querySelectorAll('[data-card-action]').length, 4, 'all filter shows every row regardless of active value type');

    screenRoot.querySelector('[data-active-filter="yes"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    let names = Array.from(screenRoot.querySelectorAll('.ic-contact-card__name')).map((n) => n.textContent);
    assert.deepEqual(names.sort(), ['פעיל בוליאני', 'פעיל מחרוזת'].sort());

    screenRoot.querySelector('[data-active-filter="no"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    names = Array.from(screenRoot.querySelectorAll('.ic-contact-card__name')).map((n) => n.textContent);
    assert.deepEqual(names.sort(), ['לא פעיל בוליאני', 'לא פעיל מחרוזת'].sort());
  });
});

test('no internal/technical strings leak into the rendered screen', async () => {
  await withScreenDom(async () => {
    const { screenRoot } = makeHarness(null, sampleRows(4));
    const text = screenRoot.textContent;
    assert.doesNotMatch(text, /contacts_instructors/);
    assert.doesNotMatch(text, /רשימה עצמאית/);
    assert.doesNotMatch(text, /אינה נגזרת מפעילויות/);
    assert.doesNotMatch(text, /ספר כתובות/);
    assert.match(screenRoot.innerHTML, /לחצו על שם מדריך להצגת פרטי הקשר והמידע הנוסף/);
  });
});
