import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const OVERLAY_FILE = new URL('../frontend/src/client-file-overlay.js', import.meta.url);
const ADAPTER_FILE = new URL('../frontend/src/client-file-data-adapter.js', import.meta.url);

test('client file workspace is loaded after the existing application shell', async () => {
  const index = await readFile(INDEX_FILE, 'utf8');
  const mainPos = index.indexOf('frontend/src/main.js');
  const adapterPos = index.indexOf('frontend/src/client-file-data-adapter.js');
  const overlayPos = index.indexOf('frontend/src/client-file-overlay.js');
  assert.ok(mainPos >= 0, 'main application script should remain loaded');
  assert.ok(adapterPos > mainPos, 'client data adapter should load after main');
  assert.ok(overlayPos > adapterPos, 'unified workspace should load after its data adapter');
});

test('unified workspace contains the approved home board and client file structure', async () => {
  const source = await readFile(OVERLAY_FILE, 'utf8');
  for (const label of ['טיוטות', 'ממתינות לאישור', 'הוחזרו לתיקון', 'מאושרות וממתינות לשליחה']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /placeholder="חיפוש לפי רשות, בית ספר, סמל מוסד, איש קשר, נייד או דוא״ל"/);
  assert.match(source, /\+ לקוח אחר/);
  assert.match(source, /\+ הצעת מחיר/);
  assert.match(source, /\+ איש קשר/);
  assert.match(source, /אנשי קשר/);
  assert.match(source, /הצעות עדכניות/);
  assert.match(source, /ארכיון הצעות מחיר/);
});

test('existing proposal editor remains the action engine inside the unified workspace', async () => {
  const source = await readFile(OVERLAY_FILE, 'utf8');
  assert.match(source, /data-pa-tab=\\?"new/);
  assert.match(source, /status === 'sent' \? 'sent' : 'records'/);
  assert.match(source, /data-pa-search/);
  assert.match(source, /data-pa-form/);
  assert.match(source, /חזרה לתיק הלקוח/);
});

test('contacts are edited in place through contacts_schools and contacts nav is removed', async () => {
  const source = await readFile(OVERLAY_FILE, 'utf8');
  assert.match(source, /from\('contacts_schools'\)\.update/);
  assert.match(source, /from\('contacts_schools'\)\.insert/);
  assert.match(source, /data-route="contacts"/);
  assert.match(source, /data-cf-contact-modal/);
});

test('proposal loader contactOptions are normalized for the client file', async () => {
  const source = await readFile(ADAPTER_FILE, 'utf8');
  assert.match(source, /data\?\.contactOptions/);
  assert.match(source, /_catalog_source/);
  assert.match(source, /catalogAuthorities/);
  assert.match(source, /catalogSchools/);
  assert.match(source, /contactsSchools/);
});
