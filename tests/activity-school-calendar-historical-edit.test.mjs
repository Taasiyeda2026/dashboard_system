import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const environment = new JSDOM('', { url: 'https://example.test/' });
globalThis.window = environment.window;
globalThis.document = environment.window.document;
globalThis.sessionStorage = environment.window.sessionStorage;
globalThis.localStorage = environment.window.localStorage;
const { schoolCalendarValidationMessage, startSchoolCalendarFormGuard } = await import('../frontend/src/screens/shared/school-calendar-form-guard.js');
const { supabase } = await import('../frontend/src/supabase-client.js');
test.after(() => {
  supabase?.auth?.stopAutoRefresh?.();
  environment.window.close();
});

const blockedDate = '2026-10-27';
const generalHoliday = {
  title: 'יום הבחירות', calendar_sector: 'general', start_date: blockedDate, end_date: blockedDate,
  blocks_scheduling: true, is_active: true, show_on_main_calendar: true
};

function formFixture({ oldDates = [blockedDate], newDates = oldDates, oldSchoolId = 'A1', newSchoolId = oldSchoolId } = {}) {
  const original = { school_id: oldSchoolId, end_time: '12:00' };
  oldDates.forEach((date, index) => { original[`date_${index + 1}`] = date; });
  const schools = [
    { school_id: 'A1', sector: 'jewish' },
    { school_id: 'A2', sector: 'jewish' },
    { school_id: 'B1', sector: 'arab' }
  ];
  const dom = new JSDOM(`<form data-activity-season="school_2027"
    data-school-records="${encodeURIComponent(JSON.stringify(schools))}">
    <input name="school_id" value="${newSchoolId}">
    <input name="end_time" value="12:00">
    <div data-meeting-dates-edit>${newDates.map((date, index) => (
      `<input data-meeting-idx="${index}" value="${date}">`
    )).join('')}</div>
    <p class="ds-activity-edit-status is-success">הפעילות נשמרה בהצלחה</p>
  </form>`);
  const form = dom.window.document.querySelector('form');
  form.dataset.exportRow = JSON.stringify(original);
  return form;
}

test('unchanged historical blocked date allows an unrelated authority or school correction', () => {
  const form = formFixture({ oldSchoolId: 'A1', newSchoolId: 'A2' });
  assert.equal(schoolCalendarValidationMessage(form, [generalHoliday]), '');
});

test('unchanged historical blocked date allows a notes-only save without replacing success with error', () => {
  const form = formFixture();
  form.insertAdjacentHTML('beforeend', '<textarea name="notes">הערה חדשה</textarea>');
  assert.equal(schoolCalendarValidationMessage(form, [generalHoliday]), '');
  assert.equal(form.querySelector('.ds-activity-edit-status').textContent, 'הפעילות נשמרה בהצלחה');
  assert.equal(form.querySelector('.ds-activity-edit-status').classList.contains('is-error'), false);
});

test('changing an existing meeting to a blocked date is rejected', () => {
  const form = formFixture({ oldDates: ['2026-10-20'], newDates: [blockedDate] });
  assert.match(schoolCalendarValidationMessage(form, [generalHoliday]), /לא ניתן לשמור פעילות/);
});

test('adding a new meeting on a blocked date is rejected', () => {
  const form = formFixture({ oldDates: ['2026-10-20'], newDates: ['2026-10-20', blockedDate] });
  assert.match(schoolCalendarValidationMessage(form, [generalHoliday]), /לא ניתן לשמור פעילות/);
});

test('school sector change rejects a date newly blocked in the destination sector', () => {
  const arabHoliday = { ...generalHoliday, title: 'חופשה במגזר הערבי', calendar_sector: 'arab' };
  const form = formFixture({ oldDates: [blockedDate], newDates: [blockedDate], oldSchoolId: 'A1', newSchoolId: 'B1' });
  assert.match(schoolCalendarValidationMessage(form, [arabHoliday]), /חופשה במגזר הערבי/);
});

test('school sector change allows a date blocked in both the old and new sectors', () => {
  const rows = [
    { ...generalHoliday, title: 'חופשה יהודית', calendar_sector: 'jewish' },
    { ...generalHoliday, title: 'חופשה ערבית', calendar_sector: 'arab' }
  ];
  const form = formFixture({ oldSchoolId: 'A1', newSchoolId: 'B1' });
  assert.equal(schoolCalendarValidationMessage(form, rows), '');
});

test('save click with an unchanged historical conflict saves once and shows success only', () => {
  document.body.innerHTML = '';
  const form = formFixture();
  document.body.append(form);
  form.setAttribute('data-drawer-form', '');
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = 'save-edit';
  form.append(button);

  let saves = 0;
  button.addEventListener('click', () => {
    saves += 1;
    const status = form.querySelector('.ds-activity-edit-status');
    status.textContent = 'הפעילות נשמרה בהצלחה';
    status.className = 'ds-activity-edit-status is-success';
  });
  startSchoolCalendarFormGuard({ getRows: () => [generalHoliday] });
  button.click();

  const status = form.querySelector('.ds-activity-edit-status');
  assert.equal(saves, 1);
  assert.equal(status.textContent, 'הפעילות נשמרה בהצלחה');
  assert.equal(status.classList.contains('is-success'), true);
  assert.equal(status.classList.contains('is-error'), false);
});

async function attemptRequest({ rows, loadRows, blocked = true }) {
  const originalDocument = globalThis.document;
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  try {
    const form = formFixture({ oldDates: ['2026-10-20'], newDates: [blocked ? blockedDate : '2026-10-21'] });
    document.body.append(form);
    form.setAttribute('data-drawer-form', '');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = 'save-edit';
    form.append(button);
    let submissions = 0;
    // A direct listener must also be blocked, even if it ignores data-action.
    button.addEventListener('click', () => { submissions += 1; });
    startSchoolCalendarFormGuard({ getRows: () => rows, loadRows });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { submissions, message: form.querySelector('.ds-activity-edit-status').textContent };
  } finally {
    globalThis.document = originalDocument;
    dom.window.close();
  }
}

test('blocked date prevents the request handler from running', async () => {
  const result = await attemptRequest({ rows: [generalHoliday] });
  assert.equal(result.submissions, 0);
  assert.match(result.message, /יום הבחירות/);
});

test('empty cached fallback reloads and blocks the holiday request', async () => {
  const result = await attemptRequest({ rows: [], loadRows: async () => [generalHoliday] });
  assert.equal(result.submissions, 0);
  assert.match(result.message, /יום הבחירות/);
});

test('calendar load failure preserves the form and does not submit', async () => {
  for (const loadRows of [async () => [], async () => { throw new Error('offline'); }]) {
    const result = await attemptRequest({ rows: null, loadRows });
    assert.equal(result.submissions, 0);
    assert.match(result.message, /לא ניתן לבדוק את לוח החופשות/);
  }
});

test('cold calendar load resumes an allowed request exactly once', async () => {
  const result = await attemptRequest({ rows: null, loadRows: async () => [generalHoliday], blocked: false });
  assert.equal(result.submissions, 1);
});
