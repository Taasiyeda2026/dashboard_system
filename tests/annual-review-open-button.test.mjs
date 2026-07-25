import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindAnnualReviewOpenButton } from '../frontend/src/annual-review-open-button.js';

test('one guarded click opens once and restores the button when opening fails', async () => {
  const dom = new JSDOM('<button data-ar2-open="review-1">פתיחת המשוב</button>');
  const button = dom.window.document.querySelector('button');
  let calls = 0;
  let finishOpening;
  const opening = new Promise((resolve) => { finishOpening = resolve; });

  bindAnnualReviewOpenButton(button, async (id) => {
    calls += 1;
    assert.equal(id, 'review-1');
    return opening;
  }, { guarded: true });

  button.click();
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'טוען…');

  finishOpening(false);
  await opening;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'פתיחת המשוב');
});

test('guarded open restores the button when opening throws', async () => {
  const dom = new JSDOM('<button data-ar2-open="review-2">פתיחת המשוב</button>');
  const button = dom.window.document.querySelector('button');
  bindAnnualReviewOpenButton(button, async () => {
    throw new Error('open failed');
  }, { guarded: true });

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'פתיחת המשוב');
});
