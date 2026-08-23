import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');

test('Israa proposal activity action column gets dedicated visible width', () => {
  assert.match(source, /const widths = selectable \? \['43%', '18%', '14%', '25%'\]/);
  assert.match(source, /<th style="width:\$\{widths\[3\]\}">פעולה<\/th>/);
  assert.match(source, /ACTION_BUTTON_STYLE = 'width:100%;max-width:100%;box-sizing:border-box;white-space:normal;/);
  assert.match(source, />העבר לפעילויות<\/button>/);
});
