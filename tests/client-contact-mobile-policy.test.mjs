import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const HOTFIX_FILE = new URL('../frontend/src/client-contact-persistence-hotfix.js', import.meta.url);
const ENTRY_FILE = new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url);

test('client contact mobile policy is loaded by the application entrypoint', async () => {
  const entry = await readFile(ENTRY_FILE, 'utf8');
  assert.match(entry, /client-contact-persistence-hotfix\.js/);
});

test('client contact channels keep mobile and phone separate', async () => {
  const source = await readFile(HOTFIX_FILE, 'utf8');
  assert.match(source, /appendChannel\(host, 'נייד', mobile, 'tel'\)/);
  assert.match(source, /appendChannel\(host, 'טלפון', phone, 'tel'\)/);
  assert.match(source, /חסר מספר נייד/);
  assert.doesNotMatch(source, /const mobile = fields\.mobile \|\| fields\.phone/);
});

test('client contacts require a valid Israeli mobile number', async () => {
  const source = await readFile(HOTFIX_FILE, 'utf8');
  assert.match(source, /mobileInput\.required = true/);
  assert.match(source, /\^05\[0-9\]\{8\}\$/);
  assert.match(source, /\^9725\[0-9\]\{8\}\$/);
  assert.match(source, /יש להזין מספר נייד ישראלי תקין/);
});

test('proposal approval is blocked when the contact has no valid mobile', async () => {
  const source = await readFile(HOTFIX_FILE, 'utf8');
  assert.match(source, /APPROVAL_ACTION_SELECTOR/);
  assert.match(source, /pending_approval/);
  assert.match(source, /לפני שליחה לאישור יש לבחור איש קשר עם מספר נייד ישראלי תקין/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test('existing contacts persist phone and mobile to separate database fields', async () => {
  const source = await readFile(HOTFIX_FILE, 'utf8');
  assert.match(source, /p_phone: fields\.phone \|\| null/);
  assert.match(source, /p_mobile: fields\.mobile \|\| null/);
  assert.match(source, /samePhoneNumber\(fields\.mobile, fields\.phone\)/);
});
