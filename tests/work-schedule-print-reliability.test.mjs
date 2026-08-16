import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentWorkSchedulePrintWindow } from '../frontend/src/screens/work-schedule-print-reliability.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakePrintWindow({ readyState = 'complete', fontsReady = Promise.resolve() } = {}) {
  const listeners = new Map();
  let printCalls = 0;
  const win = {
    closed: false,
    document: { readyState, fonts: { ready: fontsReady } },
    focus() {},
    print() { printCalls += 1; },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback) { callback(); return 1; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    emit(name) { listeners.get(name)?.(); },
    get printCalls() { return printCalls; }
  };
  return win;
}

test('work schedule print waits for document fonts before entering the native save/print dialog', async () => {
  let releaseFonts;
  const fontsReady = new Promise((resolve) => { releaseFonts = resolve; });
  const win = fakePrintWindow({ fontsReady });
  instrumentWorkSchedulePrintWindow(win);

  win.print();
  await tick();
  assert.equal(win.printCalls, 0);

  releaseFonts();
  await tick();
  assert.equal(win.printCalls, 1);
});

test('work schedule print waits for a loading print document and only prints once', async () => {
  const win = fakePrintWindow({ readyState: 'loading' });
  instrumentWorkSchedulePrintWindow(win);

  win.print();
  win.print();
  assert.equal(win.printCalls, 0);

  win.document.readyState = 'complete';
  win.emit('load');
  await tick();
  assert.equal(win.printCalls, 1);
});
