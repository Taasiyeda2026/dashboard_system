import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INSTRUCTORS_FILE = new URL('../frontend/src/screens/instructors.js', import.meta.url);
const CONTACTS_FILE = new URL('../frontend/src/screens/instructor-contacts.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);

test('instructors screen exposes instructor-contacts without returning it to sidebar/header', async () => {
  const instructors = await readFile(INSTRUCTORS_FILE, 'utf8');
  const contacts = await readFile(CONTACTS_FILE, 'utf8');
  const main = await readFile(MAIN_FILE, 'utf8');

  assert.match(instructors, /אנשי קשר מדריכים/);
  assert.match(instructors, /data-route="instructor-contacts"/);
  assert.match(contacts, /data-route="instructors"/);
  assert.match(contacts, /חזרה למדריכים/);

  const headerExclude = main.match(/const HEADER_ALWAYS_EXCLUDE = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
  assert.match(headerExclude, /'instructor-contacts'/);

  const activitiesChildren = main.match(/const ACTIVITIES_CHILD_ROUTES = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
  assert.match(activitiesChildren, /'instructor-contacts'/);
});
