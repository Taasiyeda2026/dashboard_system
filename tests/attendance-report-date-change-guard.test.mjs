import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createUnsavedChangesGuard } from '../attendance/src/services/unsaved-changes.js';
import { confirmSystemMessage } from '../attendance/src/components/system-dialog.js';

const read = path => readFile(new URL('../'+path, import.meta.url), 'utf8');

test('date selection in an empty new attendance form does not mark unsaved content', () => {
  const dom = new JSDOM('<!doctype html><form><input id="av2-report-date" type="date" value="2026-11-11"><input id="av2-notes"></form>');
  try {
    const document=dom.window.document;
    const form=document.querySelector('form');
    const date=document.querySelector('#av2-report-date');
    const notes=document.querySelector('#av2-notes');
    const guard=createUnsavedChangesGuard(form, {ignore: target => target?.id === 'av2-report-date'});
    date.value='2026-11-10';
    date.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    date.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(guard.dirty,false);
    notes.value='פרטי דיווח';
    notes.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(guard.dirty,true,'actual draft content remains protected');
  } finally {
    dom.window.close();
  }
});

test('changing date with filled draft asks an in-app system confirmation without clearing guard', async () => {
  const dom = new JSDOM('<!doctype html><html lang="he"><body><form><input id="av2-report-date" type="date"><input id="av2-notes"></form></body></html>');
  const proto=dom.window.HTMLDialogElement.prototype;
  proto.showModal=function(){this.setAttribute('open','');};
  proto.close=function(){this.removeAttribute('open');};
  globalThis.document=dom.window.document;
  try {
    const form=document.querySelector('form');
    const guard=createUnsavedChangesGuard(form,{ignore:target=>target?.id==='av2-report-date'});
    document.querySelector('#av2-notes').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const choice=confirmSystemMessage('לשנות את תאריך הדיווח?');
    const modal=document.querySelector('.av2-system-dialog');
    assert.ok(modal);
    assert.equal(modal.querySelector('h2').textContent,'הודעות מערכת');
    modal.querySelector('.av2-system-dialog__button--cancel').click();
    assert.equal(await choice,false);
    assert.equal(guard.dirty,true);
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('new report date change is free of confirmations and preserves draft guard',async()=>{
  const source=await read('attendance/src/screens/new-report-screen.js');
  assert.match(source,/createUnsavedChangesGuard\(form, \{ignore: target => target\?\.id === 'av2-report-date'\}\)/);
  assert.doesNotMatch(source,/if \(draftGuard\.dirty && !\(await confirmSystemMessage\(/);
  assert.match(source,/Changing the date is not leaving the report/);
  assert.match(source,/dateField\.input\.value=acceptedReportDate/);
  assert.match(source,/void onReportDateChange\(\)/);
  assert.doesNotMatch(source,/dateField\.input\.value!==acceptedReportDate && !draftGuard\.confirmLeave/);
  assert.match(source,/cancelBtn\.addEventListener\('click', async/);
});
