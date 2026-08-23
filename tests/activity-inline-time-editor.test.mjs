import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { applyApprovedDrawerFixes, normalizeTypedTime } from '../frontend/src/activity-drawer-approved-fixes.js';

test('typed activity times normalize without fixed interval choices', () => {
  assert.equal(normalizeTypedTime('8'), '08:00');
  assert.equal(normalizeTypedTime('830'), '08:30');
  assert.equal(normalizeTypedTime('945'), '09:45');
  assert.equal(normalizeTypedTime('14'), '14:00');
  assert.equal(normalizeTypedTime('1430'), '14:30');
  assert.equal(normalizeTypedTime('09:45'), '09:45');
  assert.equal(normalizeTypedTime('2360'), '');
  assert.equal(normalizeTypedTime('24:00'), '');
});

test('approved drawer edit controls stay compact without document observers', () => {
  const source = fs.readFileSync('frontend/src/activity-drawer-approved-fixes.js', 'utf8');
  const typeLayout = fs.readFileSync('frontend/src/activity-drawer-type-layout-fix.js', 'utf8');
  const inlineLayout = fs.readFileSync('frontend/src/activity-drawer-inline-layout.js', 'utf8');
  const dedup = fs.readFileSync('frontend/src/activity-drawer-edit-dedup.js', 'utf8');
  const floatingActions = fs.readFileSync('frontend/src/activity-drawer-floating-actions.js', 'utf8');
  const timeOptions = fs.readFileSync('frontend/src/screens/shared/activity-time-options.js', 'utf8');
  assert.match(source, /HEADER_ORDER/);
  assert.match(source, /'activity_domain'/);
  assert.doesNotMatch(source, /makeHeaderField|oldField\?\.remove\(\)/);
  assert.match(inlineLayout, /const domainControls = extractFieldControls\(form, \['activity_domain'\]\)/);
  assert.match(inlineLayout, /label: 'תחום',[\s\S]*?editControls: domainControls/);
  assert.match(source, /activity-drawer-inline__header-field--name/);
  assert.match(source, /grid-column: auto !important/);
  assert.match(source, /activity-approved-time-row/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /שעת הסיום חייבת להיות מאוחרת משעת ההתחלה/);
  [source, typeLayout, inlineLayout, dedup, floatingActions, timeOptions].forEach((moduleSource) => {
    assert.doesNotMatch(moduleSource, /MutationObserver/);
  });
});

test('approved drawer retains the domain in its source header and validates typed times without changing the end time', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <form data-drawer-form data-activity-drawer-inline-layout>
      <div class="activity-drawer-inline__header-grid">
        <div class="activity-drawer-inline__header-field"><select name="activity_type"><option>קורס</option></select></div>
        <div class="activity-drawer-inline__header-field activity-drawer-inline__header-field--name"><select name="activity_name"><option>שם קורס</option></select></div>
        <div class="activity-drawer-inline__header-field"><select name="status"><option>פתוח</option></select></div>
        <div class="activity-drawer-inline__header-field activity-drawer-inline__header-field--domain"><select name="activity_domain"><option value="E" selected>E</option><option value="Y">Y</option></select></div>
        <div class="activity-drawer-inline__header-field"><input name="authority" value="רשות"></div>
        <div class="activity-drawer-inline__header-field"><input name="school" value="בית ספר"></div>
      </div>
      <div class="activity-drawer-inline__field" data-domain-body></div>
      <div class="activity-drawer-inline__field">
        <div class="activity-drawer-inline__edit">
          <select name="start_time"><option value="08:00" selected>08:00</option></select>
          <select name="end_time"><option value="09:00" selected>09:00</option></select>
        </div>
      </div>
      <button type="button" data-action="save-edit">שמור</button>
    </form>
  </body></html>`);
  const { document, Event } = dom.window;
  const form = document.querySelector('[data-drawer-form]');

  assert.equal(applyApprovedDrawerFixes(form), true);
  assert.equal(applyApprovedDrawerFixes(form), true);
  assert.equal(form.querySelectorAll('[name="activity_domain"]').length, 1);
  assert.equal(form.querySelector('[data-domain-body] [name="activity_domain"]'), null);
  assert.equal(form.querySelector('.activity-drawer-inline__header-grid [name="activity_domain"]').value, 'E');

  const start = form.querySelector('[name="start_time"]');
  const end = form.querySelector('[name="end_time"]');
  start.value = '830';
  start.dispatchEvent(new Event('blur', { bubbles: true }));
  end.value = '945';
  end.dispatchEvent(new Event('blur', { bubbles: true }));
  assert.equal(start.value, '08:30');
  assert.equal(end.value, '09:45');

  end.value = '800';
  end.dispatchEvent(new Event('blur', { bubbles: true }));
  assert.equal(end.value, '08:00');
  assert.match(form.querySelector('[data-approved-time-error]').textContent, /שעת הסיום חייבת להיות מאוחרת/);

  const save = form.querySelector('[data-action="save-edit"]');
  assert.equal(save.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })), false);
  dom.window.close();
});

test('approved drawer fixes run from the form binding lifecycle', () => {
  const binder = fs.readFileSync('frontend/src/screens/shared/bind-activity-edit-form.js', 'utf8');
  const pipeline = fs.readFileSync('frontend/src/activity-drawer-layout-pipeline.js', 'utf8');
  assert.match(pipeline, /enhanceActivityDrawerForm\(form\)/);
  assert.match(pipeline, /applyActivityDrawerTypeLayoutFix\(form\)/);
  assert.match(binder, /applyActivityDrawerLayoutPipeline\(contentRoot/);
  assert.match(binder, /applyApprovedDrawerFixes\(form\)/);
  assert.match(binder, /isApprovedTimeEditor/);
});
