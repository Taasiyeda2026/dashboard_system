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
    'התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד.');
  assert.equal(ui.el('card').querySelector('.c-section-title').textContent, 'מה מצפה לנו?');
  assert.doesNotMatch(ui.el('card').textContent, /הזדמנות לחגוג את הדרך שעברו/);
  ui.dom.window.close();
});

test('switches immediately to female guest lecture and back, retaining correct template for each', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  assert.equal(ui.el('card').querySelector('.c-title').textContent, 'הזמנה להרצאת אורחת של:');
  assert.equal(ui.el('card').querySelector('.c-sub-event'), null);
  assert.equal(ui.el('card').querySelector('.c-course').textContent, 'במסגרת קורס ״פורצות דרך״');
  assert.equal(ui.el('card').querySelector('.c-opening').textContent,
    "קורס ״פורצות דרך״ משלב יזמות טכנולוגית והעצמה נשית ומעודד את התלמידות לחלום בגדול, לפתח רעיונות ולהאמין ביכולתן להוביל שינוי. דרך היכרות עם נשים שהעזו לפרוץ גבולות, הן מגלות כיצד אומץ, יצירתיות, נחישות ואמונה עצמית יכולים להפוך שאיפות להישגים משמעותיים ולפתוח דלתות לאפשרויות חדשות.");
  assert.equal(ui.el('b1-editor').style.display, 'none');
  assert.equal(ui.el('b1').value, '');
  assert.equal(ui.el('b2').value,
    "מפגש מעורר השראה עם אישה פורצת דרך, שתחשוף את הסיפור שמאחורי הצלחתה – החלומות שהעזה להגשים, האתגרים שניצבו בדרכה והרגעים שבהם בחרה לא לוותר. מסע אישי ומרתק אל ההחלטות, התובנות ונקודות המפנה שעיצבו את דרכה והפכו את שאיפותיה למציאות.");
  assert.equal(ui.el('card').querySelector('.c-section-title').textContent, 'מה מצפה לנו?');
  assert.equal(ui.el('card').querySelector('.c-section-title').nextElementSibling.textContent, "מפגש מעורר השראה עם אישה פורצת דרך, שתחשוף את הסיפור שמאחורי הצלחתה – החלומות שהעזה להגשים, האתגרים שניצבו בדרכה והרגעים שבהם בחרה לא לוותר. מסע אישי ומרתק אל ההחלטות, התובנות ונקודות המפנה שעיצבו את דרכה והפכו את שאיפותיה למציאות.");
  assert.equal(ui.el('card').querySelector('.c-closing').textContent, 'נשמח לראותכם!');
  assert.doesNotMatch(ui.el('card').textContent, /הזדמנות לתלמידות לגלות את הכוח/);
  ui.change('lec-name', 'דנה לדוגמה', 'input');
  ui.change('lec-role', 'מנהלת פיתוח', 'input');
  ui.change('lec-org', 'חברת לדוגמה', 'input');
  const identity = ui.el('card').querySelector('.c-lecturer-identity');
  assert.equal(identity.textContent, 'דנה לדוגמה, מנהלת פיתוח - חברת לדוגמה');
  assert.equal(identity.previousElementSibling.textContent, 'הזמנה להרצאת אורחת של:');
  assert.equal(identity.nextElementSibling.textContent, 'במסגרת קורס ״פורצות דרך״');
  assert.equal(identity.querySelectorAll('div').length, 0);
  assert.equal(identity.style.whiteSpace, '');
  assert.equal(ui.el('card').querySelectorAll('.c-lecturer-identity').length, 1);
  assert.doesNotMatch(ui.el('card').querySelector('.c-details-box').textContent, /דנה לדוגמה|מנהלת פיתוח|חברת לדוגמה/);
  ui.change('ev-type', 'end');
  assert.equal(ui.el('ev-type').value, 'end');
  assert.equal(ui.el('card').querySelector('.c-sub-event').textContent, 'למפגש הסיום');
  assert.equal(ui.el('b1-editor').style.display, 'block');
  assert.equal(ui.el('b2').value, 'התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד.');
  ui.dom.window.close();
});

test('changing event type does not revert saved picker or erase lecture details', () => {
  const ui = mount({ 'ev-type': 'end', 'course-sel': 'רוקחים עולם' });
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  assert.match(ui.el('card').textContent, /להרצאת אורח/);
  assert.ok(ui.el('lec-name'));
  ui.change('lec-name', 'מרצה לדוגמה', 'input');
  ui.change('lec-role', 'מהנדסת ראשית', 'input');
  ui.change('lec-org', 'חברת דוגמה', 'input');
  ui.change('ev-type', 'tour');
  assert.equal(ui.el('ev-type').value, 'tour');
  assert.ok(ui.el('tour-place'));
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('ev-type').value, 'lecture');
  assert.equal(ui.el('lec-name').value, 'מרצה לדוגמה');
  assert.equal(ui.el('lec-role').value, 'מהנדסת ראשית');
  assert.equal(ui.el('lec-org').value, 'חברת דוגמה');
  assert.equal(ui.el('card').querySelector('.c-title').textContent, 'הזמנה להרצאת אורח של:');
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity').textContent, 'מרצה לדוגמה, מהנדסת ראשית - חברת דוגמה');
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


test('breakthrough course uses requested colors in picker, A5 preview and print', () => {
  const ui = mount();
  assert.equal(ui.el('c1').value, '#1a3a5c');
  assert.equal(ui.el('c2').value, '#1a8c6e');
  assert.equal(ui.el('c3').value, '#1a8c6e');

  ui.change('course-sel', 'פורצות דרך');
  assert.equal(ui.el('c1').value, '#1f354d');
  assert.equal(ui.el('c2').value, '#a40461');
  assert.equal(ui.el('c3').value, '#5b0143');
  assert.match(ui.el('card').getAttribute('style'), /--accent-color:#a40461/);
  assert.match(ui.el('card').querySelector('.c-title').getAttribute('style'), /#1f354d/);
  assert.match(ui.el('card').querySelector('.c-course').getAttribute('style'), /#5b0143/);

  let printedHtml = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printedHtml = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.match(printedHtml, /--main-color:#1f354d/);
  assert.match(printedHtml, /--accent-color:#a40461/);
  assert.match(printedHtml, /--course-color:#5b0143/);

  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('c1').value, '#1f354d');
  assert.equal(ui.el('c2').value, '#a40461');
  assert.equal(ui.el('c3').value, '#5b0143');

  ui.change('course-sel', 'רוקחים עולם');
  assert.equal(ui.el('c1').value, '#1a3a5c');
  assert.equal(ui.el('c2').value, '#1a8c6e');
  assert.equal(ui.el('c3').value, '#1a8c6e');
  ui.dom.window.close();
});

test('manual colors remain editable and are not overridden by changing event type', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('c2', '#ab2367', 'input');
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('c2').value, '#ab2367');
  ui.change('course-sel', 'רוקחים עולם');
  assert.equal(ui.el('c2').value, '#ab2367');
  ui.el('reset-btn').click();
  assert.equal(ui.el('c1').value, '#1a3a5c');
  assert.equal(ui.el('c2').value, '#1a8c6e');
  assert.equal(ui.el('c3').value, '#1a8c6e');
  ui.dom.window.close();
});

test('existing breakthrough draft picks up new preset only if its saved colors were unchanged', () => {
  const oldDefault = { c1: '#1a3a5c', c2: '#1a8c6e', c3: '#1a8c6e' };
  const ui = mount({ 'course-sel': 'פורצות דרך', ...oldDefault });
  assert.equal(ui.el('c1').value, '#1f354d');
  assert.equal(ui.el('c2').value, '#a40461');
  assert.equal(ui.el('c3').value, '#5b0143');
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).fields.c2, '#a40461');
  ui.dom.window.close();

  const custom = mount({ 'course-sel': 'פורצות דרך', ...oldDefault, c2: '#aa1166' });
  assert.equal(custom.el('c1').value, '#1a3a5c');
  assert.equal(custom.el('c2').value, '#aa1166');
  assert.equal(custom.el('c3').value, '#1a8c6e');
  custom.dom.window.close();
});


test('background picker shows all 14 repository backgrounds in three rows of five', () => {
  const ui = mount();
  const thumbs = [...ui.el('bg-row').querySelectorAll('.bg-th')];
  assert.equal(thumbs.length, 15, 'white + fourteen repository backgrounds');
  assert.equal(thumbs[0].style.backgroundColor, 'rgb(255, 255, 255)');
  for (let i = 1; i <= 14; i++) {
    assert.ok(thumbs[i].style.backgroundImage.includes(`background-${i}.png`), `Background ${i} is available in numeric order`);
  }
  const styles = document.getElementById('invitation-generator-styles').textContent;
  assert.match(styles, /\.bg-row\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.bg-th\{width:100%;min-width:0;height:auto/);

  thumbs[14].click();
  assert.equal(ui.el('bg-row').querySelectorAll('.bg-th.sel').length, 1);
  assert.equal([...ui.el('bg-row').querySelectorAll('.bg-th')][14].classList.contains('sel'), true);
  assert.ok(ui.el('cbg').style.backgroundImage.includes('background-14.png'));
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).selBg, 14);

  // The previous ninth background still maps to its original index.
  [...ui.el('bg-row').querySelectorAll('.bg-th')][9].click();
  assert.ok(ui.el('cbg').style.backgroundImage.includes('background-9.png'));
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).selBg, 9);
  ui.dom.window.close();
});

test('guest lecturer identity is printable in one line without repeated details', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  assert.equal(ui.el('lec-name').previousElementSibling.textContent, 'שם המרצה');
  assert.equal(ui.el('lec-role').previousElementSibling.textContent, 'תפקיד');
  assert.equal(ui.el('lec-org').previousElementSibling.textContent, 'חברה');
  assert.equal(ui.el('lec-topic'), null);

  ui.change('lec-name', 'ד"ר תמר לוי', 'input');
  ui.change('lec-role', 'מנהלת מחקר', 'input');
  ui.change('lec-org', 'טכנולוגיות ישראל', 'input');

  const expected = 'ד"ר תמר לוי, מנהלת מחקר - טכנולוגיות ישראל';
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity').textContent, expected);
  assert.equal(ui.el('card').querySelectorAll('.c-lecturer-identity').length, 1);
  assert.match(document.getElementById('invitation-generator-styles').textContent, /\.c-lecturer-identity\{[^}]*white-space:nowrap/);

  let printed = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printed = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.ok(printed.includes('הזמנה להרצאת אורחת של:'));
  assert.ok(printed.includes(expected.replaceAll('"', '&quot;')));
  assert.equal((printed.match(/class="c-lecturer-identity"/g) || []).length, 1);
  ui.dom.window.close();
});

test('guest lecture identity handles partially completed fields without dangling separators', () => {
  const ui = mount({ 'ev-type': 'lecture', 'course-sel': 'פורצות דרך' });
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity'), null);
  ui.change('lec-name', 'רחל', 'input');
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity').textContent, 'רחל');
  ui.change('lec-org', 'מעבדה', 'input');
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity').textContent, 'רחל - מעבדה');
  ui.change('lec-role', 'חוקרת', 'input');
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity').textContent, 'רחל, חוקרת - מעבדה');
  ui.change('ev-type', 'end');
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity'), null);
  ui.dom.window.close();
});

test('saved breakthrough drafts replace only the old recommended ending, not custom edits', () => {
  const previousSuggested = "התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד. הזדמנות לחגוג את הדרך שעברו, את הכוחות שגילו בעצמן ואת האומץ לחלום בגדול ולסלול דרך משלהן.";
  const updatedSuggested = "התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד.";

  const oldDraft = mount({
    'course-sel': 'פורצות דרך',
    'ev-type': 'end',
    b2: previousSuggested
  });
  assert.equal(oldDraft.el('b2').value, updatedSuggested);
  assert.equal(oldDraft.el('card').querySelector('.c-section-title').nextElementSibling.textContent, updatedSuggested);
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).fields.b2, updatedSuggested);
  oldDraft.dom.window.close();

  const editedDraft = mount({
    'course-sel': 'פורצות דרך',
    'ev-type': 'end',
    b2: 'נוסח אישי שכתב המשתמש ואין לשנות אותו'
  });
  assert.equal(editedDraft.el('b2').value, 'נוסח אישי שכתב המשתמש ואין לשנות אותו');
  editedDraft.dom.window.close();
});

test('approved breakthrough guest lecture remains word-for-word in A5 print', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  ui.change('lec-name', 'דנה לוי', 'input');
  ui.change('lec-role', 'מנהלת פיתוח', 'input');
  ui.change('lec-org', 'חברה לדוגמה', 'input');
  const expectedOpening = "קורס ״פורצות דרך״ משלב יזמות טכנולוגית והעצמה נשית ומעודד את התלמידות לחלום בגדול, לפתח רעיונות ולהאמין ביכולתן להוביל שינוי. דרך היכרות עם נשים שהעזו לפרוץ גבולות, הן מגלות כיצד אומץ, יצירתיות, נחישות ואמונה עצמית יכולים להפוך שאיפות להישגים משמעותיים ולפתוח דלתות לאפשרויות חדשות.";
  const expectedMeeting = "מפגש מעורר השראה עם אישה פורצת דרך, שתחשוף את הסיפור שמאחורי הצלחתה – החלומות שהעזה להגשים, האתגרים שניצבו בדרכה והרגעים שבהם בחרה לא לוותר. מסע אישי ומרתק אל ההחלטות, התובנות ונקודות המפנה שעיצבו את דרכה והפכו את שאיפותיה למציאות.";
  assert.equal(ui.el('card').querySelector('.c-title').textContent, 'הזמנה להרצאת אורחת של:');
  assert.equal(ui.el('card').querySelector('.c-lecturer-identity').textContent, 'דנה לוי, מנהלת פיתוח - חברה לדוגמה');
  assert.equal(ui.el('card').querySelector('.c-course').textContent, 'במסגרת קורס ״פורצות דרך״');
  assert.equal(ui.el('card').querySelector('.c-year').textContent, 'תשפ״ז');
  assert.equal(ui.el('card').querySelector('.c-opening').textContent, expectedOpening);
  assert.equal(ui.el('card').querySelector('.c-section-title').textContent, 'מה מצפה לנו?');
  assert.equal(ui.el('card').querySelector('.c-section-title').nextElementSibling.textContent, expectedMeeting);
  assert.equal(ui.el('card').querySelector('.c-closing').textContent, 'נשמח לראותכם!');

  let printedHtml = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printedHtml = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.ok(printedHtml.includes(expectedOpening));
  assert.ok(printedHtml.includes(expectedMeeting));
  assert.ok(printedHtml.includes('במסגרת קורס ״פורצות דרך״'));
  assert.ok(printedHtml.includes('הזמנה להרצאת אורחת של:'));
  assert.ok(printedHtml.includes('נשמח לראותכם!'));
  ui.dom.window.close();
});

test('only previous suggested lecture copy is refreshed in existing drafts', () => {
  const oldSuggestion = "מפגש מעצים ומעורר השראה עם אישה פורצת דרך, שתשתף במסעה האישי, בחלומות שהפכה למציאות ובאתגרים שהתגברה עליהם. הזדמנות לתלמידות לגלות את הכוח הטמון בהן, להאמין בעצמן ולקבל השראה לחלום בגדול, לפרוץ גבולות ולהעז להגשים את שאיפותיהן.";
  const approvedSuggestion = "מפגש מעורר השראה עם אישה פורצת דרך, שתחשוף את הסיפור שמאחורי הצלחתה – החלומות שהעזה להגשים, האתגרים שניצבו בדרכה והרגעים שבהם בחרה לא לוותר. מסע אישי ומרתק אל ההחלטות, התובנות ונקודות המפנה שעיצבו את דרכה והפכו את שאיפותיה למציאות.";
  const stale = mount({ 'course-sel':'פורצות דרך', 'ev-type':'lecture', b2:oldSuggestion });
  assert.equal(stale.el('b2').value, approvedSuggestion);
  assert.equal(stale.el('card').querySelector('.c-section-title').nextElementSibling.textContent, approvedSuggestion);
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).fields.b2, approvedSuggestion);
  stale.dom.window.close();

  const edited = mount({ 'course-sel':'פורצות דרך', 'ev-type':'lecture', b2:'נוסח אישי שהוזן ידנית' });
  assert.equal(edited.el('b2').value, 'נוסח אישי שהוזן ידנית');
  edited.dom.window.close();
});


test('breakthrough guest lecture layout expands text and balances A5 spacing without changing copy', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  ui.change('lec-name', 'דנה לוי', 'input');
  ui.change('lec-role', 'מנהלת חדשנות', 'input');
  ui.change('lec-org', 'חברת טכנולוגיה', 'input');
  ui.change('ev-date', '2026-12-06', 'change');
  ui.change('ev-time', '10:00', 'change');
  ui.change('ev-loc', 'בית הספר', 'input');

  const card = ui.el('card');
  const css = document.getElementById('invitation-generator-styles').textContent;
  assert.equal(card.classList.contains('layout-breakthrough-lecture'), true);
  assert.match(css, /\.preview #card\.layout-breakthrough-lecture\{zoom:\.60\}/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-opening\{width:84%;padding-inline:2mm;text-align:center;font-size:4\.3mm;line-height:1\.4/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-details-box\{width:82%;padding:2\.1mm 3mm/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-title\.guest-lecture\{font-size:8\.7mm;margin-bottom:2\.1mm/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-participants-box\{width:69%;padding:2mm 5\.2mm/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-footer-sentence\{font-size:2\.35mm/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-details-box,#card\.layout-breakthrough-lecture \.c-section-title/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-main\{padding:2mm 6\.5mm 16mm\}/);
  assert.match(css, /#card\.layout-breakthrough-lecture\.fit-a5-tight \.c-main\{padding:1mm 5\.5mm 13mm\}/);
  assert.equal(card.querySelectorAll('.c-logos > .c-logo-item').length, 2);
  assert.equal(card.querySelector('.c-lecturer-identity').textContent, 'דנה לוי, מנהלת חדשנות - חברת טכנולוגיה');
  assert.match(card.querySelector('.c-lecturer-identity').getAttribute('style'), /font-size:5\.2mm/);
  assert.match(card.querySelector('.c-details-box').textContent, /10:00/);
  const detailRows = [...card.querySelectorAll('.c-details-top .c-info-row')];
  assert.equal(detailRows.length, 2, 'day and date combined, then time');
  assert.equal(detailRows[0].textContent, '📅 יום ראשון·06.12.2026');
  assert.equal(detailRows[1].textContent, 'שעה 10:00');
  assert.doesNotMatch(card.querySelector('.c-details-box').textContent, /⏰|🗓️/);
  assert.match(card.querySelector('.c-details-box').textContent, /בית הספר/);
  assert.equal(card.querySelector('.c-closing').textContent, 'נשמח לראותכם!');

  const opening = card.querySelector('.c-opening').textContent;
  const conclusion = card.querySelector('.c-section-title').nextElementSibling.textContent;
  let printedHtml = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printedHtml = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.match(printedHtml, /id="card" class="layout-breakthrough-lecture"/);
  assert.ok(printedHtml.includes(opening));
  assert.ok(printedHtml.includes(conclusion));
  assert.ok(printedHtml.includes('נשמח לראותכם!'));
  assert.doesNotMatch(printedHtml, /לוגו בית הספר|לוגו חברת המרצה/);
  assert.ok(printedHtml.includes('📅'));
  assert.ok(printedHtml.includes('שעה '));
  assert.match(printedHtml, /#card\.layout-breakthrough-lecture \.c-opening/);

  ui.change('ev-type', 'end');
  assert.equal(card.classList.contains('layout-breakthrough-lecture'), false);
  assert.equal(card.querySelectorAll('.c-logos > .c-logo-item').length, 2);
  let endPrint = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { endPrint = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.doesNotMatch(endPrint, /id="card" class="layout-breakthrough-lecture"/);

  ui.change('course-sel', 'רוקחים עולם');
  ui.change('ev-type', 'lecture');
  assert.equal(card.classList.contains('layout-breakthrough-lecture'), false);
  ui.dom.window.close();
});

test('guest lecture opening matches approved punctuation and remains centered in preview and print', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  const approvedOpening = "קורס ״פורצות דרך״ משלב יזמות טכנולוגית והעצמה נשית ומעודד את התלמידות לחלום בגדול, לפתח רעיונות ולהאמין ביכולתן להוביל שינוי. דרך היכרות עם נשים שהעזו לפרוץ גבולות, הן מגלות כיצד אומץ, יצירתיות, נחישות ואמונה עצמית יכולים להפוך שאיפות להישגים משמעותיים ולפתוח דלתות לאפשרויות חדשות.";
  assert.equal(ui.el('card').querySelector('.c-opening').textContent, approvedOpening);
  assert.doesNotMatch(ui.el('card').querySelector('.c-opening').textContent, /נשית, ומעודד/);
  const styles = document.getElementById('invitation-generator-styles').textContent;
  assert.match(styles, /#card\.layout-breakthrough-lecture \.c-opening\{[^}]*text-align:center/);

  let printed = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printed = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.ok(printed.includes(approvedOpening));
  assert.ok(printed.includes('text-align:center;font-size:4.3mm'));
  assert.doesNotMatch(printed, /נשית, ומעודד/);

  ui.change('ev-type', 'end');
  assert.equal(ui.el('card').classList.contains('layout-breakthrough-lecture'), false);
  ui.dom.window.close();
});

test('A5 breakthrough print keeps the footer slogan and closing on one line', () => {
  const ui = mount();
  ui.change('course-sel', 'פורצות דרך');
  ui.change('ev-type', 'lecture');
  const card = ui.el('card');
  const footer = card.querySelector('.c-footer');
  const sentence = footer.querySelector('.c-footer-sentence');
  assert.ok(sentence);
  assert.equal(sentence.querySelectorAll('span').length, 6);
  assert.equal(card.querySelector('.c-closing').textContent, 'נשמח לראותכם!');

  const css = document.getElementById('invitation-generator-styles').textContent;
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-footer\{[^}]*width:max-content;max-width:94%/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-footer-sentence\{[^}]*flex-wrap:nowrap;white-space:nowrap/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-footer-sentence span\{white-space:nowrap;flex-shrink:0\}/);
  assert.match(css, /#card\.layout-breakthrough-lecture \.c-closing\{white-space:nowrap\}/);

  let printed = '';
  ui.dom.window.open = () => ({ document: {
    write(html) { printed = html; }, close() {}, set title(_) {}
  }});
  ui.el('print-btn').click();
  assert.ok(printed.includes('flex-wrap:nowrap;white-space:nowrap'));
  assert.ok(printed.includes('width:max-content;max-width:94%'));
  assert.ok(printed.includes('נשמח לראותכם!'));
  ui.dom.window.close();
});

test('new guest lecture paragraph replaces the previous approved default but preserves manual drafts', () => {
  const previousDefault = "מפגש מעצים ומעורר השראה עם אישה פורצת דרך, שתשתף במסעה האישי, בחלומות שהפכה למציאות ובאתגרים שהתגברה עליהם בדרך ותספר על ההחלטות, התובנות והרגעים המשמעותיים שעיצבו את דרכה.";
  const newDefault = "מפגש מעורר השראה עם אישה פורצת דרך, שתחשוף את הסיפור שמאחורי הצלחתה – החלומות שהעזה להגשים, האתגרים שניצבו בדרכה והרגעים שבהם בחרה לא לוותר. מסע אישי ומרתק אל ההחלטות, התובנות ונקודות המפנה שעיצבו את דרכה והפכו את שאיפותיה למציאות.";

  const saved = mount({
    'course-sel': 'פורצות דרך',
    'ev-type': 'lecture',
    b2: previousDefault
  });
  assert.equal(saved.el('b2').value, newDefault);
  assert.equal(saved.el('card').querySelector('.c-section-title').nextElementSibling.textContent, newDefault);
  assert.equal(JSON.parse(localStorage.getItem('taasiyeda_invitation_builder_state_v4')).fields.b2, newDefault);

  let printed = '';
  saved.dom.window.open = () => ({ document: {
    write(html) { printed = html; }, close() {}, set title(_) {}
  }});
  saved.el('print-btn').click();
  assert.ok(printed.includes(newDefault));
  assert.equal(printed.includes(previousDefault), false);
  saved.dom.window.close();

  const customized = mount({
    'course-sel': 'פורצות דרך',
    'ev-type': 'lecture',
    b2: 'נוסח אישי שלא משנים'
  });
  assert.equal(customized.el('b2').value, 'נוסח אישי שלא משנים');
  customized.dom.window.close();
});
