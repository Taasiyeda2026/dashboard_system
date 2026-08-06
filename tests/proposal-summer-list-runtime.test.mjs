import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const {
  normalizeSummerProposalType,
  proposalTypeFromTableRow,
  applySummerProposalListMode,
  activateSummerProposalTab,
  leaveSummerProposalTab
} = await import('../frontend/src/proposal-summer-list-runtime.js');

function screenHtml() {
  return `
    <section class="ds-pa-screen" data-pa-proposal-list-mode="regular">
      <nav>
        <button type="button" data-pa-tab="records" class="is-active">רשומות</button>
        <button type="button" data-pa-tab="sent">נשלחו</button>
        <button type="button" data-pa-summer-tab>הצעות קיץ <span data-pa-summer-count>0</span></button>
      </nav>
      <select data-pa-filter="activity_type_group">
        <option value="">הכול</option>
        <option value="next_year">תשפ״ז</option>
        <option value="summer">קיץ</option>
      </select>
      <div data-pa-table-region>
        <table data-pa-table><tbody></tbody></table>
      </div>
    </section>`;
}

function rowHtml(id, type) {
  return `<tr data-pa-row-id="${id}" data-pa-proposal-type="${type}"><td>${type}</td><td>${id}</td></tr>`;
}

test('summer aliases normalize consistently from stored and displayed values', () => {
  for (const value of ['summer', 'פעילויות קיץ', 'קיץ תשפ״ו', 'קיץ תשפו', 'קיץ']) {
    assert.equal(normalizeSummerProposalType(value), 'summer');
  }
});

test('regular list hides summer rows, while choosing the summer type shows them', () => {
  const dom = new JSDOM(`<!doctype html><body>${screenHtml()}</body>`);
  const screen = dom.window.document.querySelector('.ds-pa-screen');
  const body = screen.querySelector('tbody');
  body.innerHTML = `${rowHtml('summer-1', 'קיץ תשפ״ו')}${rowHtml('next-1', 'תשפ״ז')}`;

  assert.equal(proposalTypeFromTableRow(body.rows[0]), 'summer');
  applySummerProposalListMode(screen);
  assert.equal(body.rows[0].hidden, true);
  assert.equal(body.rows[1].hidden, false);

  screen.querySelector('[data-pa-filter="activity_type_group"]').value = 'summer';
  applySummerProposalListMode(screen);
  assert.equal(body.rows[0].hidden, false);
  assert.equal(body.rows[1].hidden, true);
});

test('summer tab uses sent proposals and loads every available page before displaying the list', async () => {
  const dom = new JSDOM(`<!doctype html><body>${screenHtml()}</body>`, { pretendToBeVisual: true });
  const screen = dom.window.document.querySelector('.ds-pa-screen');
  const body = screen.querySelector('tbody');
  const tableRegion = screen.querySelector('[data-pa-table-region]');

  screen.querySelector('[data-pa-tab="sent"]').addEventListener('click', () => {
    body.innerHTML = `${rowHtml('summer-1', 'summer')}${rowHtml('next-1', 'next_year')}`;
    if (!screen.querySelector('[data-pa-load-more-proposals]')) {
      tableRegion.insertAdjacentHTML('beforeend', '<button type="button" data-pa-load-more-proposals>עוד</button>');
      const button = screen.querySelector('[data-pa-load-more-proposals]');
      button.addEventListener('click', () => {
        button.disabled = true;
        setTimeout(() => {
          body.insertAdjacentHTML('beforeend', rowHtml('summer-2', 'קיץ תשפ״ו'));
          button.remove();
        }, 5);
      });
    }
  });

  assert.equal(await activateSummerProposalTab(screen), true);
  const summerRows = Array.from(body.querySelectorAll('tr')).filter((row) => !row.hidden);
  assert.deepEqual(summerRows.map((row) => row.dataset.paRowId), ['summer-1', 'summer-2']);
  assert.equal(screen.dataset.paProposalListMode, 'summer');
  assert.equal(screen.querySelector('[data-pa-filter="activity_type_group"]').value, 'summer');
  assert.equal(screen.querySelector('[data-pa-summer-count]').textContent, '2');
  assert.equal(screen.querySelector('[data-pa-summer-tab]').classList.contains('is-active'), true);
});

test('leaving the summer tab clears the summer filter and restores the sent tab state', () => {
  const dom = new JSDOM(`<!doctype html><body>${screenHtml()}</body>`);
  const screen = dom.window.document.querySelector('.ds-pa-screen');
  screen.dataset.paProposalListMode = 'summer';
  screen.querySelector('[data-pa-filter="activity_type_group"]').value = 'summer';
  screen.querySelector('[data-pa-summer-tab]').classList.add('is-active');

  leaveSummerProposalTab(screen);

  assert.equal(screen.dataset.paProposalListMode, 'regular');
  assert.equal(screen.querySelector('[data-pa-filter="activity_type_group"]').value, '');
  assert.equal(screen.querySelector('[data-pa-summer-tab]').classList.contains('is-active'), false);
  assert.equal(screen.querySelector('[data-pa-tab="sent"]').classList.contains('is-active'), true);
});
