import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sortProposalTablesByProposalDate } from '../frontend/src/proposal-gefen-approval-list-status.js';

test('proposal table is ordered by proposal date from newest to oldest', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <table data-pa-table>
      <thead><tr><th>תחום</th><th>מס׳</th><th>רשות</th><th>בית הספר</th><th>סוג הצעה</th><th>תאריך</th><th>סטטוס</th><th>סה״כ</th><th>פעולות</th></tr></thead>
      <tbody>
        <tr data-pa-row-id="old"><td>Y</td><td>1</td><td></td><td></td><td></td><td>31/08/2026</td><td></td><td></td><td></td></tr>
        <tr data-pa-row-id="new"><td>Y</td><td>2</td><td></td><td></td><td></td><td>08/09/2026</td><td></td><td></td><td></td></tr>
        <tr data-pa-row-id="mid"><td>Y</td><td>3</td><td></td><td></td><td></td><td>02/09/2026</td><td></td><td></td><td></td></tr>
      </tbody>
    </table>
  </body></html>`);

  sortProposalTablesByProposalDate(dom.window.document);

  assert.deepEqual(
    Array.from(dom.window.document.querySelectorAll('tbody tr')).map((row) => row.dataset.paRowId),
    ['new', 'mid', 'old']
  );
});
