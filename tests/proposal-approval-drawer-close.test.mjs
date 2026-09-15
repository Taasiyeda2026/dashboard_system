import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const moduleUrl = new URL('../frontend/src/proposal-approval-drawer-close.js', import.meta.url);

function installDom() {
  const dom = new JSDOM(`
    <main id="root">
      <div data-pa-proposal-detail>
        <button type="button" data-pa-close-drawer>סגירה</button>
        <button type="button" data-pa-status-action="approved" data-pa-action-id="p-1"><span>אישור וחתימה</span></button>
      </div>
    </main>
  `, { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  return dom;
}

test('approval action closes proposal detail without swallowing the approval click', async () => {
  const dom = installDom();
  const { installProposalApprovalDrawerClose } = await import(`${moduleUrl.href}?test=${Date.now()}`);
  const root = dom.window.document.getElementById('root');
  const detail = root.querySelector('[data-pa-proposal-detail]');
  let approvalClicks = 0;

  detail.querySelector('[data-pa-close-drawer]').addEventListener('click', () => detail.remove());
  root.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-pa-status-action="approved"]')) approvalClicks += 1;
  });

  installProposalApprovalDrawerClose(dom.window);
  detail.querySelector('[data-pa-status-action="approved"] span')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await Promise.resolve();

  assert.equal(approvalClicks, 1);
  assert.equal(dom.window.document.querySelector('[data-pa-proposal-detail]'), null);
  dom.window.close();
});

test('approval action is a no-op when no proposal detail is open', async () => {
  const dom = new JSDOM('<main id="root"><button data-pa-status-action="approved" data-pa-action-id="p-2">אישור</button></main>', { url: 'https://example.test/' });
  const root = dom.window.document.getElementById('root');
  let approvalClicks = 0;
  root.addEventListener('click', () => { approvalClicks += 1; });

  const { installProposalApprovalDrawerClose } = await import(`${moduleUrl.href}?test=no-drawer-${Date.now()}`);
  installProposalApprovalDrawerClose(dom.window);
  root.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await Promise.resolve();

  assert.equal(approvalClicks, 1);
  assert.equal(dom.window.document.querySelector('[data-pa-proposal-detail]'), null);
  dom.window.close();
});
