import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const INSTRUCTORS_FILE = new URL('../frontend/src/screens/instructors.js', import.meta.url);
const CONTACTS_FILE = new URL('../frontend/src/screens/instructor-contacts.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);

test('instructors screen exposes instructor-contacts without returning it to sidebar/header', async () => {
  const instructors = await readFile(INSTRUCTORS_FILE, 'utf8');
  const main = await readFile(MAIN_FILE, 'utf8');
  assert.match(instructors, /data-route="instructor-contacts"/);
  assert.match(instructors, /app:navigate[\s\S]*instructor-contacts/);
  const headerExclude = main.match(/HEADER_ALWAYS_EXCLUDE[\s\S]*?;/)?.[0] || '';
  assert.match(headerExclude, /'instructor-contacts'/);
  const activitiesChildren = main.match(/ACTIVITIES_CHILD_ROUTES[\s\S]*?;/)?.[0] || '';
  assert.match(activitiesChildren, /'instructor-contacts'/);
});

test('clicking instructor-contacts and back navigates via app:navigate', async () => {
  const instructorsSource = await readFile(INSTRUCTORS_FILE, 'utf8');
  const contactsSource = await readFile(CONTACTS_FILE, 'utf8');

  const dom = new JSDOM(
    '<!doctype html><html><body>'
    + '<button type="button" class="instr-contacts-link" data-route="instructor-contacts">אנשי קשר מדריכים</button>'
    + '<button type="button" data-route="instructors">← חזרה למדריכים</button>'
    + '</body></html>',
    { url: 'http://localhost/' }
  );
  const { document, CustomEvent } = dom.window;
  const navigations = [];
  document.addEventListener('app:navigate', (event) => {
    navigations.push(event.detail?.route);
  });

  document.querySelector('.instr-contacts-link,[data-route="instructor-contacts"]')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-contacts' } }));
  });
  document.querySelector('[data-route="instructors"]')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructors' } }));
  });

  document.querySelector('[data-route="instructor-contacts"]').click();
  document.querySelector('[data-route="instructors"]').click();

  assert.deepEqual(navigations, ['instructor-contacts', 'instructors']);
  assert.match(instructorsSource, /אנשי קשר מדריכים/);
  assert.match(contactsSource, /data-route="instructors"/);
  assert.match(contactsSource, /חזרה/);
});
