import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeProposalWorkflowDocument } from '../frontend/src/proposal-workflow-completion.js';

test('GEFEN two-course preview is never rewritten as next-year course/workshop tables', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="pa-gefen-combined-document">
      <div class="proposal-document">
        <table class="pa-activities-table pa-gefen-course-table">
          <tbody>
            <tr><td>ביומימיקרי</td><td>6089</td><td>11</td><td>1</td><td>16.5</td><td>600</td><td>9,900</td></tr>
            <tr><td>טכנולוגיות החלל</td><td>57651</td><td>9</td><td>1</td><td>13.5</td><td>640</td><td>8,640</td></tr>
          </tbody>
          <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td>18,540</td></tr></tfoot>
        </table>
      </div>
    </div>
  </body>`);

  const root = dom.window.document.body;
  normalizeProposalWorkflowDocument(root);

  const gefenTable = root.querySelector('.pa-gefen-course-table');
  assert.ok(gefenTable, 'the original GEFEN course table must remain in the document');
  assert.equal(gefenTable.querySelectorAll('tbody > tr').length, 2);
  assert.equal(root.querySelectorAll('.pa-next-year-course-table').length, 0);
  assert.equal(root.querySelectorAll('.pa-next-year-workshop-table').length, 0);
  assert.equal(root.querySelectorAll('.pa-next-year-combined-total').length, 0);
});
