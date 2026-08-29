import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const desktopStyles = await readFile(new URL('../attendance/src/styles/reports-table-polish.css', import.meta.url), 'utf8');
const mobileStyles = await readFile(new URL('../attendance/src/styles/mobile-reports.css', import.meta.url), 'utf8');

test('attendance copy action is not exposed in desktop, tablet or mobile report actions', () => {
  assert.match(desktopStyles, /\.av2-rr__actions \.av2-rr__action-copy\s*\{\s*display:\s*none\s*!important/);
  assert.match(mobileStyles, /is-mobile-expanded > \.av2-rr__actions \.av2-rr__action-copy\s*\{\s*display:\s*none\s*!important/);
});
