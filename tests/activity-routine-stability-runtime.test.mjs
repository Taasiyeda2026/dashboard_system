import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const {
  SCHOOL_2027_DATE_MIN,
  SCHOOL_2027_DATE_MAX,
  applySchool2027DateBounds,
  validateSchool2027FormDates
} = await import('../frontend/src/activity-routine-stability-runtime.js');

function addForm(date = '') {
  const dom = new JSDOM(`
    <form data-add-activity-form>
      <select name="activity_season"><option value="school_2027" selected>2027</option></select>
      <input type="date" name="start_date" value="${date}">
      <input type="date" data-meeting-idx="0" value="${date}">
    </form>
  `);
  return dom.window.document.querySelector('form');
}

test('school_2027 activity forms receive the 2026-09-01 through 2027-08-31 input bounds', () => {
  const form = addForm('2026-10-07');
  applySchool2027DateBounds(form);
  const inputs = [...form.querySelectorAll('input[type="date"]')];
  assert.equal(inputs.length, 2);
  for (const input of inputs) {
    assert.equal(input.min, SCHOOL_2027_DATE_MIN);
    assert.equal(input.max, SCHOOL_2027_DATE_MAX);
    assert.equal(input.dataset.activityDateRangeBound, 'school_2027');
  }
  assert.equal(validateSchool2027FormDates(form).valid, true);
});

test('year 0026 is rejected before an add/edit request can reach the database', () => {
  const form = addForm('0026-10-07');
  applySchool2027DateBounds(form);
  const result = validateSchool2027FormDates(form);
  assert.equal(result.valid, false);
  assert.match(result.message, /01\.09\.2026/);
  assert.match(result.message, /31\.08\.2027/);
  assert.equal(result.input?.validationMessage.includes('בתשפ״ז'), true);
});

test('historical/non-school_2027 activity forms are not constrained by the 2027 range guard', () => {
  const form = addForm('2026-06-15');
  form.querySelector('[name="activity_season"]').innerHTML = '<option value="regular" selected>2026</option>';
  applySchool2027DateBounds(form);
  assert.equal(form.querySelector('[name="start_date"]').hasAttribute('min'), false);
  assert.equal(validateSchool2027FormDates(form).valid, true);
});
