import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const CATALOG_JS = new URL('../frontend/src/screens/catalog.js', import.meta.url);
const API_JS = new URL('../frontend/src/api.js', import.meta.url);

function setupBrowserGlobals() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.localStorage = dom.window.localStorage;
  return dom;
}

async function loadCatalogScreen() {
  setupBrowserGlobals();
  const mod = await import('../frontend/src/screens/catalog.js');
  return mod.catalogScreen;
}

test('catalog screen embeds the current summer catalog', async () => {
  const catalogScreen = await loadCatalogScreen();
  const html = catalogScreen.render({}, { state: { user: { role: 'authorized_user' } } });

  assert.match(html, /<h2 id="catalog-embed-title">קטלוג<\/h2>/);
  assert.match(html, /src="\.\/catalog\/summercatalog\/"/);
  assert.match(html, /פתח בחלון חדש/);
  assert.doesNotMatch(html, /catalog-admin-open-btn/);
});

test('catalog admin action is permission-driven', async () => {
  const src = await readFile(CATALOG_JS, 'utf8');
  assert.match(src, /import \{ hasPermission \} from '\.\.\/permission-policy\.js'/);
  assert.match(src, /hasPermission\(state\?\.user, 'manage_catalog'\)/);

  const catalogScreen = await loadCatalogScreen();
  const html = catalogScreen.render({}, {
    state: {
      user: {
        role: 'authorized_user',
        permissions: {
          view_operations_management: 'yes',
          view_catalog: 'yes',
          manage_catalog: 'yes'
        }
      }
    }
  });
  assert.match(html, /catalog-admin-open-btn/);
  assert.match(html, /הפקת קטלוג אדמין/);
});

test('catalog API mapping selects activity_no, audience_level and maps קורס to תוכנית', async () => {
  const src = await readFile(API_JS, 'utf8');
  assert.match(src, /activity_no,gefen_number,catalog_title/);
  assert.match(src, /audience_level,catalog_section/);
  assert.match(src, /catalogGroupToProductType\('programs'/);
  assert.match(src, /itemType === 'קורס'/);
});

test('catalog embed keeps the admin marketer choices and iframe contract', async () => {
  const catalogScreen = await loadCatalogScreen();
  const html = catalogScreen.render({}, { state: { user: { role: 'admin' } } });

  assert.match(html, /id="catalog-admin-marketer-select"/);
  assert.match(html, /value="yael">יעל אביב/);
  assert.match(html, /value="israa">איסראא אבו-ראס/);
  assert.match(html, /class="catalog-embed-frame"/);
  assert.match(html, /title="קטלוג תעשיידע לקיץ"/);
});