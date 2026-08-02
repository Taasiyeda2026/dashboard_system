import test from 'node:test';
import assert from 'node:assert/strict';
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
  pricingRowsForNextYearGroup,
  isBlankNextYearEditorRow,
  removeBlankNextYearRows,
  stabilizeNextYearForm
} = await import('../frontend/src/proposal-next-year-editor-stability.js');

const course = {
  activity_name: 'אופק יזמות פרימיום בתעשייה',
  activity_no: '52279',
  pricing_key: '52279',
  proposal_group: 'שנה הבאה',
  item_type: 'תוכנית',
  unit_duration: '90 דקות',
  unit_price: 13500,
  hours_count: 21,
  meetings_count: 14,
  gefen_number: '52279',
  sort_order: 10,
  is_active_for_proposals: true,
  proposal_display_mode: 'single'
};

const workshop = {
  activity_name: 'סדנאות חלל',
  pricing_key: 'space_workshop',
  parent_pricing_key: 'space_workshop',
  proposal_group: 'פעילויות קיץ',
  item_type: 'סדנה',
  unit_duration: '45 דקות',
  unit_price: 500,
  sort_order: 20,
  is_active_for_proposals: true,
  proposal_display_mode: 'bundle_parent'
};

function optionKey(row) {
  return [
    row.activity_no,
    row.activity_name,
    row.item_type,
    row.proposal_group,
    row.unit_duration,
    row.unit_price,
    row.sort_order
  ].map((value) => String(value == null ? '' : value).trim()).join('||');
}

function itemRow({ group, selected = '', price = '', name = '', activityNo = '', userAdded = false } = {}) {
  return `<article data-pa-item-row data-pa-row-group="${group}"${userAdded ? ' data-pa-next-year-user-added="yes"' : ''}>
    <select data-pa-pricing-select name="pricing_activity_name">
      <option value="">— בחר פעילות מהרשימה —</option>
      ${selected ? `<option value="${selected}" selected>אופק יזמות פרימיום בתעשייה — תוכנית — ₪ 13,500</option>` : ''}
    </select>
    <input name="quantity" data-pa-item-qty value="1">
    <input name="unit_price" data-pa-item-price value="${price}">
    <input name="total_price" data-pa-item-total value="">
    <output data-pa-item-total-display>₪ 0</output>
    <input name="item_name" value="${name}">
    <input name="activity_no" value="${activityNo}">
    <input name="pricing_option_key" value="${selected}">
    <input name="item_source_pricing_key" value="">
    <input name="bundle_pricing_key" value="">
    <input name="item_type" value="">
    <input name="gefen_number" value="">
    <input name="gefen_number_display" value="">
    <input name="meetings_count" value="">
    <input name="hours_count" value="">
    <input name="unit_duration" value="">
    <input name="hourly_price" value="">
    <input name="proposal_group" value="${group}">
  </article>`;
}

function formHtml({ storedPrice = '', includeBlankWorkshop = true } = {}) {
  const selectedCourse = optionKey({ ...course, proposal_group: 'next_year_courses' });
  return `<form data-pa-form>
    <input name="activity_type_group" value="next_year">
    <section data-pa-items-group="next_year_courses">
      <div data-pa-items-body data-pa-items-group-body="next_year_courses">
        ${itemRow({ group: 'next_year_courses', selected: selectedCourse, price: storedPrice, name: course.activity_name, activityNo: course.activity_no })}
      </div>
      <strong data-pa-group-total="next_year_courses">₪ 0</strong>
    </section>
    <section data-pa-items-group="next_year_workshops">
      <div data-pa-items-body data-pa-items-group-body="next_year_workshops">
        ${includeBlankWorkshop ? itemRow({ group: 'next_year_workshops' }) : ''}
      </div>
      <strong data-pa-group-total="next_year_workshops">₪ 0</strong>
    </section>
    <strong data-pa-grand-total>₪ 0</strong>
    <span data-pa-summary-subtotal>₪ 0</span>
    <span data-pa-summary-discount>₪ 0</span>
    <strong data-pa-summary-total>₪ 0</strong>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select>
    <input data-pa-discount-value value="0">
  </form>`;
}

function withDom(html, fn) {
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const previousEvent = globalThis.Event;
  globalThis.Event = dom.window.Event;
  try {
    return fn(dom.window.document.querySelector('[data-pa-form]'), dom);
  } finally {
    globalThis.Event = previousEvent;
  }
}

test('internal next-year groups receive separate non-empty pricing lists', () => {
  const rows = [course, workshop];
  const courses = pricingRowsForNextYearGroup(rows, 'next_year_courses');
  const workshops = pricingRowsForNextYearGroup(rows, 'next_year_workshops');
  assert.ok(courses.some((row) => row.activity_no === '52279'));
  assert.ok(workshops.some((row) => row.pricing_key === 'space_workshop'));
  assert.ok(courses.every((row) => row.proposal_group === 'next_year_courses'));
  assert.ok(workshops.every((row) => row.proposal_group === 'next_year_workshops'));
});

test('hydrates selected 13,500 course, calculates totals and removes phantom workshop row', () => {
  withDom(formHtml(), (form) => {
    const result = stabilizeNextYearForm(form, [course, workshop], { notify: false, removeBlankRows: true });
    const courseRow = form.querySelector('[data-pa-items-group="next_year_courses"] [data-pa-item-row]');
    assert.equal(courseRow.querySelector('[data-pa-item-price]').value, '13500');
    assert.equal(courseRow.querySelector('[data-pa-item-total]').value, '13500.00');
    assert.equal(courseRow.querySelector('[data-pa-item-total-display]').textContent, '₪ 13,500');
    assert.equal(form.querySelector('[data-pa-group-total="next_year_courses"]').textContent, '₪ 13,500');
    assert.equal(form.querySelector('[data-pa-summary-total]').textContent, '₪ 13,500');
    assert.equal(form.querySelectorAll('[data-pa-items-group="next_year_workshops"] [data-pa-item-row]').length, 0);
    assert.equal(result.removed, 1);
  });
});

test('preserves a historical stored price instead of repricing from the current catalog', () => {
  withDom(formHtml({ storedPrice: '12000', includeBlankWorkshop: false }), (form) => {
    stabilizeNextYearForm(form, [course, workshop], { notify: false, removeBlankRows: true });
    const courseRow = form.querySelector('[data-pa-items-group="next_year_courses"] [data-pa-item-row]');
    assert.equal(courseRow.querySelector('[data-pa-item-price]').value, '12000');
    assert.equal(courseRow.querySelector('[data-pa-item-total]').value, '12000.00');
    assert.equal(form.querySelector('[data-pa-summary-total]').textContent, '₪ 12,000');
  });
});

test('keeps a user-added empty workshop row and populates its workshop options', () => {
  withDom(formHtml({ includeBlankWorkshop: false }), (form) => {
    const body = form.querySelector('[data-pa-items-group-body="next_year_workshops"]');
    body.insertAdjacentHTML('beforeend', itemRow({ group: 'next_year_workshops', userAdded: true }));
    const row = body.querySelector('[data-pa-item-row]');
    assert.equal(isBlankNextYearEditorRow(row), true);
    stabilizeNextYearForm(form, [course, workshop], { notify: false, removeBlankRows: true });
    assert.equal(body.querySelectorAll('[data-pa-item-row]').length, 1);
    const options = Array.from(row.querySelector('[data-pa-pricing-select]').options).map((option) => option.textContent);
    assert.ok(options.some((label) => label.includes('סדנאות חלל')));
    assert.ok(options.every((label) => !label.includes('אופק יזמות')));
  });
});

test('removes blank user-added rows before save or proposal-type switching', () => {
  withDom(formHtml({ includeBlankWorkshop: false }), (form) => {
    const body = form.querySelector('[data-pa-items-group-body="next_year_workshops"]');
    body.insertAdjacentHTML('beforeend', itemRow({ group: 'next_year_workshops', userAdded: true }));
    stabilizeNextYearForm(form, [course, workshop], { notify: false, removeBlankRows: true });
    assert.equal(body.querySelectorAll('[data-pa-item-row]').length, 1);
    assert.equal(removeBlankNextYearRows(form), 1);
    assert.equal(body.querySelectorAll('[data-pa-item-row]').length, 0);
  });
});

test('notifies the screen once after hydration and does not create a preview loop', () => {
  withDom(formHtml(), (form) => {
    let inputEvents = 0;
    form.querySelector('[data-pa-item-price]').addEventListener('input', () => { inputEvents += 1; });
    stabilizeNextYearForm(form, [course, workshop], { removeBlankRows: true });
    assert.equal(inputEvents, 1);
    stabilizeNextYearForm(form, [course, workshop], { removeBlankRows: true });
    assert.equal(inputEvents, 1);
  });
});
