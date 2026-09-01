import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.sessionStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
};
globalThis.localStorage ??= globalThis.sessionStorage;

const { normalizeProposalWorkflowDocument } = await import('../frontend/src/proposal-workflow-completion.js');

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

test('tour cost tables never enter the next-year generic table splitter', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <article class="proposal-document pa-proposal-doc--tour">
      <section><h3 class="pa-section-heading">הפעילות המוצעת</h3></section>
      <div class="pa-cost-table-block">
        <table class="pa-cost-table pa-activities-table pa-tour-cost-table"><tbody>
          <tr><td>כיתה ח1</td><td>33</td><td>100</td><td>3,300</td></tr>
          <tr><td>כיתה ח2</td><td>42</td><td>200</td><td>8,400</td></tr>
          <tr><td>כיתה ח3</td><td>32</td><td>300</td><td>9,600</td></tr>
          <tr><td>מדריך</td><td>3</td><td>400</td><td>1,200</td></tr>
          <tr><td>הסעה</td><td>3</td><td>800</td><td>2,400</td></tr>
        </tbody></table>
      </div>
    </article>
  </body>`);

  normalizeProposalWorkflowDocument(dom.window.document.body);

  assert.equal(dom.window.document.querySelectorAll('.pa-tour-cost-table tbody > tr').length, 5);
  assert.equal(dom.window.document.querySelectorAll('.pa-next-year-course-table, .pa-next-year-workshop-table, .pa-next-year-combined-total').length, 0);
  assert.equal(dom.window.document.querySelector('.pa-next-year-selected-summary'), null);
});
