import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function installDom(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  return dom;
}

globalThis.__ACTIVITY_DRAWER_TYPE_LAYOUT_FIX_TEST__ = true;
const moduleUrl = new URL('../frontend/src/activity-drawer-type-layout-fix.js', import.meta.url);
const { applyActivityDrawerTypeLayoutFix, applyActivityMeetingNotesToForm } = await import(`${moduleUrl.href}?test=${Date.now()}`);

function field(label, view, edit = '') {
  return `<div class="activity-drawer-inline__field">
    <div class="activity-drawer-inline__label">${label}</div>
    <div class="activity-drawer-inline__value" data-mode="view">${view}</div>
    ${edit ? `<div class="activity-drawer-inline__edit" data-mode="edit" hidden><div class="activity-drawer-inline__controls">${edit}</div></div>` : ''}
  </div>`;
}

function shell(row, fields, extraBeforeForm = '', bodyExtra = '') {
  return `<!doctype html><html><body>
    <div class="ds-ui-layer"><aside class="ds-drawer"><div class="ds-drawer__content">
      ${extraBeforeForm}
      <form data-drawer-form data-activity-drawer-inline-layout="true" data-export-row='${JSON.stringify(row)}'>
        <div class="activity-drawer__header">
          <div class="activity-drawer__header-top">
            <div class="activity-drawer__heading"><div class="activity-drawer__meta activity-drawer__meta--tags"></div></div>
            <div class="activity-drawer-inline__header-edit" data-mode="edit" hidden><div class="activity-drawer-inline__header-grid"></div></div>
            <div class="activity-drawer__header-actions"><button type="button" data-ui-close-drawer>✕</button></div>
          </div>
        </div>
        <div class="activity-drawer__body activity-drawer-inline__body">
          <section class="activity-drawer-inline__core"><div class="activity-drawer-inline__grid">${fields}</div></section>
          ${bodyExtra}
        </div>
      </form>
    </div></aside></div>
  </body></html>`;
}

test('course layout moves season to header and leaves a complete six-cell grid', () => {
  const row = {
    activity_type: 'course',
    activity_season: 'regular',
    activity_manager: 'גיל נאמן',
    instructor_name: 'אילנה',
    grade: 'ד',
    class_group: '',
    start_time: '10:00',
    end_time: '12:00',
    funding: 'גפן',
    price: 9500
  };
  const fields = [
    field('מנהל פעילות', 'גיל נאמן'),
    field('מדריך/ה', 'אילנה'),
    field('כיתה / קבוצה', 'ד'),
    field('שעות', '10:00–12:00'),
    field('גורם מימון', 'גפן'),
    field('מחיר', '₪9,500'),
    field('עונת פעילות', '2026', '<select name="activity_season"><option value="regular" selected>2026</option></select>')
  ].join('');

  const dom = installDom(shell(row, fields));
  const form = dom.window.document.querySelector('[data-drawer-form]');
  assert.equal(applyActivityDrawerTypeLayoutFix(form), true);

  const grid = form.querySelector('.activity-drawer-inline__grid');
  assert.equal(grid.dataset.activityLayout, 'course');
  assert.equal(grid.children.length, 6);
  assert.equal(grid.querySelector('[data-field-key="funding"] .activity-drawer-inline__label').textContent, 'גורם מימון');
  assert.equal([...grid.querySelectorAll('.activity-drawer-inline__label')].some((node) => node.textContent.trim() === 'עונת פעילות'), false);
  assert.equal(form.querySelectorAll('[name="activity_season"]').length, 1);
  assert.ok(form.querySelector('.activity-drawer-type-fix__season-edit'));
  assert.equal(form.querySelector('[data-activity-season-tag]').textContent, '2026');

  dom.window.close();
});

test('workshop layout separates both instructors and keeps archive reopen action visible in header', () => {
  const row = {
    activity_type: 'workshop',
    activity_season: 'regular',
    instructor_name: 'אילנה',
    instructor_name_2: 'אלכס'
  };
  const instructorEdit = `
    <input type="hidden" name="instructor_name" value="אילנה">
    <input type="hidden" name="instructor_name_2" value="אלכס">
    <select name="emp_id"><option selected>אילנה</option></select>
    <select name="emp_id_2"><option selected>אלכס</option></select>`;
  const fields = [
    field('מנהל פעילות', 'גיל נאמן'),
    field('מדריכים', 'אילנה / אלכס', instructorEdit),
    field('כיתה / קבוצה', 'ד'),
    field('שעות', '10:00–12:00'),
    field('מימון', 'גפן'),
    field('מחיר', '₪450'),
    field('עונת פעילות', '2026', '<select name="activity_season"><option value="regular" selected>2026</option></select>')
  ].join('');
  const reopen = '<div class="archive-action-wrap"><button type="button" data-archive-reopen="ROW-1">🔓 פתח מחדש</button></div>';

  const dom = installDom(shell(row, fields, reopen));
  const form = dom.window.document.querySelector('[data-drawer-form]');
  assert.equal(applyActivityDrawerTypeLayoutFix(form), true);

  const grid = form.querySelector('.activity-drawer-inline__grid');
  assert.equal(grid.dataset.activityLayout, 'workshop');
  const labels = [...grid.querySelectorAll('.activity-drawer-inline__label')].map((node) => node.textContent.trim());
  assert.equal(labels.includes('מדריכים'), false);
  assert.equal(labels.filter((label) => label === 'מדריך/ה 1').length, 1);
  assert.equal(labels.filter((label) => label === 'מדריך/ה 2').length, 1);
  assert.equal(form.querySelectorAll('[name="emp_id"]').length, 1);
  assert.equal(form.querySelectorAll('[name="emp_id_2"]').length, 1);

  const action = form.querySelector('.activity-drawer__header-actions [data-archive-reopen]');
  assert.ok(action);
  assert.ok(action.classList.contains('activity-drawer-type-fix__archive-action'));
  assert.ok(form.querySelector('.activity-drawer__header-actions [data-ui-close-drawer]'));
  assert.equal(dom.window.document.querySelector('.archive-action-wrap'), null);

  dom.window.close();
});

test('course top summary precedes details, coordination is compact there, and saved meeting notes rehydrate', () => {
  const row = {
    row_id: 'ROW-2027-1',
    activity_type: 'course',
    activity_season: 'school_2027',
    start_date: '2026-10-07',
    end_date: '2027-01-13',
    date_1: '2026-10-07',
    date_2: '2026-10-14'
  };
  const fields = [
    field('מנהל פעילות', 'הילה רוזן'),
    field('מדריך/ה', '—'),
    field('כיתה / קבוצה', 'ח׳'),
    field('שעות', '08:45–10:30'),
    field('גורם מימון', 'גפן'),
    field('מחיר', '₪14,000'),
    field('עונת פעילות', '2027', '<select name="activity_season"><option value="school_2027" selected>2027</option></select>')
  ].join('');
  const bodyExtra = `
    <section data-dates-section>
      <div class="activity-drawer__date-summary" data-mode="view">
        <div class="activity-drawer__date-boundary"><span class="activity-drawer__end-date__label">תאריך התחלה:</span><strong data-computed-start-display>07/10/2026</strong></div>
        <div class="activity-drawer__date-boundary"><span class="activity-drawer__end-date__label">תאריך סיום:</span><strong data-computed-end-display>13/01/2027</strong></div>
      </div>
      <div data-dates-view-chips>
        <div class="activity-drawer__date-chip" data-date-card><span>07/10/2026</span></div>
        <div class="activity-drawer__date-chip" data-date-card><span>14/10/2026</span></div>
      </div>
      <div data-meeting-dates-edit>
        <div><input data-meeting-idx="0" value="2026-10-07"><textarea data-meeting-note-idx="0"></textarea></div>
        <div><input data-meeting-idx="1" value="2026-10-14"><textarea data-meeting-note-idx="1"></textarea></div>
      </div>
    </section>
    <div class="activity-drawer__actions-row" data-activity-actions data-view-only>
      <button type="button" data-coordination-approval>אישור תיאום</button>
    </div>`;

  const dom = installDom(shell(row, fields, '', bodyExtra));
  const form = dom.window.document.querySelector('[data-drawer-form]');
  let refreshed = 0;
  form._refreshInitialValues = () => { refreshed += 1; };

  assert.equal(applyActivityDrawerTypeLayoutFix(form), true);

  const top = form.querySelector('[data-activity-drawer-top-summary]');
  const core = form.querySelector('.activity-drawer-inline__core');
  assert.ok(top);
  assert.equal(top.nextElementSibling, core);
  assert.equal(top.hasAttribute('data-view-only'), true);
  assert.equal(top.querySelector('[data-top-start-display]').textContent, '07/10/2026');
  assert.equal(top.querySelector('[data-top-end-display]').textContent, '13/01/2027');
  assert.deepEqual(
    [...top.querySelectorAll('.activity-drawer-type-fix__top-date-label')].map((node) => node.textContent),
    ['תאריך התחלה', 'תאריך סיום']
  );
  assert.equal(form.querySelector('[data-dates-section] .activity-drawer__date-summary').dataset.typeFixDateSummarySource, 'true');
  assert.equal(form.querySelector('[data-activity-actions]').parentElement, top);

  assert.equal(applyActivityMeetingNotesToForm(form, [{ meeting_no: '2', notes: 'בדיקה' }]), true);
  assert.equal(form.querySelector('textarea[data-meeting-note-idx="0"]').value, '');
  assert.equal(form.querySelector('textarea[data-meeting-note-idx="1"]').value, 'בדיקה');
  assert.equal(form.querySelectorAll('.activity-drawer__date-note-icon').length, 1);
  assert.equal(form.querySelectorAll('[data-date-card]')[1].querySelector('.activity-drawer__date-note-icon').title, 'בדיקה');
  assert.equal(refreshed, 1);

  dom.window.close();
});
