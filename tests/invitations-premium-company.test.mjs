import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { invitationsScreen } from '../frontend/src/screens/invitations.js';

const STORAGE_KEY = 'taasiyeda_invitation_builder_state_v4';

function mountInvitation(savedState) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>', {
    url: 'https://example.org/',
    pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Image = dom.window.Image;
  globalThis.requestAnimationFrame = (callback) => callback();

  if (savedState) localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));

  const root = document.querySelector('#root');
  root.innerHTML = invitationsScreen.render();
  invitationsScreen.bind({ root });

  return {
    dom,
    root,
    el: (id) => root.querySelector('#' + id),
    change: (el, event = 'input') => el.dispatchEvent(new dom.window.Event(event, { bubbles: true }))
  };
}

test('only school year 2027 is available, and Hila is not a default participant', () => {
  const ui = mountInvitation();
  assert.deepEqual([...ui.el('year').options].map((option) => option.value), ['תשפ״ז']);
  assert.equal(ui.el('year').value, 'תשפ״ז');
  assert.match(ui.el('parts').textContent, /יעל אביב/);
  assert.doesNotMatch(ui.el('parts').textContent, /הילה רוזן/);

  ui.el('suggest-parts').click();
  assert.doesNotMatch(ui.el('parts').textContent, /הילה רוזן/);
  ui.dom.window.close();
});

test('premium has a single option, shows editable sponsor and uses it in preview and PDF title', () => {
  const ui = mountInvitation();
  const course = ui.el('course-sel');
  assert.deepEqual([...course.options].filter((o) => o.value.includes('פרימיום')).map((o) => o.value), ['יזמות פרימיום']);

  course.value = 'יזמות פרימיום';
  ui.change(course, 'change');
  assert.equal(ui.el('premium-company-row').style.display, 'block');

  const company = ui.el('premium-company');
  company.value = 'אסם';
  ui.change(company);
  assert.match(ui.el('card').querySelector('.c-course').textContent, /בליווי אסם/);
  assert.match(ui.el('card').querySelector('.c-opening').textContent, /בשיתוף אסם/);

  let pdfTitle = '';
  ui.dom.window.open = () => ({
    document: {
      write() {},
      close() {},
      set title(value) { pdfTitle = value; }
    }
  });
  ui.el('print-btn').click();
  assert.match(pdfTitle, /יזמות פרימיום אסם/);

  course.value = 'רוקחים עולם';
  ui.change(course, 'change');
  assert.equal(ui.el('premium-company-row').style.display, 'none');
  assert.doesNotMatch(ui.el('card').textContent, /בליווי אסם|בשיתוף אסם/);

  ui.el('reset-btn').click();
  assert.equal(company.value, '');
  assert.equal(ui.el('year').value, 'תשפ״ז');
  ui.dom.window.close();
});

test('previous premium drafts migrate without losing manual text or unrelated participants', () => {
  for (const [oldCourse, companyName] of [
    ['יזמות פרימיום – אסם', 'אסם'],
    ['יזמות פרימיום – מארוול', 'מארוול']
  ]) {
    const ui = mountInvitation({
      fields: {
        'course-sel': oldCourse,
        year: 'תשפ״ו',
        b1: 'טקסט שהמשתמש ערך בעצמו',
        b2: ''
      },
      parts: [
        { t: 'גב׳', n: 'הילה רוזן', r: 'אחראית הדרכה ומנחת הקבוצה, תעשיידע' },
        { t: 'גב׳', n: 'יעל אביב', r: 'מנהלת תחום חינוך ופדגוגיה, תעשיידע' },
        { t: 'מר', n: 'אורח לדוגמה', r: 'אורח' }
      ]
    });

    assert.equal(ui.el('course-sel').value, 'יזמות פרימיום');
    assert.equal(ui.el('premium-company').value, companyName);
    assert.equal(ui.el('year').value, 'תשפ״ז');
    assert.equal(ui.el('b1').value, 'טקסט שהמשתמש ערך בעצמו');
    assert.match(ui.el('parts').textContent, /אורח לדוגמה/);
    assert.doesNotMatch(ui.el('parts').textContent, /הילה רוזן/);
    assert.match(ui.el('card').textContent, new RegExp(companyName));
    assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).fields['course-sel'], 'יזמות פרימיום');
    ui.dom.window.close();
  }
});
