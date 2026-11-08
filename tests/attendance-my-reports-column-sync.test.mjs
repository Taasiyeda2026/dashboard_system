import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [runtime, css, reports, indexHtml, sw] = await Promise.all([
  read('attendance/src/attendance-followup-runtime-v2.js'),
  read('attendance/src/styles/report-table-fit-fix.css'),
  read('attendance/src/screens/my-reports-screen.js'),
  read('attendance/index.html'),
  read('attendance/sw.js')
]);

function headerEnhancer(document) {
  const start = runtime.indexOf('function enhanceReportHeader(head) {');
  const end = runtime.indexOf('function updateTimeCancelCell(row) {', start);
  assert.ok(start > 0 && end > start, 'header implementation must be present');
  const ctx = {
    document,
    HTMLElement: document.defaultView.HTMLElement,
    ENHANCED_HEADER: 'av2TimeCancelHeader',
    usesDailyTravelPath: (row) => String(row.dataset.reportDate || '').slice(0, 10) >= '2026-11-01',
    text: (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
  };
  runInNewContext(runtime.slice(start, end) + '\nthis.enhanceReportHeader = enhanceReportHeader;', ctx);
  return ctx.enhanceReportHeader;
}

const labels = ['תאריך', 'התחלה', 'סיום', 'שעות', 'סה״כ יומי', 'סוג', 'שם פעילות',
  'מיקום / בית ספר', 'רשות', 'ק״מ', 'הוצאות', 'פעולות'];

function tableFor(date) {
  const dom = new JSDOM('<div class="av2-report-list"><div class="av2-report-list__head"></div><div class="av2-report-row"></div></div>');
  const document = dom.window.document;
  const list = document.querySelector('.av2-report-list');
  const head = document.querySelector('.av2-report-list__head');
  const row = document.querySelector('.av2-report-row');
  row.dataset.reportDate = date;
  for (const label of labels) {
    const cell = document.createElement('span');
    cell.textContent = label;
    head.append(cell);
    row.append(document.createElement('div'));
  }
  return { document, list, head, row };
}

function gridTracks(legacy) {
  const selector = legacy ? '.av2-reports .av2-report-list--legacy-cancellation .av2-report-list__head,'
    : '.av2-reports .av2-report-list__head,';
  const start = css.lastIndexOf(selector);
  assert.ok(start >= 0, 'final grid override must exist');
  const grid = css.indexOf('grid-template-columns:', start);
  const end = css.indexOf('!important', grid);
  assert.ok(grid > start && end > grid, 'grid declaration must be complete');
  return [...css.slice(grid, end).matchAll(/(\d+)px/g)].map(x => Number(x[1]));
}

test('Nov 2026+ header preserves 12 columns so actions stay in the final track', () => {
  const { document, list, head, row } = tableFor('2026-11-03');
  const enhance = headerEnhancer(document);
  enhance(head);
  enhance(head);
  assert.equal(head.children.length, 12);
  assert.equal(row.children.length, 12);
  assert.equal(head.lastElementChild.textContent, 'פעולות');
  assert.equal(list.classList.contains('av2-report-list--legacy-cancellation'), false);
  assert.deepEqual(gridTracks(false), [61,60,60,60,61,60,100,95,90,55,55,161]);
  assert.equal(gridTracks(false).reduce((a,b)=>a+b,0), 918);
});

test('October 2026 retains one historical time-cancellation header and 13 tracks', () => {
  const { document, list, head, row } = tableFor('2026-10-25');
  const enhance = headerEnhancer(document);
  enhance(head);
  enhance(head);
  assert.equal(head.children.length, 13);
  assert.equal(head.children[4].textContent, 'ביטול זמן');
  assert.equal(head.lastElementChild.textContent, 'פעולות');
  assert.equal(list.classList.contains('av2-report-list--legacy-cancellation'), true);
  assert.equal(gridTracks(true).length, 13);
  assert.equal(gridTracks(true).reduce((a,b)=>a+b,0), 918);
  row.dataset.reportDate = '2026-11-03';
  enhance(head);
  assert.equal(head.children.length, 12, 'changing to a Nov report must remove the stale header');
  assert.equal(list.classList.contains('av2-report-list--legacy-cancellation'), false);
});

test('header synchronization runs after each report row is inserted', () => {
  const rowStart = runtime.indexOf('function enhanceReportRow(row) {');
  const text = runtime.slice(rowStart, rowStart + 620);
  assert.match(text, /enhanceReportHeader\(header\)/);
  assert.ok(text.indexOf('enhanceReportHeader(header)') < text.indexOf('if (usesDailyTravelPath(row)) return'));
  assert.match(reports, /row\.append\(dateCell, startCell, endCell, hoursCell, dayTotalCell, typeCell, nameCell, schoolCell, authCell, kmCell, expCell, actionsCell\)/);
});

test('all layout changes are desktop/table-scoped and cache version is synchronized', () => {
  assert.match(css, /@media \(min-width: 768px\) \{[\s\S]*?av2-report-list--legacy-cancellation/);
  assert.match(css, /\.av2-reports \.av2-report-row \.av2-rr__actions \{/);
  assert.match(css, /overflow: visible !important/);
  const version = sw.match(/const CACHE_VERSION = (\d+);/)?.[1];
  assert.ok(version);
  const versions = [...indexHtml.matchAll(/\?v=(\d+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(versions)], [version]);
});
