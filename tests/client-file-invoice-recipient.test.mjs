import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientFileWithInvoiceRecipient, clientInvoiceRecipientRole } from '../frontend/src/client-file-invoice-recipient.js';

const file={
  school_id:1860,key:'school:1860',
  contacts:[{
    id:1149,source_id:1149,source_table:'contacts_schools',
    contact_name:'אחמד אבו מדיעם',contact_role:'מנהל/ת בית הספר',
    email:'ahmed51@walla.co.il',_clientContactKey:'אחמד אבו מדיעם'
  }]
};
const recipient={
  school_id:1860,contact_id:1149,
  recipient_name:'אחמד אבו מדיעם',recipient_email:'ahmed51@walla.co.il'
};
test('existing principal is shown as client invoice administrator without replacing job title or duplicating contact',()=>{
  const result=clientFileWithInvoiceRecipient(file,recipient);
  assert.equal(result.contacts.length,1);
  assert.equal(result.contacts[0].contact_role,'מנהל/ת בית הספר');
  assert.equal(result.contacts[0].invoice_recipient,true);
  assert.match(clientInvoiceRecipientRole(result.contacts[0].contact_role,true),/מנהל\/ת בית הספר.*מנהלן\/ית/);
  assert.equal(file.contacts[0].invoice_recipient,undefined,'original objects remain unchanged');
});
test('missing contact is shown once in the client file, not permanently inserted',()=>{
  const result=clientFileWithInvoiceRecipient({...file,contacts:[]},{
    ...recipient,contact_id:null,recipient_email:'billing@example.test',recipient_mobile:'050-1234567'
  });
  assert.equal(result.contacts.length,1);
  assert.equal(result.contacts[0].invoice_recipient_virtual,true);
  assert.equal(result.contacts[0].contact_role,'מנהלן/ית');
  assert.equal(result.contacts[0].email,'billing@example.test');
  assert.equal(file.contacts.length,1,'original stored records untouched');
});
test('different invoice recipient email is carried separately without overwriting principal email',()=>{
  const result=clientFileWithInvoiceRecipient(file,{...recipient,recipient_email:'billing@example.test'});
  assert.equal(result.contacts[0].email,'ahmed51@walla.co.il');
  assert.equal(result.contacts[0].invoice_recipient_email,'billing@example.test');
});
test('unrelated school recipient is never visible',()=>{
  assert.equal(clientFileWithInvoiceRecipient(file,{...recipient,school_id:999}),file);
});
test('existing name match avoids duplicate card if contact source id is unavailable',()=>{
  const result=clientFileWithInvoiceRecipient({...file, contacts:[{...file.contacts[0],source_id:null,source_table:'proposal_row'}]},recipient);
  assert.equal(result.contacts.length,1);
});
test('client file opens role with on-demand authorized school lookup and protects virtual contacts from edit/delete',()=>{
  const src=readFileSync(new URL('../frontend/src/screens/proposals-agreements.js',import.meta.url),'utf8');
  assert.match(src,/\.from\('finance_school_invoice_recipients'\)/);
  assert.match(src,/await loadClientInvoiceRecipient\(selectedFile\)/);
  assert.match(src,/clientFileWithInvoiceRecipient\(file, billingRecipient\)/);
  assert.match(src,/clientInvoiceRecipientRole\(contact.contact_role, contact.invoice_recipient\)/);
  assert.match(src,/canManage && !contact\.invoice_recipient_virtual/);
  assert.match(src,/דוא״ל לחשבון עסקה:/);
  const sql=readFileSync(new URL('../supabase/migrations/20261030171000_invoice_recipients_visible_in_client_file.sql',import.meta.url),'utf8');
  assert.match(sql,/app_has_permission\('view_proposals_agreements'\)/);
  assert.doesNotMatch(sql,/\bgrant\s+update\b|\bgrant\s+insert\b/i);
});
