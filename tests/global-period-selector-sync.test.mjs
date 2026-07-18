import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function installStorage(name) {
  if (globalThis[name]) return;
  const store = new Map();
  globalThis[name] = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

installStorage('localStorage');
installStorage('sessionStorage');


const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
const doc = dom.window.document;
after(() => { dom.window.close(); });

const { state, setGlobalActivityPeriod } = await import('../frontend/src/state.js');
const { syncGlobalActivityPeriodSelector } = await import('../frontend/src/screens/shared/shell-period-selector.js');

function selectorHtml(active = 'regular') {
  const active2026 = active === 'regular';
  const active2027 = active === 'school_2027';
  return `
    <div data-global-period-wrap>
      <button type="button" data-global-period-toggle aria-expanded="false" title="${active2026 ? '2026' : '2027'}">${active2026 ? '2026' : '2027'}</button>
      <div data-global-period-menu role="listbox">
        <button type="button" class="shell-period-option${active2026 ? ' is-active' : ''}" data-global-period-option="regular" role="option" aria-selected="${active2026 ? 'true' : 'false'}"><span>2026</span><strong>2026</strong></button>
        <button type="button" class="shell-period-option${active2027 ? ' is-active' : ''}" data-global-period-option="school_2027" role="option" aria-selected="${active2027 ? 'true' : 'false'}"><span>2027</span><strong>2027</strong></button>
      </div>
    </div>
    <main id="screenRoot"><section data-screen-content>תוכן מסך ישן</section></main>
  `;
}

function periodNodes() {
  return {
    toggle: doc.querySelector('[data-global-period-toggle]'),
    regular: doc.querySelector('[data-global-period-option="regular"]'),
    school2027: doc.querySelector('[data-global-period-option="school_2027"]'),
    screenRoot: doc.getElementById('screenRoot')
  };
}

test('global activity period selector stays synced when only screen content rerenders', () => {
  doc.body.innerHTML = selectorHtml('regular');
  setGlobalActivityPeriod('regular', { persist: false });
  syncGlobalActivityPeriodSelector(doc, state.activityPeriodTab);

  setGlobalActivityPeriod('school_2027', { persist: false });
  assert.equal(state.activityPeriodTab, 'school_2027');
  syncGlobalActivityPeriodSelector(doc, state.activityPeriodTab);

  let nodes = periodNodes();
  assert.equal(nodes.toggle.textContent, '2027');
  assert.equal(nodes.toggle.getAttribute('title'), '2027');
  assert.equal(nodes.school2027.classList.contains('is-active'), true);
  assert.equal(nodes.school2027.getAttribute('aria-selected'), 'true');
  assert.equal(nodes.regular.classList.contains('is-active'), false);
  assert.equal(nodes.regular.getAttribute('aria-selected'), 'false');

  nodes.screenRoot.innerHTML = '<section data-screen-content>תוכן מסך חדש בלבד</section>';
  syncGlobalActivityPeriodSelector(doc, state.activityPeriodTab);
  nodes = periodNodes();
  assert.equal(nodes.toggle.textContent, '2027');
  assert.equal(nodes.school2027.classList.contains('is-active'), true);

  setGlobalActivityPeriod('regular', { persist: false });
  syncGlobalActivityPeriodSelector(doc, state.activityPeriodTab);
  nodes = periodNodes();
  assert.equal(state.activityPeriodTab, 'regular');
  assert.equal(nodes.toggle.textContent, '2026');
  assert.equal(nodes.toggle.getAttribute('title'), '2026');
  assert.equal(nodes.regular.classList.contains('is-active'), true);
  assert.equal(nodes.regular.getAttribute('aria-selected'), 'true');
  assert.equal(nodes.school2027.classList.contains('is-active'), false);
  assert.equal(nodes.school2027.getAttribute('aria-selected'), 'false');
});
