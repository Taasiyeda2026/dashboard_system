import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { proposalHtmlToVectorModel } from '../frontend/src/proposal-vector-pdf-runtime.js';

test('proposal vector model preserves Hebrew text, tables and lists as semantic content', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  const html = `
    <article class="proposal-document" dir="rtl">
      <h1>הצעת מחיר 10315</h1>
      <p>לכבוד תיכון תמר אריאל</p>
      <table>
        <thead><tr><th>פעילות</th><th>כמות</th><th>מחיר</th></tr></thead>
        <tbody><tr><td>יישומי בינה מלאכותית</td><td>1</td><td>9,600 ₪</td></tr></tbody>
      </table>
      <ul><li>התשלום בהתאם להצעה</li><li>המחירים כוללים את הפעילות</li></ul>
      <button class="no-print">לא לכלול</button>
    </article>`;

  const blocks = proposalHtmlToVectorModel(html, dom.window.document);
  assert.ok(blocks.some((block) => block.type === 'heading' && block.text === 'הצעת מחיר 10315'));
  assert.ok(blocks.some((block) => block.type === 'text' && block.text.includes('תיכון תמר אריאל')));
  const table = blocks.find((block) => block.type === 'table');
  assert.ok(table);
  assert.equal(table.columns, 3);
  assert.equal(table.rows[1].cells[0].text, 'יישומי בינה מלאכותית');
  const list = blocks.find((block) => block.type === 'list');
  assert.deepEqual(list.items, ['התשלום בהתאם להצעה', 'המחירים כוללים את הפעילות']);
  assert.equal(blocks.some((block) => String(block.text || '').includes('לא לכלול')), false);
  dom.window.close();
});

test('proposal vector model keeps explicit document page breaks', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const blocks = proposalHtmlToVectorModel(`
    <article class="proposal-document">
      <section><h2>עמוד ראשון</h2></section>
      <section class="pa-page-break"><h2>עמוד שני</h2></section>
    </article>`, dom.window.document);
  assert.equal(blocks.filter((block) => block.type === 'break').length, 1);
  assert.ok(blocks.some((block) => block.type === 'heading' && block.text === 'עמוד שני'));
  dom.window.close();
});
