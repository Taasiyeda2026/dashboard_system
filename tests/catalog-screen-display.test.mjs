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

function mockCatalogProgram(overrides = {}) {
  return {
    id: '67867',
    name: 'מנהיגות ירוקה',
    catalogTitle: 'מנהיגות ירוקה',
    catalogCardTitle: 'מנהיגות ירוקה',
    audienceLevel: 'יסודי',
    productType: 'קורס',
    targetGrades: 'ד׳–ו׳',
    domain: 'קיימות',
    scope: '10 מפגשים',
    sessionDuration: '90 דקות',
    syllabus: [{ meeting_label: '1', title: 'מפגש ראשון', description: 'היכרות' }],
    ...overrides
  };
}

async function readCatalogSource() {
  return readFile(CATALOG_JS, 'utf8');
}

test('catalog card titles prefer short display-only names', async () => {
  const src = await readCatalogSource();

  assert.match(src, /function catalogCardTitleFromFields\(p, fullName\)/);
  assert.match(src, /p\?\.catalog_short_title/);
  assert.match(src, /p\?\.short_name/);
  assert.match(src, /\['טכנולוגיות חלל', 'טכנולוגיות החלל'\]/);
  assert.match(src, /\['סודות ויסודות הבינה המלאכותית', 'בינה מלאכותית'\]/);
  assert.match(src, /program\.catalogSubtitle/);
  assert.match(src, /<h3>\$\{escapeHtml\(program\.catalogCardTitle \|\| program\.catalogTitle \|\| program\.name\)\}<\/h3>/);
  assert.match(src, /<h1>\$\{escapeHtml\(selected\.name\)\}<\/h1>/);
});

test('catalog API mapping selects activity_no, audience_level and maps קורס to תוכנית', async () => {
  const src = await readFile(API_JS, 'utf8');
  assert.match(src, /activity_no,gefen_number,catalog_title/);
  assert.match(src, /audience_level,catalog_section/);
  assert.match(src, /catalogGroupToProductType\('programs'/);
  assert.match(src, /itemType === 'קורס'/);
});

test('catalog grid renders course programs from Supabase-shaped rows', async () => {
  const catalogScreen = await loadCatalogScreen();
  const data = {
    programs: [
      mockCatalogProgram(),
      mockCatalogProgram({
        id: '2',
        name: 'סודות ויסודות הבינה המלאכותית',
        catalogTitle: 'סודות ויסודות הבינה המלאכותית',
        catalogCardTitle: 'בינה מלאכותית',
        audienceLevel: 'חטיבה',
        productType: 'קורס'
      }),
      mockCatalogProgram({
        id: '3',
        name: 'התנסות בתעשייה',
        catalogTitle: 'התנסות בתעשייה',
        catalogCardTitle: 'התנסות בתעשייה',
        audienceLevel: 'תיכון',
        productType: 'סיור'
      })
    ],
    selectedId: '',
    audience: 'הכול',
    type: 'הכול',
    groupMode: '',
    standaloneCategory: 'makers',
    loadError: ''
  };

  const html = catalogScreen.render(data);

  assert.match(html, /יסודי/);
  assert.match(html, /חטיבה/);
  assert.match(html, /מנהיגות ירוקה/);
  assert.match(html, /בינה מלאכותית/);
  assert.match(html, /סדנאות, סיורים וחוגים/);
  assert.doesNotMatch(html, /לא נמצאו תוכניות מתאימות לסינון שנבחר/);
});

test('catalog filters default to showing all programs', async () => {
  const catalogScreen = await loadCatalogScreen();
  const data = {
    programs: [mockCatalogProgram()],
    selectedId: '',
    audience: 'הכול',
    type: 'הכול',
    groupMode: '',
    standaloneCategory: 'makers',
    loadError: ''
  };
  const html = catalogScreen.render(data);
  assert.match(html, /מנהיגות ירוקה/);
});

test('program detail uses updated catalog fields and syllabus meeting cards', async () => {
  const src = await readCatalogSource();

  assert.match(src, /const targetGrades = String\(pickFirstNonEmpty\(p\.target_grades, p\.targetGrades\)/);
  assert.match(src, /programFlow: String\(pickFirstNonEmpty\(p\.program_flow, p\.programFlow\)/);
  assert.doesNotMatch(src, /full_description/);
  assert.doesNotMatch(src, /programFlow:[^\n]*goals/);
  assert.match(src, /parseSkills\(program\.participantsReceive, program\.studentDevelops\)/);
  assert.match(src, /catalog-syllabus-item/);
  assert.match(src, /catalog-syllabus-badge/);
  assert.doesNotMatch(src, /<thead><tr><th>מפגש<\/th>/);
  assert.match(src, /syllabusMeetingText\(item\)/);
});
