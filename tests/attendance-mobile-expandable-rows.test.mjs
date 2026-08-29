import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const enhancer = await readFile(new URL('../attendance/src/mobile-reports-enhancer.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../attendance/src/styles/mobile-reports.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');

test('mobile reports use a compact expandable summary instead of horizontal table scrolling', () => {
  assert.match(enhancer, /av2-rr-mobile__summary/);
  assert.match(enhancer, /is-mobile-expanded/);
  assert.match(enhancer, /aria-expanded/);
  assert.match(enhancer, /av2-rr__date/);
  assert.match(enhancer, /av2-rr__type/);
  assert.match(enhancer, /av2-rr__name/);
  assert.match(enhancer, /av2-rr__hours/);

  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /\.av2-report-list__head\s*\{\s*display:\s*none\s*!important/);
  assert.match(styles, /\.av2-report-row\s*\{[\s\S]*min-width:\s*0\s*!important/);
  assert.match(styles, /overflow-x:\s*hidden\s*!important/);
  assert.match(styles, /\.av2-report-row\.is-mobile-expanded/);
});

test('expanded mobile row exposes the secondary details and actions', () => {
  for (const label of ['שעת התחלה', 'שעת סיום', 'שם הפעילות', 'בית ספר', 'רשות', 'ק״מ', 'הוצאות', 'פעולות', 'הערות']) {
    assert.match(enhancer, new RegExp(label));
  }
  assert.match(styles, /is-mobile-expanded > \.av2-rr__actions/);
  assert.match(styles, /is-mobile-expanded > \.av2-rr__notes-row/);
});

test('mobile report assets are loaded with the current cache version', () => {
  assert.match(index, /mobile-reports\.css\?v=40/);
  assert.match(index, /mobile-reports-enhancer\.js\?v=40/);
});
