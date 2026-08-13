import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.__ACTIVITY_DRAWER_EDIT_DEDUP_TEST__ = true;
const moduleUrl = new URL('../frontend/src/activity-drawer-edit-dedup.js', import.meta.url);
const { guardInitialValueRefreshWhileEditing } = await import(`${moduleUrl.href}?test=${Date.now()}`);

test('async date refresh cannot overwrite activity edit initial values while editing', () => {
  const dom = new JSDOM('<form data-activity-drawer-inline-layout><select name="activity_name"><option value="אופק פרימיום">אופק פרימיום</option><option value="פורצות דרך">פורצות דרך</option></select></form>');
  const form = dom.window.document.querySelector('form');
  const activityName = form.querySelector('[name="activity_name"]');

  form._initialValues = { activity_name: 'אופק פרימיום' };
  form._refreshInitialValues = () => {
    form._initialValues = { activity_name: activityName.value };
    return form._initialValues;
  };

  assert.equal(guardInitialValueRefreshWhileEditing(form), true);

  form.dataset.editing = 'yes';
  activityName.value = 'פורצות דרך';
  form._refreshInitialValues();
  assert.equal(form._initialValues.activity_name, 'אופק פרימיום');

  form.dataset.editing = 'no';
  form._refreshInitialValues();
  assert.equal(form._initialValues.activity_name, 'פורצות דרך');

  dom.window.close();
});
