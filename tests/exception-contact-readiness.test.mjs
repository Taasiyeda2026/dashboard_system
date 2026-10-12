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
  assert.equal(selectedContactIssue({...base,school_contact_id:null,contact_email:'fallback@school.org.il'},selected),'missing_selection');
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
  missing_selection:0,broken_selection:1,missing_email:1,invalid_email:1,wrong_school:1,inactive_contact:1
 });
 assert.equal(Object.keys(CONTACT_READINESS_ISSUES).length,6);
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
 assert.match(audit,/new Set\(activities\.map\(a=>a\.school_contact_id\)/);
 assert.doesNotMatch(audit,/\|\|\s*activity\.contact_email/);
});
