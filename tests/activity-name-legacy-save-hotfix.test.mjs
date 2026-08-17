import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.__ACTIVITY_DRAWER_EDIT_DEDUP_TEST__ = true;
const moduleUrl = new URL('../frontend/src/activity-drawer-edit-dedup.js', import.meta.url);
const { polishActivityDrawerEditOptions } = await import(`${moduleUrl.href}?test=${Date.now()}`);

function buildForm(row) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <form data-drawer-form data-activity-drawer-inline-layout data-export-row='${JSON.stringify(row)}'>
      <input type="hidden" name="activity_no" value="13990">
      <select name="activity_type"><option value="tour" selected>סיור</option></select>
      <select name="activity_name" data-role="activity-name-select">
        <option value="התנסות בתעשייה" selected>התנסות בתעשייה</option>
      </select>
      <select name="activity_season"><option value="school_2027" selected>2027</option></select>
      <button type="button" data-action="save-edit">שמור</button>
    </form>
  </body></html>`, { url: 'https://example.com/' });
  return { dom, form: dom.window.document.querySelector('form') };
}

const settings = {
  dropdown_options: {
    activity_names: [
      {
        label: 'התנסות בתעשייה',
        activity_name: 'התנסות בתעשייה',
        activity_no: '13990',
        activity_type: 'tour',
        parent_value: 'tour',
        active: true
      }
    ]
  }
};

test('legacy generic tour name is forced into the next save payload', () => {
  const row = {
    activity_type: 'tour',
    item_type: 'tour',
    activity_name: 'סיור',
    program_name: 'התנסות בתעשייה',
    activity_no: '13990',
    activity_season: 'school_2027'
  };
  const { dom, form } = buildForm(row);
  form._initialValues = { activity_name: 'התנסות בתעשייה' };

  assert.equal(polishActivityDrawerEditOptions(form, settings), true);
  form.querySelector('[data-action="save-edit"]').click();

  assert.equal(form.querySelector('[name="activity_name"]').value, 'התנסות בתעשייה');
  assert.equal(form._initialValues.activity_name, 'סיור');
  dom.window.close();
});

test('already-correct activity name is not marked as a synthetic change', () => {
  const row = {
    activity_type: 'tour',
    item_type: 'tour',
    activity_name: 'התנסות בתעשייה',
    program_name: 'התנסות בתעשייה',
    activity_no: '13990',
    activity_season: 'school_2027'
  };
  const { dom, form } = buildForm(row);
  form._initialValues = { activity_name: 'התנסות בתעשייה' };

  assert.equal(polishActivityDrawerEditOptions(form, settings), true);
  form.querySelector('[data-action="save-edit"]').click();

  assert.equal(form._initialValues.activity_name, 'התנסות בתעשייה');
  dom.window.close();
});
