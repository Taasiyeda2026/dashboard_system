import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const css = readFileSync(new URL('../frontend/public/summer-feedback/completion-overview.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');

function wait(ms = 15) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('feedback sections start closed and completed cards receive a green confirmation badge', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <form id="feedbackForm">
      <details class="feedback-group" open>
        <summary><span><strong>תוכן והכשרה</strong></span><b>0/2</b></summary>
        <div>
          <label class="question"><select><option value=""></option><option value="5" selected>5</option></select></label>
          <label class="question"><select><option value=""></option><option value="na" selected>לא רלוונטי</option></select></label>
        </div>
      </details>
      <details class="activity" open>
        <summary><span><strong>פעילות</strong></span><b>0/3</b></summary>
        <div class="metric-grid">
          <label><select><option value=""></option><option value="5" selected>5</option></select></label>
          <label><select><option value="" selected></option><option value="5">5</option></select></label>
        </div>
        <div class="activity-experience">
          <label><input type="checkbox" data-experience value="קלה להעברה"></label>
        </div>
      </details>
    </form>
  </body></html>`, { url: 'https://example.test/summer-feedback/' });

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    testMode: globalThis.__SUMMER_FEEDBACK_COMPLETION_TEST__
  };

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.__SUMMER_FEEDBACK_COMPLETION_TEST__ = true;

  try {
    const moduleUrl = new URL('../frontend/public/summer-feedback/completion-overview.js', import.meta.url);
    const overview = await import(`${moduleUrl.href}?test=${Date.now()}`);
    overview.initializeCompletionOverview(document);
    await wait(30);

    const group = document.querySelector('.feedback-group');
    const activity = document.querySelector('.activity');
    const groupBadge = group.querySelector('summary b');
    const activityBadge = activity.querySelector('summary b');

    assert.equal(group.open, false);
    assert.equal(activity.open, false);
    assert.equal(groupBadge.textContent, '2/2');
    assert.equal(groupBadge.classList.contains('is-complete'), true);
    assert.equal(activityBadge.textContent, '1/3');
    assert.equal(activityBadge.classList.contains('is-complete'), false);

    activity.querySelectorAll('select')[1].value = '5';
    overview.updateCompletionIndicators(document);
    assert.equal(activityBadge.textContent, '2/3');
    assert.equal(activityBadge.classList.contains('is-complete'), false);

    activity.querySelector('[data-experience]').checked = true;
    overview.updateCompletionIndicators(document);
    assert.equal(activityBadge.textContent, '3/3');
    assert.equal(activityBadge.classList.contains('is-complete'), true);
  } finally {
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.MutationObserver = previous.MutationObserver;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.__SUMMER_FEEDBACK_COMPLETION_TEST__ = previous.testMode;
  }
});

test('completion overview resources and compact mobile action bar are loaded', () => {
  assert.match(html, /completion-overview\.css/);
  assert.match(html, /completion-overview\.js/);
  assert.match(css, /\.is-complete/);
  assert.match(css, /background: #237a4b/);
  assert.match(css, /\.submit-bar[\s\S]*width: max-content/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*width: fit-content/);
  assert.doesNotMatch(css, /\.submit-bar[\s\S]{0,160}width: 100%/);
});
