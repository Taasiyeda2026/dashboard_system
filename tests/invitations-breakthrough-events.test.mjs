import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { invitationsScreen } from '../frontend/src/screens/invitations.js';

function mount(savedFields) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>', {
    url: 'https://example.org/', pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Image = dom.window.Image;
  globalThis.requestAnimationFrame = (callback) => callback();
  if (savedFields) {
    localStorage.setItem('taasiyeda_invitation_builder_state_v4', JSON.stringify({ fields: savedFields }));
  }
  const root = document.getElementById('root');
  root.innerHTML = invitationsScreen.render();
  invitationsScreen.bind({ root });
  const el = (id) => root.querySelector('#' + id);
  const change = (id, value, event = 'change') => {
    el(id).value = value;
    el(id).dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  };
  return { dom, el, change };
}

test('course has exact event-specific closing copy without truncation', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  assert.equal(ui.el('year').value, 'תשפ״ז');
  assert.equal(ui.el('card').querySelector('.c-title').textContent, 'הזמנה');
  assert.equal(ui.el('card').querySelector('.c-sub-event').textContent, 'למפגש הסיום');
  assert.equal(ui.el('card').querySelector('.c-course').textContent, 'של קורס "פורצות דרך"');
  assert.equal(ui.el('card').querySelector('.c-opening').textContent,
    'הנכם מוזמנים למפגש הסיום של קורס "פורצות דרך", שהתקיים בבית הספר במסגרת התוכניות החינוכיות של תעשיידע.');
  assert.equal(ui.el('b1').value,
    'במהלך הקורס יצאו התלמידות למסע מעצים ומעורר השראה, שבו הכירו נשים פורצות דרך מתחומים שונים, נחשפו לסיפורי הצלחה ולהתמודדות עם אתגרים וגילו כיצד אומץ, נחישות, יצירתיות ואמונה עצמית יכולים להוביל להישגים משמעותיים וליצירת שינוי.');
  assert.equal(ui.el('b2').value,
    'התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד. הזדמנות לחגוג את הדרך שעברו, את הכוחות שגילו בעצמן ואת האומץ לחלום בגדול ולסלול דרך משלהן.');
  assert.equal(ui.el('card').querySelector('.c-section-title').textContent, 'מה מצפה לנו:');
  assert.match(ui.el('card').textContent, /האומץ לחלום בגדול ולסלול דרך משלהן/);
  ui.dom.window.close();
});

test('switches immediately to female guest lecture and back, retaining correct template for each', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  assert.equal(ui.el('card').querySelector('.c-title').textContent, 'הזמנה להרצאת אורחת');
  assert.equal(ui.el('card').querySelector('.c-sub-event'), null);
  assert.equal(ui.el('card').querySelector('.c-course').textContent, 'במסגרת קורס "פורצות דרך"');
  assert.equal(ui.el('card').querySelector('.c-opening').textContent,
    'קורס "פורצות דרך" מזמין את התלמידות להכיר נשים מעוררות השראה מתחומים שונים ולגלות כיצד אומץ, יצירתיות ונחישות יכולים להוביל להישגים משמעותיים וליצירת שינוי.');
  assert.equal(ui.el('b1-editor').style.display, 'none');
  assert.equal(ui.el('b1').value, '');
  assert.equal(ui.el('b2').value,
    'מפגש מעצים ומעורר השראה עם אישה פורצת דרך, שתשתף במסעה האישי, בחלומות שהפכה למציאות ובאתגרים שהתגברה עליהם. הזדמנות לתלמידות לגלות את הכוח הטמון בהן, להאמין בעצמן ולקבל השראה לחלום בגדול, לפרוץ גבולות ולהעז להגשים את שאיפותיהן.');
  assert.match(ui.el('card').textContent, /להעז להגשים את שאיפותיהן/);
  ui.change('ev-type', 'end');
  assert.equal(ui.el('ev-type').value, 'end');
  assert.equal(ui.el('card').querySelector('.c-sub-event').textContent, 'למפגש הסיום');
  assert.equal(ui.el('b1-editor').style.display, 'block');
  assert.match(ui.el('b2').value, /לסלול דרך משלהן/);
  ui.dom.window.close();
});

test('changing event type does not revert saved picker or erase lecture details', () => {
  const ui = mount({ 'ev-type': 'end', 'course-sel': 'רוקחים עולם' });
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  assert.match(ui.el('card').textContent, /להרצאת אורח/);
  assert.ok(ui.el('lec-name'));
  ui.change('lec-name', 'מרצה לדוגמה', 'input');
  ui.change('ev-type', 'tour');
  assert.equal(ui.el('ev-type').value, 'tour');
  assert.ok(ui.el('tour-place'));
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  assert.equal(ui.el('lec-name').value, 'מרצה לדוגמה');
  assert.match(ui.el('card').textContent, /מרצה לדוגמה/);
  ui.change('ev-type', 'end');
  assert.equal(ui.el('ev-type').value, 'end');
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).fields['ev-type'], 'end');
  ui.dom.window.close();
});

test('existing other-course suggestions and premium company remain functional', () => {
  const ui = mount();
  ui.change('course-sel', 'יזמות פרימיום');
  ui.change('premium-company', 'אסם', 'input');
  assert.match(ui.el('card').textContent, /בליווי אסם/);
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  ui.change('course-sel', 'רוקחים עולם');
  assert.match(ui.el('b1').value, /פארמצבטיקה/);
  assert.equal(ui.el('premium-company-row').style.display, 'none');
  ui.dom.window.close();
});
