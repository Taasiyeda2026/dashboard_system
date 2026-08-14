import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const HEADER_POLISH_CSS = new URL('../frontend/src/styles/activity-drawer-edit-header-polish.css', import.meta.url);

function installDom(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  return dom;
}

globalThis.__ACTIVITY_DRAWER_INLINE_LAYOUT_TEST__ = true;
globalThis.__ACTIVITY_DRAWER_EDIT_DEDUP_TEST__ = true;
const moduleUrl = new URL('../frontend/src/activity-drawer-inline-layout.js', import.meta.url);
const dedupModuleUrl = new URL('../frontend/src/activity-drawer-edit-dedup.js', import.meta.url);
const { enhanceActivityDrawerForm } = await import(`${moduleUrl.href}?test=${Date.now()}`);
const { polishActivityDrawerEditOptions } = await import(`${dedupModuleUrl.href}?test=${Date.now()}`);

test('activity drawer becomes one inline view/edit template without duplicate headings', () => {
  const row = {
    activity_type: 'course',
    activity_name: 'ביומימיקרי',
    activity_no: '6089',
    status: 'פתוח',
    activity_season: 'school_2027',
    authority: 'קריית גת',
    school: 'כרמים',
    activity_manager: '',
    instructor_name: '',
    grade: '',
    class_group: '',
    start_time: '',
    end_time: '',
    funding: 'גפן',
    price: 9900
  };

  const dom = installDom(`<!doctype html><html><body>
    <div class="ds-ui-layer"><aside class="ds-drawer">
      <header class="ds-drawer__header"><h2></h2></header>
      <div class="ds-drawer__content">
        <div class="activity-drawer__header activity-drawer__header--sticky">
          <div class="activity-drawer__header-top">
            <div class="activity-drawer__heading"><h2 class="activity-drawer__title">ביומימיקרי</h2><div class="activity-drawer__meta">קורס</div></div>
            <div class="activity-drawer__header-actions"><button type="button">✕</button></div>
          </div>
        </div>
        <div class="activity-drawer__body">
          <form data-drawer-form data-export-row='${JSON.stringify(row)}'>
            <input type="hidden" name="activity_no" value="6089">
            <section data-central-info-section>
              <div class="activity-view-field"><span class="activity-view-field__label">מנהל פעילות</span><span class="activity-view-field__value">ללא</span></div>
              <div class="activity-view-field"><span class="activity-view-field__label">מדריך/ה</span><span class="activity-view-field__value"></span></div>
              <div class="activity-view-field"><span class="activity-view-field__label">כיתה / קבוצה</span><span class="activity-view-field__value"></span></div>
              <div class="activity-view-field"><span class="activity-view-field__label">שעות</span><span class="activity-view-field__value"></span></div>
            </section>
            <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden><h3 class="activity-drawer__section-title">פרטי פעילות</h3><div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">סוג פעילות</div><select name="activity_type"><option value="course" selected>קורס</option></select></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">שם קורס</div><select name="activity_name" data-role="activity-name-select"><option selected>ביומימיקרי</option><option>מייקרים</option></select></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">סטטוס</div><select name="status"><option selected>פתוח</option></select></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">עונת פעילות</div><select name="activity_season"><option value="regular">Regular</option></select></div>
            </div></section>
            <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden><h3 class="activity-drawer__section-title">שיוך ומיקום</h3><div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">רשות</div><input name="authority" value="קריית גת"></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">בית ספר</div><input name="school" value="כרמים"></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">כיתה / קבוצה</div><div><select name="grade"><option></option></select><input name="class_group"></div></div>
            </div></section>
            <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden><h3 class="activity-drawer__section-title">צוות וזמנים</h3><div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">מנהל פעילות</div><select name="activity_manager"><option></option></select></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">מדריך/ה</div><input type="hidden" name="instructor_name"><select name="emp_id"><option></option></select></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">שעת התחלה / סיום</div><div><input name="start_time"><input name="end_time"></div></div>
            </div></section>
            <section class="activity-drawer__section activity-drawer__section--edit-group" data-mode="edit" hidden><h3 class="activity-drawer__section-title">מידע משלים</h3><div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">מימון ישן</div><input name="funding" value="גפן"></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">גורם מימון</div><select name="funding_sources" multiple data-scheduling-multi><option value="a" selected>גפן</option></select></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">מחיר</div><input name="price" value="9900"></div>
              <div class="activity-drawer__field"><div class="activity-drawer__label">מספר משתתפים</div><input name="participants_count" value="18"></div>
            </div></section>
            <section class="activity-drawer__section" data-dates-section><div class="activity-drawer__section-head"><h3 class="activity-drawer__section-title">התקדמות הקורס</h3></div><div class="activity-drawer__progress-row" data-mode="view"><span>0 מתוך 11</span></div><div data-mode="edit" hidden></div></section>
            <section class="activity-drawer__section" data-contact-2027-section><h3 class="activity-drawer__section-title">איש קשר</h3><input type="hidden" name="contact_name" value="אורית"><div data-mode="view"><div class="activity-view-field"><span class="activity-view-field__label">פרטי קשר</span><span class="activity-view-field__value">אורית</span></div></div><div data-mode="edit" hidden><div><label>איש קשר</label><select data-contact-2027-select></select></div></div></section>
            <section class="activity-drawer__section activity-view-notes activity-view-notes--empty" data-notes-section><div data-mode="edit" hidden><div class="activity-view-notes__label">הערה</div><textarea name="notes"></textarea></div></section>
            <section class="activity-drawer__section activity-drawer__section--actions" data-mode="edit" hidden><button data-action="save-edit">שמור</button></section>
            <div class="activity-drawer__view-footer" data-mode="view"><button data-action="start-edit">עריכה</button></div>
          </form>
        </div>
      </div>
    </aside></div>
  </body></html>`);

  const form = dom.window.document.querySelector('[data-drawer-form]');
  assert.equal(enhanceActivityDrawerForm(form), true);

  const settings = {
    dropdown_options: {
      activity_names: [
        { label: 'ביומימיקרי', activity_name: 'ביומימיקרי', activity_no: '6089', activity_type: 'course', parent_value: 'course', active: true, sort_order: 1 },
        { label: 'ביומימיקרי', activity_name: 'ביומימיקרי', activity_no: '82835', activity_type: 'course', parent_value: 'course', active: true, sort_order: 11 },
        { label: 'בינה מלאכותית', activity_name: 'בינה מלאכותית', activity_no: '100', activity_type: 'course', parent_value: 'course', active: true, sort_order: 12 },
        { label: 'מייקרים', activity_name: 'מייקרים', activity_no: '58221', activity_type: 'course', parent_value: 'course', active: false, sort_order: 20 }
      ]
    }
  };
  assert.equal(polishActivityDrawerEditOptions(form, settings), true);

  const drawer = dom.window.document.querySelector('.ds-drawer');
  assert.ok(drawer.classList.contains('ds-drawer--activity-inline'));
  assert.ok(form.classList.contains('activity-drawer-inline-layout'));
  assert.ok(form.querySelector(':scope > .activity-drawer__header'));
  assert.ok(form.querySelector(':scope > .activity-drawer__body'));

  assert.equal(form.querySelectorAll('.activity-drawer__section--edit-group').length, 0);
  assert.equal(form.querySelectorAll('[data-central-info-section]').length, 0);
  assert.equal(form.querySelectorAll('[name="activity_type"]').length, 1);
  assert.equal(form.querySelectorAll('[name="activity_name"]').length, 1);
  assert.equal(form.querySelectorAll('[name="authority"]').length, 1);
  assert.equal(form.querySelectorAll('[name="school"]').length, 1);

  const headerEdit = form.querySelector('.activity-drawer-inline__header-edit');
  assert.ok(headerEdit);
  assert.equal(headerEdit.hidden, true);
  assert.equal(headerEdit.querySelector('[data-activity-name-label] .activity-drawer-inline__header-label').textContent, 'שם קורס');

  const courseOptions = [...form.querySelector('[name="activity_name"]').options]
    .map((option) => option.textContent.trim())
    .filter(Boolean)
    .filter((label) => label !== '—');
  assert.deepEqual(courseOptions, ['ביומימיקרי', 'בינה מלאכותית']);
  assert.equal(courseOptions.filter((label) => label === 'ביומימיקרי').length, 1);
  assert.equal(courseOptions.includes('מייקרים'), false);
  assert.equal(form.querySelector('[name="activity_name"] option:checked')?.dataset.activityNo, '6089');

  assert.equal(form.querySelector('[name="activity_season"]'), null);

  const labels = [...form.querySelectorAll('.activity-drawer-inline__label')].map((node) => node.textContent.trim());
  assert.deepEqual(labels.slice(0, 7), ['מנהל פעילות', 'מדריך/ה', 'כיתה / קבוצה', 'שעות', 'גורם מימון', 'מחיר', 'מספר משתתפים']);
  assert.equal(form.textContent.includes('עונת פעילות'), false);
  assert.equal(form.textContent.includes('מימון ישן'), false);
  assert.equal(form.querySelector('.activity-drawer-inline__field--participants').hidden, true);
  const activityType = form.querySelector('[name="activity_type"]');
  activityType.append(new dom.window.Option('סדנה', 'workshop'));
  activityType.value = 'workshop';
  activityType.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(form.querySelector('.activity-drawer-inline__field--participants').hidden, false);
  assert.equal(labels.filter((label) => label === 'איש קשר').length, 1);
  assert.equal(form.textContent.includes('פרטי קשר'), false);
  assert.equal(form.textContent.includes('צוות וזמנים'), false);
  assert.equal(form.textContent.includes('מידע משלים'), false);

  const progress = form.querySelector('.activity-drawer__progress-row');
  assert.equal(progress.hasAttribute('data-mode'), false);
  assert.equal(progress.hidden, false);
  assert.match(form.querySelector('.activity-drawer-inline__field:nth-child(6) .activity-drawer-inline__value').textContent, /9,900/);

  dom.window.close();
});

test('desktop activity details use four responsive columns', async () => {
  const css = await readFile(new URL('../frontend/src/styles/activity-drawer-inline-layout.css', import.meta.url), 'utf8');
  const typeLayoutCss = await readFile(new URL('../frontend/src/styles/activity-drawer-type-layout-fix.css', import.meta.url), 'utf8');
  assert.match(css, /\.activity-drawer-inline__grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/);
  assert.match(typeLayoutCss, /\.activity-drawer-inline__grid\[data-activity-layout="course"\],[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.doesNotMatch(typeLayoutCss, /\.activity-drawer-inline__grid\[data-activity-layout="course"\],[^}]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.activity-drawer-inline__grid\s*\{[\s\S]*?repeat\(2,/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.activity-drawer-inline__grid,[\s\S]*?grid-template-columns:\s*1fr/);
});

test('edit mode CSS hides the display heading instead of stacking it above the fields', async () => {
  const css = await readFile(HEADER_POLISH_CSS, 'utf8');
  assert.match(css, /\[data-editing="yes"\][\s\S]*\.activity-drawer__heading[\s\S]*display:\s*none\s*!important/);
});
