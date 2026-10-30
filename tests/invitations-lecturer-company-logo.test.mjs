import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { invitationsScreen } from '../frontend/src/screens/invitations.js';

const STORAGE_KEY = 'taasiyeda_invitation_builder_state_v4';
const COMPANY_LOGO_URL = 'data:image/png;base64,AA==';

function mount(savedState) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>', {
    url: 'https://example.org/', pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Image = dom.window.Image;
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.FileReader = class {
    readAsDataURL() {
      this.onload?.({ target: { result: COMPANY_LOGO_URL } });
    }
  };
  if (savedState) localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
  const root = document.querySelector('#root');
  root.innerHTML = invitationsScreen.render();
  invitationsScreen.bind({ root });
  const el = (id) => root.querySelector('#' + id);
  const select = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const logoSlots = () => [...el('card').querySelectorAll('.c-logos > .c-logo-item')];
  return { dom, el, select, logoSlots };
}

function uploadLecturerCompanyLogo(ui) {
  const fileInput = ui.el('logo-file');
  let clicked = false;
  fileInput.click = () => { clicked = true; };
  ui.el('lecturer-company-logo-chip').click();
  assert.equal(clicked, true);
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [new ui.dom.window.File(['image'], 'lecturer-company.png', { type: 'image/png' })]
  });
  fileInput.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true }));
}

test('guest lectures show exactly four named logo slots in fixed order, other events unchanged', () => {
  const ui = mount();
  assert.equal(ui.logoSlots().length, 3);
  assert.equal(ui.el('lecturer-company-logo-chip').style.display, 'none');

  ui.select('course-sel', 'פורצות דרך');
  ui.select('ev-type', 'lecture');
  assert.equal(ui.el('lecturer-company-logo-chip').style.display, '');
  assert.equal(ui.el('logo-add').style.display, 'none');
  const logos = ui.logoSlots();
  assert.equal(logos.length, 4);
  assert.match(logos[0].textContent, /משרד/);
  assert.match(logos[1].textContent, /תעשיידע/);
  assert.match(logos[2].textContent, /לוגו בית הספר/);
  assert.match(logos[3].textContent, /לוגו חברת המרצה/);
  assert.equal(ui.el('card').querySelector('.c-logos').classList.contains('c-logos--lecture'), true);

  ui.select('ev-type', 'end');
  assert.equal(ui.logoSlots().length, 3);
  assert.equal(ui.el('lecturer-company-logo-chip').style.display, 'none');
  assert.equal(ui.el('logo-add').style.display, '');
  ui.dom.window.close();
});

test('fourth company image upload appears in A5 preview and print, persists when changing event types', () => {
  const ui = mount();
  ui.select('ev-type', 'lecture');
  uploadLecturerCompanyLogo(ui);
  assert.equal(ui.el('lecturer-company-chip-img').getAttribute('src'), COMPANY_LOGO_URL);
  assert.equal(ui.logoSlots()[3].querySelector('img').getAttribute('src'), COMPANY_LOGO_URL);
  assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).customLogos['lecturer-company'], COMPANY_LOGO_URL);

  let printed = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printed = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.match(printed, /c-logos--lecture/);
  assert.ok(printed.includes(COMPANY_LOGO_URL));

  ui.select('ev-type', 'end');
  assert.equal(ui.logoSlots().length, 3);
  assert.equal(ui.el('card').textContent.includes('לוגו חברת המרצה'), false);
  ui.select('ev-type', 'lecture');
  assert.equal(ui.logoSlots().length, 4);
  assert.equal(ui.logoSlots()[3].querySelector('img').getAttribute('src'), COMPANY_LOGO_URL);

  ui.el('reset-btn').click();
  ui.select('ev-type', 'lecture');
  assert.match(ui.logoSlots()[3].textContent, /לוגו חברת המרצה/);
  assert.equal(ui.el('lecturer-company-chip-img').style.display, 'none');
  ui.dom.window.close();
});

test('restores company logo from saved draft and never duplicates it among existing custom logos', () => {
  const ui = mount({
    fields: { 'ev-type': 'lecture', 'course-sel': 'פורצות דרך' },
    logoOrder: ['mohe', 'taas', 'school', 'cu_demo'],
    customLogos: {
      'lecturer-company': COMPANY_LOGO_URL,
      cu_demo: 'data:image/png;base64,BB=='
    }
  });

  assert.equal(ui.logoSlots().length, 4);
  assert.equal(ui.el('lecturer-company-logo-chip').style.display, '');
  assert.equal(ui.logoSlots()[3].querySelector('img').getAttribute('src'), COMPANY_LOGO_URL);
  assert.equal(ui.el('logo-zone').querySelectorAll('[data-id="lecturer-company"]').length, 1);
  assert.equal(ui.el('logo-zone').querySelector('[data-id="cu_demo"]').style.display, 'none');

  ui.select('ev-type', 'tour');
  assert.equal(ui.logoSlots().length, 4);
  assert.equal(ui.logoSlots()[3].querySelector('img').getAttribute('src'), 'data:image/png;base64,BB==');
  assert.equal(ui.el('lecturer-company-logo-chip').style.display, 'none');
  ui.dom.window.close();
});
