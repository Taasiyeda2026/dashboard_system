import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCREEN = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);

test('summary numbers, refresh and SharePoint controls occupy one compact row', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.ok(source.includes('.pc-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(195px,auto)'));
  const header = source.indexOf("'<header class=\"pc-title\"><h2>אישורי צילום</h2></header>'");
  const summary = source.indexOf("'<div class=\"pc-summary\">'", header);
  const actions = source.indexOf("'<div class=\"pc-summary-actions\"", summary);
  const filter = source.indexOf("'<div class=\"pc-results-header\"", actions);
  assert.ok(header !== -1 && header < summary && summary < actions && actions < filter,
    'actions should be a sibling of the three KPI cards, before results and filter');
  const summaryMarkup = source.slice(summary, filter);
  assert.match(summaryMarkup, /בתי ספר עם אישורים/);
  assert.match(summaryMarkup, /מסמכים שמורים/);
  assert.match(summaryMarkup, /פעילויות משויכות/);
  assert.match(summaryMarkup, /data-pc-refresh/);
  assert.match(summaryMarkup, /SharePoint/);
  assert.doesNotMatch(source.slice(header, summary), /data-pc-refresh|SharePoint/);
});

test('collapsed filters do not occupy a separate full-width toolbar row', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /filtersOpen: false/);
  assert.match(source, /pc-results-tools/);
  assert.match(source, /<span>סינון'/);
  assert.doesNotMatch(source, /סינון וחיפוש|סינון וצילום/);
  assert.doesNotMatch(source, /pc-filter-shell/);
  assert.ok(source.includes('.pc-filter-body[hidden]{display:none}'));
  assert.match(source, /context\.filtersOpen \? '' : ' hidden'/);
  const results = source.indexOf("'<div class=\"pc-results-header\"");
  const button = source.indexOf("data-pc-filter-toggle", results);
  const filterBody = source.indexOf("'<div class=\"pc-filter-body\"", button);
  const table = source.indexOf("'<div class=\"pc-table-wrap\"", filterBody);
  assert.ok(results >= 0 && button > results && filterBody > button && table > filterBody,
    'toggle is inside results header, optional body follows it, then table');
  assert.match(source, /context\.filtersOpen = !context\.filtersOpen/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls="pc-filter-fields"/);
  assert.match(source, /data-pc-clear/);
});

test('same row on desktop, responsive two-column summary and narrow mobile action controls', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /@media\(max-width:820px\)/);
  assert.match(source, /\.pc-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px\}/);
  assert.match(source, /@media\(max-width:390px\)/);
  assert.match(source, /\.pc-summary-actions\{flex-direction:column;align-items:stretch/);
  assert.match(source, /\.pc-filter-toggle:focus-visible/);
  assert.match(source, /\.pc-mobile-list\{display:grid/);
  assert.match(source, /\.pc-table-wrap\{display:none\}/);
});
