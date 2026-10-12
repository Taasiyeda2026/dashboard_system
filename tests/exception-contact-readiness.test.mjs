import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildContactReadinessAudit,selectedContactIssue,CONTACT_READINESS_ISSUES} from '../frontend/src/screens/exception-contact-audit.js';

const base={
 row_id:'ACT-1',activity_season:'school_2027',status:'פתוח',activity_type:'course',
 activity_name:'פורצות דרך',authority:'ראשון לציון',school:'בית ספר אלון',
 school_id:123,school_contact_id:10
};
const selected={id:10,school_id:123,contact_name:'איש קשר נבחר',email:'selected@school.org.il',active:'פעיל'};

test('only the explicitly selected school contact is eligible; never infer from another contact or legacy activity email',()=>{
  assert.equal(selectedContactIssue({...base,school_contact_id:null,contact_email:'fallback@school.org.il'},selected),'unlinked_contact_details');
  assert.equal(selectedContactIssue(base,{...selected,id:11, email:''}),'broken_selection');
  const audit=buildContactReadinessAudit([base],[
    {...selected,id:11,email:'other@school.org.il'},
    {...selected,id:10,email:''}
  ]);
  assert.equal(audit.problems,1);
  assert.equal(audit.rows[0].issue,'missing_email');
  assert.equal(audit.rows[0].contact_email,'');
  assert.equal(audit.rows[0].contact_name,'איש קשר נבחר');
});

test('real record status, school-year and category gates are explicit',()=>{
 const activities=[
  base,{...base,row_id:'ACT-2',status:'סגור',school_contact_id:null},
  {...base,row_id:'ACT-3',activity_season:'regular',school_contact_id:null},
  {...base,row_id:'ACT-4',activity_type:'workshop',school_contact_id:null},
  {...base,row_id:'ACT-5',activity_type:'tour',school_contact_id:null}
 ];
 const audit=buildContactReadinessAudit(activities,[selected]);
 assert.equal(audit.total,2);
 assert.equal(audit.problems,1);
 assert.equal(audit.ready,1);
 assert.equal(audit.rows[0].row_id,'ACT-5');
});

test('audit classifies selected email, invalid formatting, mismatched school and inactive contact as separate issues',()=>{
 const activities=Array.from({length:6},(_,i)=>({...base,row_id:'ACT-'+i,school_contact_id:100+i}));
 const contacts=[
  {id:100,school_id:123,active:'פעיל',email:'ok@example.org'},
  {id:101,school_id:123,active:'פעיל',email:''},
  {id:102,school_id:123,active:'פעיל',email:'\u200f\u202aabc@example.org\u202c'},
  {id:103,school_id:999,active:'פעיל',email:'other@example.org'},
  {id:104,school_id:123,active:'לא פעיל',email:'disabled@example.org'}
 ];
 const audit=buildContactReadinessAudit(activities,contacts);
 assert.equal(audit.total,6);
 assert.equal(audit.problems,5);
 assert.equal(audit.ready,1);
 assert.deepEqual(audit.byIssue,{
  missing_selection:0,unlinked_contact_details:0,broken_selection:1,missing_email:1,invalid_email:1,wrong_school:1,inactive_contact:1
 });
 assert.equal(Object.keys(CONTACT_READINESS_ISSUES).length,7);
});


test('legacy activity name/email is visually explained but NOT considered a selected recipient',()=>{
 const row={...base,school_contact_id:null,contact_name:'מורה קיים',contact_email:'teacher@school.org.il'};
 const result=buildContactReadinessAudit([row],[]);
 assert.equal(result.total,1);
 assert.equal(result.ready,0);
 assert.equal(result.problems,1);
 assert.equal(result.rows[0].issue,'unlinked_contact_details');
 assert.equal(result.rows[0].contact_source,'activity_unlinked');
 assert.equal(result.rows[0].contact_email,'teacher@school.org.il');
 assert.equal(buildContactReadinessAudit([{...base,school_contact_id:null}],[]).rows[0].issue,'missing_selection');
});

test('persisted contact with email is excluded, including a duplicate school ID for same named school',()=>{
 const a={...base,authority:'יבנה',school:'ביאליק',school_id:2561,school_contact_id:1046};
 const c={id:1046,contact_name:'ענת מיימון',email:'Anatmamon@gmail.com',
   authority:'יבנה',school:'ביאליק',school_id:2537,active:'פעיל'};
 const result=buildContactReadinessAudit([a],[c]);
 assert.equal(result.total,1);
 assert.equal(result.ready,1);
 assert.equal(result.problems,0);
 assert.equal(selectedContactIssue({...a,school:'בית ספר אחר'},c),'wrong_school');
});

test('exceptions screen keeps district view intact and loads contact view independently from Supabase',()=>{
 const screen=readFileSync(new URL('../frontend/src/screens/exceptions.js',import.meta.url),'utf8');
 const audit=readFileSync(new URL('../frontend/src/screens/exception-contact-audit.js',import.meta.url),'utf8');
 assert.match(screen,/EXCEPTIONS_INNER_DISTRICTS, 'מחוזות'/);
 assert.match(screen,/EXCEPTIONS_INNER_CONTACTS, 'פרטי אנשי קשר'/);
 assert.match(screen,/data-exception-inner-tab/);
 assert.match(screen,/exceptionContactsHtml\(state\?\.exceptionsContactAudit, state\)/);
 assert.match(screen,/loadContactReadinessAudit\(\)/);
 assert.match(screen,/state\.activitiesInnerTab='year_all'/);
 assert.match(screen,/state\.listFilters\.activities=\{q:rowId,visibleCount:200\}/);
 assert.match(audit,/\.eq\('activity_season','school_2027'\)\.eq\('status','פתוח'\)/);
 assert.match(audit,/\.in\('activity_type',\['course','tour'\]\)/);
 assert.match(audit,/\.from\('contacts_schools'\)/);
 assert.match(audit,/contact_name,contact_email/);
 assert.match(screen,/מופיע בפעילות, לא משויך/);
 assert.match(screen,/data-exception-contact-reset/);
 assert.match(screen,/ds-contact-audit__toolbar/);
 assert.match(screen,/ds-exceptions-grid/);
 assert.match(screen,/ds-exception-card--contact/);
 assert.match(screen,/ds-exception-group__title/);
 assert.match(screen,/exceptionContactsToolbarHtml\(state\?\.exceptionsContactAudit, state\)/);
 assert.match(screen,/data-exception-contact-district-chip/);
 assert.match(screen,/data-exception-contact-group/);
 assert.doesNotMatch(screen,/ds-contact-audit__table/);
 assert.doesNotMatch(screen,/מוצגים רק קורסים וסיורים פתוחים/);
 assert.doesNotMatch(screen,/כתובת המייל חייבת להשתייך/);
 assert.match(audit,/new Set\(activities\.map\(a=>a\.school_contact_id\)/);
 assert.doesNotMatch(audit,/\|\|\s*activity\.contact_email/);
});


test('same card-grid, compact KPI and filter position in both exceptions tabs',()=>{
 const src=readFileSync(new URL('../frontend/src/screens/exceptions.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../frontend/src/screens/exception-contact-audit.css',import.meta.url),'utf8');
 assert.match(src,/function exceptionsSummaryHtml\(rows = \[\]\)/);
 assert.match(src,/function exceptionContactsHtml\(audit, state = \{\}\)/);
 assert.match(src,/function exceptionContactsToolbarHtml\(audit, state = \{\}\)/);
 const general=src.slice(src.indexOf('function exceptionGroupCard('),src.indexOf('function exceptionsSummaryHtml('));
 const contact=src.slice(src.indexOf('function exceptionContactsHtml('),src.indexOf('function activityDrawerContent('));
 for (const cls of ['ds-exception-group','ds-exceptions-grid','ds-exception-list-item',
   'ds-interactive-card--session','ds-exception-card','ds-exception-card__activity',
   'ds-exception-card__school','ds-exception-card__authority']) {
   assert.ok(general.includes(cls), 'district has '+cls);
   assert.ok(contact.includes(cls), 'contacts has '+cls);
 }
 for(const cls of ['ds-exceptions-summary','ds-exceptions-summary__card','ds-exceptions-summary__districts','ds-exception-district-chip']) {
   assert.ok(src.includes(cls));
   assert.ok(contact.includes(cls));
 }
 assert.match(css,/\.ds-exceptions-screen \.ds-exceptions-summary\s*\{/);
 assert.match(css,/width: max-content/);
 assert.match(css,/max-width: 100%/);
 assert.match(css,/max-width: 230px/);
 assert.match(css,/\.ds-exceptions-screen \.ds-contact-audit__toolbar/);
 assert.doesNotMatch(contact,/\<table/);
 assert.doesNotMatch(src,/מוצגים רק קורסים וסיורים פתוחים/);
});


test('same small חריגות labels and compact reset icon beside filters in both tabs',()=>{
  const src=readFileSync(new URL('../frontend/src/screens/exceptions.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../frontend/src/screens/exception-contact-audit.css',import.meta.url),'utf8');
  const reset=src.slice(src.indexOf('function exceptionClearFilterButton('),src.indexOf('function exceptionsSummaryHtml('));
  const general=src.slice(src.indexOf('function exceptionsSummaryHtml('),src.indexOf('function exceptionInnerTabsHtml('));
  const contacts=src.slice(src.indexOf('function exceptionContactsHtml('),src.indexOf('function activityDrawerContent('));
  const toolbar=src.slice(src.indexOf('function exceptionContactsToolbarHtml('),src.indexOf('function exceptionContactsHtml('));
  assert.match(general,/<span>חריגות<\\/span>/);
  assert.match(contacts,/<span>חריגות<\\/span>/);
  assert.doesNotMatch(general,/פעילויות עם חריגות/);
  assert.doesNotMatch(contacts,/פעילויות עם חריגות קשר/);
  assert.match(reset,/data-filter-clear="exceptions"/);
  assert.match(reset,/data-exception-contact-reset/);
  assert.match(reset,/aria-label="ניקוי סינון"/);
  assert.match(reset,/<svg/);
  assert.match(toolbar,/exceptionClearFilterButton\\('contacts'\\)/);
  assert.match(src,/exceptionClearFilterButton\\('general'\\)/);
  assert.match(css,/min-height: 46px/);
  assert.match(css,/\\.ds-exception-clear-icon\\s*\\{/);
  assert.match(css,/width: 29px/);
  assert.match(src,/state\\.exceptionsContactDistrict='';/);
  assert.match(src,/state\\.exceptionsContactIssue='';/);
  assert.match(src,/state\\.exceptionsContactSearch='';/);
});
