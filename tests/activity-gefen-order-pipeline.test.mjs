import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function installDom(html) {
  const dom = new JSDOM(html, { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 0;
  };
  return dom;
}

globalThis.__ACTIVITY_DRAWER_INLINE_LAYOUT_TEST__ = true;
globalThis.__ACTIVITY_DRAWER_TYPE_LAYOUT_FIX_TEST__ = true;

const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');
const { applyActivityDrawerLayoutPipeline } = await import('../frontend/src/activity-drawer-layout-pipeline.js');

test('drawer pipeline preserves Gefen order state and exposes the edit choice', () => {
  const row = {
    RowID: 'ISR-ORDER-2027-610857-9545-3',
    row_id: 'ISR-ORDER-2027-610857-9545-3',
    activity_type: 'course',
    item_type: 'course',
    activity_name: 'בינה מלאכותית',
    activity_no: '9545',
    activity_season: 'school_2027',
    status: 'פתוח',
    authority: 'לכיש',
    school: 'רבקה גובר',
    activity_manager: 'הילה רוזן',
    funding: 'גפן',
    funding_sources: [{ id: 'gefen', name: 'גפן' }],
    exists_in_gefen: true,
    price: 8000,
    sessions: 8
  };
  const settings = {
    dropdown_options: {
      funding_source_records: [{ id: 'gefen', name: 'גפן' }],
      activity_names: [{ label: 'בינה מלאכותית', activity_name: 'בינה מלאכותית', activity_no: '9545', activity_type: 'course', parent_value: 'course', active: true }]
    }
  };

  const dom = installDom(`<!doctype html><html><body>
    <aside class="ds-drawer">
      <div class="ds-drawer__content">
        ${activityWorkDrawerHtml(row, { settings, canEdit: true, canDirectEdit: true })}
      </div>
    </aside>
  </body></html>`);

  const root = dom.window.document.querySelector('.ds-drawer__content');
  const form = root.querySelector('[data-drawer-form]');
  const originalCheckbox = form.querySelector('[data-gefen-exists-checkbox]');
  assert.ok(originalCheckbox);
  assert.equal(originalCheckbox.checked, true);

  assert.equal(applyActivityDrawerLayoutPipeline(root, settings), true);

  const checkbox = form.querySelector('[data-gefen-exists-checkbox]');
  const control = form.querySelector('[data-gefen-order-control]');
  const choice = form.querySelector('[data-gefen-order-choice]');
  const fundingField = [...form.querySelectorAll('.activity-drawer-inline__field')].find((field) => (
    field.querySelector('.activity-drawer-inline__label')?.textContent.trim() === 'גורם מימון'
  ));

  assert.ok(checkbox, 'exists_in_gefen must survive the inline-layout transformation');
  assert.ok(control, 'Gefen order choice must be created after the inline-layout transformation');
  assert.ok(choice);
  assert.equal(control.dataset.gefenFunded, 'yes');
  assert.equal(choice.value, 'true');
  assert.equal(checkbox.checked, true);
  assert.equal(fundingField?.dataset.gefenOrderConfirmed, 'yes');
  assert.ok(fundingField?.querySelector('.activity-drawer-inline__edit')?.contains(control));

  form.dataset.editing = 'yes';
  assert.equal(control.dataset.gefenFunded, 'yes');

  dom.window.close();
});
