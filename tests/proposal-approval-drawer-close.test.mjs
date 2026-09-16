import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const moduleUrl = new URL('../frontend/src/proposal-approval-drawer-close.js', import.meta.url);

function installDom(actionMarkup) {
  const dom = new JSDOM(`
    <main id="root">
      <div data-pa-proposal-detail>
        <button type="button" data-pa-close-drawer>סגירה</button>
        ${actionMarkup}
      </div>
    </main>
  `, { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  return dom;
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('approval keeps its click, hides the drawer only while signature overlay is open, then restores it', async () => {
  const dom = installDom('<button type="button" data-pa-status-action="approved" data-pa-action-id="p-1"><span>אישור וחתימה</span></button>');
  await import(`${moduleUrl.href}?test=approval-${Date.now()}`);
  const root = dom.window.document.getElementById('root');
  const detail = root.querySelector('[data-pa-proposal-detail]');
  let approvalClicks = 0;

  root.addEventListener('click', (event) => {
    if (!event.target?.closest?.('[data-pa-status-action="approved"]')) return;
    approvalClicks += 1;
    const overlay = dom.window.document.createElement('div');
    overlay.id = 'pa-preview-overlay';
    dom.window.document.body.appendChild(overlay);
  });

  detail.querySelector('[data-pa-status-action="approved"] span')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settle();

  assert.equal(approvalClicks, 1);
  assert.equal(detail.style.getPropertyValue('display'), 'none');
  assert.equal(detail.style.getPropertyPriority('display'), 'important');
  assert.equal(detail.getAttribute('aria-hidden'), 'true');

  dom.window.document.getElementById('pa-preview-overlay').remove();
  await settle();

  assert.equal(detail.style.getPropertyValue('display'), '');
  assert.equal(detail.getAttribute('aria-hidden'), null);
  assert.ok(detail.isConnected);
  dom.window.close();
});

test('preview from the drawer uses the same hide-and-restore flow', async () => {
  const dom = installDom('<button type="button" data-pa-preview="p-1"><span>תצוגה מקדימה</span></button>');
  await import(`${moduleUrl.href}?test=preview-${Date.now()}`);
  const root = dom.window.document.getElementById('root');
  const detail = root.querySelector('[data-pa-proposal-detail]');
  let previewClicks = 0;

  root.addEventListener('click', (event) => {
    if (!event.target?.closest?.('[data-pa-preview]')) return;
    previewClicks += 1;
    const overlay = dom.window.document.createElement('div');
    overlay.id = 'pa-preview-overlay';
    dom.window.document.body.appendChild(overlay);
  });

  detail.querySelector('[data-pa-preview] span')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settle();

  assert.equal(previewClicks, 1);
  assert.equal(detail.style.getPropertyValue('display'), 'none');

  dom.window.document.getElementById('pa-preview-overlay').remove();
  await settle();

  assert.equal(detail.style.getPropertyValue('display'), '');
  assert.ok(detail.isConnected);
  dom.window.close();
});

test('document actions outside a proposal drawer are left untouched', async () => {
  const dom = new JSDOM('<main id="root"><button data-pa-preview="p-2">תצוגה</button></main>', { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  const root = dom.window.document.getElementById('root');
  let previewClicks = 0;
  root.addEventListener('click', () => { previewClicks += 1; });

  await import(`${moduleUrl.href}?test=no-drawer-${Date.now()}`);
  root.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settle();

  assert.equal(previewClicks, 1);
  assert.equal(dom.window.document.querySelector('[data-pa-proposal-detail]'), null);
  dom.window.close();
});
