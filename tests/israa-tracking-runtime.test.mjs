import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activitiesTable } from '../frontend/src/israa-proposal-items.js';

test('proposal_items with multiple activities render as intact read-only rows', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost/' });
  const { document } = dom.window;
  const html = activitiesTable({
    participants_groups: 'כ-100 משתתפים',
    proposal_items: [
      { program_name: 'ביומימיקרי', gefen_number: '6089', quantity: 1 },
      { program_name: 'טכנולוגיות החלל', gefen_number: '57651', quantity: 2 },
    ],
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  const values = [...root.querySelectorAll('tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent));
  assert.deepEqual(values, [
    ['ביומימיקרי', '6089', '1'],
    ['טכנולוגיות החלל', '57651', '2'],
  ]);
  assert.equal(root.querySelectorAll('input, select, textarea').length, 0);
  assert.doesNotMatch(root.textContent, /כ-100 משתתפים/);
  dom.window.close();
});


test('Israa proposal drawer handles activity transfer directly', async () => {
  const fs = await import('node:fs');
  const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
  assert.match(tracking, /data-israa-select-activity/);
  assert.match(tracking, /save_israa_activity_draft/);
  assert.match(tracking, /p_tracking_id: trackingId/);
  assert.match(tracking, /p_proposal_item_id: proposalItemId/);
  assert.match(tracking, /israa-activities-changed/);
  assert.match(tracking, /הפעילות הועברה לפעילויות איסראא/);
});
