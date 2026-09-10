import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const runtime = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');
const boardRuntime = await readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/styles/manager-board-final-fixes.css', import.meta.url), 'utf8');
let viteServer;

after(async () => {
  await viteServer?.close();
});

test('manager board opens school 2027 on September by default', () => {
  assert.match(boardRuntime, /if \(normalized === 'school_2027'\) return SCHOOL_2027_START_DATE\.slice\(0, 7\)/);
  assert.match(runtime, /localStorage\.removeItem\(`manager_board_month:\$\{period\}`\)/);
  assert.match(runtime, /clearPersistedManagerMonthDefaults\(\)/);
});

test('long calendar descriptions wrap instead of ellipsizing', () => {
  assert.match(css, /\.manager-board-screen \.manager-board-calendar-day__school/);
  assert.match(css, /text-overflow: clip !important/);
  assert.match(css, /white-space: normal !important/);
  assert.match(css, /overflow-wrap: anywhere/);
});

async function loadInteractiveRuntimes() {
  if (!globalThis.document) {
    const dom = new JSDOM('<!doctype html><html><body><main id="app"><div id="screenRoot"></div></main></body></html>', { url: 'https://dashboard.test/' });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Element: dom.window.Element,
      MutationObserver: dom.window.MutationObserver,
      CustomEvent: dom.window.CustomEvent,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage
    });
  }
  viteServer ||= await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  return Promise.all([
    viteServer.ssrLoadModule('/frontend/src/manager-board-interactions-runtime.js'),
    viteServer.ssrLoadModule('/frontend/src/manager-board-runtime.js')
  ]);
}

test('live day cells open by click, Enter and Space after rerender', async () => {
  const [{ bindManagerBoardDayCells }] = await loadInteractiveRuntimes();
  const root = document.getElementById('screenRoot');
  const opened = [];
  const render = (iso) => {
    root.innerHTML = `<section data-manager-board-root><div data-manager-board-day="${iso}"></div></section>`;
    bindManagerBoardDayCells(root, (cell) => opened.push(cell.dataset.managerBoardDay));
    return root.querySelector('[data-manager-board-day]');
  };

  let day = render('2026-09-10');
  day.click();
  day.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  day.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  day = render('2026-09-11');
  day.click();

  assert.deepEqual(opened, ['2026-09-10', '2026-09-10', '2026-09-10', '2026-09-11']);
});

test('rendered instructor controls carry emp_id and directly open the instructor center after rerender', async () => {
  const [, { bindInstructorCenterButtons }] = await loadInteractiveRuntimes();
  const root = document.getElementById('screenRoot');
  const data = { instructors: [{ emp_id: '731', full_name: 'מדריכה פעילה', direct_manager: 'מנהלת', active: true }] };
  const opened = [];
  const render = () => {
    root.innerHTML = '<select data-manager-board-manager><option selected>מנהלת</option></select><section data-manager-board-monthly-region></section><button data-instructor-id="731">מדריכה פעילה</button>';
    bindInstructorCenterButtons(root, data, (_root, _data, instructor) => {
      opened.push(instructor.empId);
      _root.querySelector('[data-manager-board-monthly-region]').innerHTML = `<div data-manager-instructor-center data-instructor-id="${instructor.empId}"></div>`;
    });
    return root.querySelector('button[data-instructor-id]');
  };

  let button = render();
  assert.equal(button.dataset.managerInstructorCenterOpen, 'true');
  button.click();
  assert.ok(root.querySelector('[data-manager-instructor-center][data-instructor-id="731"]'));
  button = render();
  button.click();

  assert.deepEqual(opened, ['731', '731']);
});
