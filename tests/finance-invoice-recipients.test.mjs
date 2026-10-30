
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyResolvedActivityContact } from '../frontend/src/finance-transaction-page-data-hotfix.js';

const activity={school_id:11,school_contact_id:7,contact_email:'stale@example.test'};
const contacts=[
  {id:7,school_id:11,contact_name:'רכזת הפעילות',contact_role:'רכזת',email:'teacher@example.test',active:'פעיל'},
  {id:8,school_id:11,contact_name:'מנהל בית הספר',contact_role:'מנהל/ת בית ספר',email:'principal@example.test',active:'פעיל'}
];
const mapping=[{school_id:11,recipient_name:'מנהל בית הספר',recipient_email:'billing@example.test',contact_id:8}];

test('file-designated principal is an invoice recipient independent of official title',()=>{
  const result=applyResolvedActivityContact(activity,contacts,mapping);
  assert.equal(result.contact_email,'teacher@example.test');
  assert.equal(result.resolved_contact_name,'רכזת הפעילות');
  assert.equal(result.finance_administrator_email,'billing@example.test');
  assert.equal(result.finance_administrator_name,'מנהל בית הספר');
  assert.equal(result.finance_administrator_id,8);
  assert.equal(result.finance_administrator_ambiguous,false);
});
test('spreadsheet billing email takes precedence over the stored contact email without overwriting either',()=>{
  const result=applyResolvedActivityContact(activity,contacts,mapping);
  assert.equal(result.finance_administrator_email,'billing@example.test');
  assert.equal(contacts[1].email,'principal@example.test');
});
test('unlisted principal is never inferred as invoice recipient',()=>{
  const result=applyResolvedActivityContact(activity,contacts,[]);
  assert.equal(result.finance_administrator_email,'');
});
test('unambiguous legacy administrator is a safe fallback where the uploaded list has no mapping',()=>{
  const result=applyResolvedActivityContact(activity,[...contacts,
    {id:9,school_id:11,contact_name:'מנהלנית',contact_role:'מנהלנית',email:'legacy@example.test',active:'פעיל'}],[]);
  assert.equal(result.finance_administrator_email,'legacy@example.test');
});
test('multiple role-labelled administrators are ambiguous without an explicit mapping',()=>{
  const result=applyResolvedActivityContact(activity,[...contacts,
    {id:9,school_id:11,contact_role:'מנהלנית',email:'legacy@example.test',active:'פעיל'},
    {id:10,school_id:11,contact_role:'מנהלנית',email:'second@example.test',active:'פעיל'}],[]);
  assert.equal(result.finance_administrator_email,'');
  assert.equal(result.finance_administrator_ambiguous,true);
});
test('finance loader passes the designated recipient and selected activity contact to new invoice',()=>{
  const source=readFileSync(new URL('../frontend/src/screens/finance.js',import.meta.url),'utf8');
  assert.match(source,/activity\.resolved_contact_email \|\| activity\.contact_email/);
  assert.match(source,/activity\.finance_administrator_email/);
  assert.match(source,/customerEmail:[\s\S]{0,220}recipientList\(/);
  const contactSource=readFileSync(new URL('../frontend/src/finance-transaction-page-data-hotfix.js',import.meta.url),'utf8');
  assert.match(contactSource,/from\('finance_school_invoice_recipients'\)/);
});
