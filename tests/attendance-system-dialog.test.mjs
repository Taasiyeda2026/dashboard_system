import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { confirmSystemMessage, showSystemMessage } from '../attendance/src/components/system-dialog.js';

const load = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

function setup() {
  const dom = new JSDOM('<!doctype html><html lang="he"><body><button id="before">מקור</button></body></html>');
  const dialogProto = dom.window.HTMLDialogElement.prototype;
  dialogProto.showModal = function() { this.setAttribute('open', ''); };
  dialogProto.close = function() {
    this.removeAttribute('open');
    this.dispatchEvent(new dom.window.Event('close'));
  };
  globalThis.document = dom.window.document;
  return dom;
}
function teardown(dom) {
  delete globalThis.document;
  dom.window.close();
}

test('delete confirmation is an in-app system message with cancellation and confirmation', async () => {
  const dom = setup();
  try {
    const before = document.getElementById('before');
    before.focus();
    const pending = confirmSystemMessage('האם הינך בטוח/ה שברצונך למחוק את רשומת הנוכחות מתאריך 03.11.2026?', {destructive:true,confirmLabel:'כן',cancelLabel:'לא',compact:true});
    const dialog = document.querySelector('.av2-system-dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('h2').textContent, 'הודעות מערכת');
    assert.equal(dialog.querySelector('.av2-system-dialog__message').textContent,
      'האם הינך בטוח/ה שברצונך למחוק את רשומת הנוכחות מתאריך 03.11.2026?');
    assert.equal(dialog.querySelectorAll('button').length, 2);
    assert.ok(dialog.querySelector('.av2-system-dialog__button--danger'));
    assert.ok(dialog.classList.contains('av2-system-dialog--compact'));
    assert.equal(dialog.querySelector('.av2-system-dialog__button--cancel').textContent,'לא');
    assert.equal(dialog.querySelector('.av2-system-dialog__button--confirm').textContent,'כן');
    dialog.querySelector('.av2-system-dialog__button--cancel').click();
    assert.equal(await pending, false);
    assert.equal(document.querySelector('.av2-system-dialog'), null);
    assert.equal(document.activeElement, before);

    const second = confirmSystemMessage('להמשיך?');
    document.querySelector('.av2-system-dialog__button--confirm').click();
    assert.equal(await second, true);
  } finally {
    teardown(dom);
  }
});

test('informational system notice has a single close button', async () => {
  const dom = setup();
  try {
    const pending = showSystemMessage('שגיאה במחיקה');
    const dialog = document.querySelector('.av2-system-dialog');
    assert.equal(dialog.querySelector('h2').textContent, 'הודעות מערכת');
    assert.equal(dialog.querySelectorAll('button').length, 1);
    dialog.querySelector('button').click();
    await pending;
    assert.equal(document.querySelector('.av2-system-dialog'), null);
  } finally {
    teardown(dom);
  }
});

test('only targeted attendance prompts are changed; data and payroll paths are untouched', async () => {
  const [reports, expenses, index, sw] = await Promise.all([
    load('attendance/src/screens/my-reports-screen.js'),
    load('attendance/src/screens/expenses-tab.js'),
    load('attendance/index.html'),
    load('attendance/sw.js')
  ]);
  assert.match(reports, /await confirmSystemMessage\(/);
  assert.match(reports, /void showSystemMessage\(/);
  assert.match(expenses, /await confirmSystemMessage\(/);
  assert.doesNotMatch(reports, /if \(!confirm\(`למחוק את הדיווח/);
  const cssVersion=index.match(/system-dialog\.css\?v=(\d+)/)?.[1];
  const swVersion=sw.match(/const CACHE_VERSION = (\d+);/)?.[1];
  assert.ok(cssVersion && swVersion);
  assert.equal(cssVersion,swVersion);
});
