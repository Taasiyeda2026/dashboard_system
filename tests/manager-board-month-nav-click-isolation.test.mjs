import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const boardSource = await readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');

let viteServer;
let loaded = null;

after(async () => {
  await viteServer?.close();
});

function boardFixtureHtml(ym = '2026-09') {
  return `
    <section class="manager-board-screen" data-manager-board-root data-manager-board-period="school_2027" data-manager-board-ym="${ym}" data-manager-board-school-year="2027" dir="rtl">
      <div class="manager-board-hero__controls">
        <label class="manager-board-manager-select">
          <span>מנהל פעילות</span>
          <select data-manager-board-manager>
            <option value="מנהלת" selected>מנהלת</option>
          </select>
        </label>
        <div class="manager-board-month-nav" aria-label="בחירת חודש">
          <button type="button" data-manager-board-month="-1" aria-label="החודש הקודם">‹</button>
          <strong>ספטמבר 2026</strong>
          <button type="button" data-manager-board-month="1" aria-label="החודש הבא">›</button>
        </div>
      </div>
      <div data-manager-workspace-tabs>
        <button type="button" data-manager-workspace-tab="management" aria-selected="false">ניהול</button>
        <button type="button" data-manager-workspace-tab="attendance" class="is-active" aria-selected="true">בקרת נוכחות</button>
        <button type="button" data-manager-workspace-tab="tracking" aria-selected="false">מעקב</button>
      </div>
      <button type="button" data-instructor-id="731">מדריכה פעילה</button>
      <div data-manager-board-day="2026-09-10" tabindex="0">10</div>
      <button type="button" data-manager-board-extra="yes">פעולה אחרת</button>
    </section>
  `;
}

async function loadModules() {
  if (loaded) return loaded;
  const dom = new JSDOM('<!doctype html><html><body><main id="app"><div id="screenRoot"></div></main></body></html>', {
    url: 'https://dashboard.test/'
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage
  });
  viteServer = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  loaded = await Promise.all([
    viteServer.ssrLoadModule('/frontend/src/manager-board-workspace-runtime.js'),
    viteServer.ssrLoadModule('/frontend/src/manager-board-runtime.js'),
    viteServer.ssrLoadModule('/frontend/src/manager-board-interactions-runtime.js')
  ]);
  return loaded;
}

function shiftYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Install a capture-phase shim that mirrors the fixed attendance month path.
 * Returns dispose() so tests do not leak listeners into each other.
 */
function installAttendanceCaptureShim(resolveManagerBoardMonthNavButton, session) {
  const onClick = (event) => {
    if (session.activeTab === 'attendance') {
      const monthButton = resolveManagerBoardMonthNavButton(event.target);
      const monthBoardRoot = monthButton?.closest('[data-manager-board-root]');
      if (monthButton && monthBoardRoot) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const delta = Number(monthButton.dataset.managerBoardMonth || 0);
        if (!delta) return;
        session.attendanceYm = shiftYm(session.attendanceYm, delta);
        session.monthDeltas.push(delta);
        return;
      }
    }
    const tab = event.target instanceof Element ? event.target.closest('[data-manager-workspace-tab]') : null;
    if (!tab || !tab.closest('[data-manager-board-root]')) return;
    event.preventDefault();
    session.activeTab = tab.dataset.managerWorkspaceTab;
    session.tabs.push(session.activeTab);
  };
  window.addEventListener('click', onClick, true);
  return () => window.removeEventListener('click', onClick, true);
}

test('board root publishes ym state separately from month nav control attributes', () => {
  assert.match(boardSource, /data-manager-board-ym="\$\{escapeAttr\(ym\)\}"/);
  assert.doesNotMatch(
    boardSource,
    /data-manager-board-root[^>]*data-manager-board-month="\$\{escapeAttr\(ym\)\}"/
  );
  assert.match(boardSource, /data-manager-board-month="-1"/);
  assert.match(boardSource, /data-manager-board-month="1"/);
  assert.match(
    boardSource,
    /querySelectorAll\('\.manager-board-month-nav \[data-manager-board-month="-1"\], \.manager-board-month-nav \[data-manager-board-month="1"\]'\)/
  );
  assert.match(workspaceSource, /dataset\?\.managerBoardYm/);
  assert.doesNotMatch(workspaceSource, /dataset\?\.managerBoardMonth/);
  assert.doesNotMatch(workspaceSource, /closest\('\[data-manager-board-month\]'\)/);
  assert.match(workspaceSource, /resolveManagerBoardMonthNavButton/);
});

test('attendance capture month path isolates nav buttons and leaves other board clicks free', async () => {
  const [{ resolveManagerBoardMonthNavButton }, { bindInstructorCenterButtons }, { bindManagerBoardDayCells }] =
    await loadModules();

  const root = document.getElementById('screenRoot');
  root.innerHTML = boardFixtureHtml('2026-09');
  const board = root.querySelector('[data-manager-board-root]');

  assert.equal(board.getAttribute('data-manager-board-ym'), '2026-09');
  assert.equal(board.hasAttribute('data-manager-board-month'), false);
  assert.ok(board.querySelector('.manager-board-month-nav [data-manager-board-month="-1"]'));
  assert.ok(board.querySelector('.manager-board-month-nav [data-manager-board-month="1"]'));

  const session = {
    activeTab: 'attendance',
    attendanceYm: '2026-09',
    monthDeltas: [],
    tabs: []
  };
  const dispose = installAttendanceCaptureShim(resolveManagerBoardMonthNavButton, session);

  try {
    const instructors = [];
    const days = [];
    const extras = [];
    const data = {
      instructors: [{ emp_id: '731', full_name: 'מדריכה פעילה', direct_manager: 'מנהלת', active: true }]
    };
    bindInstructorCenterButtons(board, data, () => {
      instructors.push('731');
    });
    bindManagerBoardDayCells(board, (cell) => {
      days.push(cell.dataset.managerBoardDay);
    });
    board.querySelector('[data-manager-board-extra]').addEventListener('click', () => {
      extras.push('extra');
    });

    board.querySelector('[data-manager-workspace-tab="management"]').click();
    assert.equal(session.activeTab, 'management');
    assert.deepEqual(session.tabs, ['management']);

    session.activeTab = 'attendance';
    board.querySelector('button[data-instructor-id="731"]').click();
    assert.deepEqual(instructors, ['731']);

    board.querySelector('[data-manager-board-day="2026-09-10"]').click();
    assert.deepEqual(days, ['2026-09-10']);

    board.querySelector('[data-manager-board-extra]').click();
    assert.deepEqual(extras, ['extra']);

    board.querySelector('[data-manager-board-month="-1"]').click();
    assert.equal(session.attendanceYm, '2026-08');
    assert.deepEqual(session.monthDeltas, [-1]);

    board.querySelector('[data-manager-board-month="1"]').click();
    assert.equal(session.attendanceYm, '2026-09');
    assert.deepEqual(session.monthDeltas, [-1, 1]);

    assert.equal(resolveManagerBoardMonthNavButton(board.querySelector('[data-manager-board-extra]')), null);
    assert.equal(resolveManagerBoardMonthNavButton(board.querySelector('[data-manager-workspace-tab="tracking"]')), null);
    assert.equal(resolveManagerBoardMonthNavButton(board.querySelector('[data-instructor-id]')), null);
    assert.equal(resolveManagerBoardMonthNavButton(board.querySelector('[data-manager-board-day]')), null);
    assert.ok(resolveManagerBoardMonthNavButton(board.querySelector('[data-manager-board-month="-1"]')));
  } finally {
    dispose();
  }
});

test('management tab month nav, instructor, day and tab clicks keep working with capture present', async () => {
  const [{ resolveManagerBoardMonthNavButton }, { bindInstructorCenterButtons }, { bindManagerBoardDayCells }] =
    await loadModules();

  const root = document.getElementById('screenRoot');
  root.innerHTML = boardFixtureHtml('2026-09');
  const board = root.querySelector('[data-manager-board-root]');

  const session = {
    activeTab: 'management',
    attendanceYm: '2026-09',
    monthDeltas: [],
    tabs: []
  };
  const dispose = installAttendanceCaptureShim(resolveManagerBoardMonthNavButton, session);

  try {
    const months = [];
    const instructors = [];
    const days = [];
    board
      .querySelectorAll('.manager-board-month-nav [data-manager-board-month="-1"], .manager-board-month-nav [data-manager-board-month="1"]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          months.push(Number(button.dataset.managerBoardMonth));
        });
      });

    const data = {
      instructors: [{ emp_id: '731', full_name: 'מדריכה פעילה', direct_manager: 'מנהלת', active: true }]
    };
    bindInstructorCenterButtons(board, data, () => instructors.push('731'));
    bindManagerBoardDayCells(board, (cell) => days.push(cell.dataset.managerBoardDay));

    board.querySelector('[data-manager-board-month="-1"]').click();
    board.querySelector('[data-manager-board-month="1"]').click();
    board.querySelector('button[data-instructor-id="731"]').click();
    board.querySelector('[data-manager-board-day="2026-09-10"]').click();
    board.querySelector('[data-manager-workspace-tab="tracking"]').click();

    assert.deepEqual(months, [-1, 1]);
    assert.deepEqual(instructors, ['731']);
    assert.deepEqual(days, ['2026-09-10']);
    assert.deepEqual(session.tabs, ['tracking']);
    assert.equal(session.activeTab, 'tracking');
  } finally {
    dispose();
  }
});
