import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

import {
  applyProposalActivityDrawerStyle,
  enhanceProposalActivityDrawer,
  ensureProposalActivityDrawerStyles
} from '../frontend/src/proposal-drawer-activity-style.js';

const FEATURE_LOADERS_FILE = new URL('../frontend/src/feature-loaders.js', import.meta.url);

test('proposal drawer uses the same left-side shell proportions and internal scrolling as activity drawer', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>');

  assert.equal(ensureProposalActivityDrawerStyles(dom.window), true);
  assert.equal(ensureProposalActivityDrawerStyles(dom.window), false);

  const style = dom.window.document.getElementById('ds-pa-proposal-activity-drawer-style-v1');
  assert.ok(style);
  assert.match(style.textContent, /justify-content:\s*flex-start !important/);
  assert.match(style.textContent, /width:\s*min\(820px, 55vw\) !important/);
  assert.match(style.textContent, /max-width:\s*calc\(100vw - 32px\) !important/);
  assert.match(style.textContent, /linear-gradient\(135deg, #1a2740 0%, #243b60 100%\)/);
  assert.match(style.textContent, /\.ds-pa-drawer-body[\s\S]*overflow-y:\s*auto !important/);
  assert.match(style.textContent, /@media \(max-width: 1180px\)[\s\S]*width:\s*min\(760px, 64vw\) !important/);
  assert.match(style.textContent, /@media \(max-width: 900px\)[\s\S]*width:\s*100vw !important/);
});

test('proposal drawer enhancement keeps existing actions/content and adds proposal type as a header chip', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app">
    <div data-pa-proposal-detail>
      <aside class="ds-pa-drawer">
        <div class="ds-pa-drawer-panel">
          <header class="ds-pa-drawer-head">
            <div class="ds-pa-drawer-head-info">
              <h3 class="ds-pa-drawer-name--hero">הגורן · 312397</h3>
              <p class="ds-pa-drawer-meta-line">
                <span class="ds-pa-drawer-meta-item">שדות</span>
                <span class="ds-pa-drawer-meta-sep">|</span>
                <span class="ds-pa-drawer-meta-item ds-pa-drawer-meta-item--status">נשלח</span>
              </p>
            </div>
            <button data-pa-close-drawer>✕</button>
          </header>
          <div class="ds-pa-drawer-action-bar">
            <span class="ds-pa-drawer-icon-btns"><button data-pa-preview="p1">צפייה</button></span>
          </div>
          <div class="ds-pa-drawer-body">
            <section class="ds-pa-info-card">
              <div class="ds-pa-info-cell"><span class="ds-pa-info-label">סוג הצעה</span><span class="ds-pa-info-value">גפן</span></div>
            </section>
            <section class="ds-pa-activities-wide">פעילויות ומחירים</section>
          </div>
        </div>
      </aside>
    </div>
  </div></body></html>`);

  const detail = dom.window.document.querySelector('[data-pa-proposal-detail]');
  assert.equal(enhanceProposalActivityDrawer(detail), true);

  assert.equal(detail.getAttribute('data-pa-activity-drawer-style'), 'true');
  assert.ok(detail.classList.contains('ds-pa-proposal-detail--activity-style'));
  assert.equal(detail.querySelector('.ds-pa-drawer-meta-item--type')?.textContent, 'גפן');
  assert.ok(detail.querySelector('[data-pa-close-drawer].ds-pa-drawer-close--activity'));
  assert.ok(detail.querySelector('.ds-pa-drawer-action-bar--activity'));
  assert.ok(detail.querySelector('[data-pa-preview="p1"]'));
  assert.match(detail.querySelector('.ds-pa-activities-wide')?.textContent || '', /פעילויות ומחירים/);
});

test('proposal drawer polish applies to rendered proposal details and feature loader loads it', async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app">
    <div data-pa-proposal-detail>
      <aside class="ds-pa-drawer"><div class="ds-pa-drawer-panel">
        <header class="ds-pa-drawer-head"><p class="ds-pa-drawer-meta-line"></p><button data-pa-close-drawer>✕</button></header>
        <div class="ds-pa-drawer-action-bar"></div>
        <div class="ds-pa-drawer-body"><section class="ds-pa-activities-wide">פעילויות</section></div>
      </div></aside>
    </div>
  </div></body></html>`);

  applyProposalActivityDrawerStyle(dom.window.document, dom.window);
  assert.ok(dom.window.document.querySelector('[data-pa-proposal-detail].ds-pa-proposal-detail--activity-style'));
  assert.ok(dom.window.document.getElementById('ds-pa-proposal-activity-drawer-style-v1'));

  const featureLoaders = await readFile(FEATURE_LOADERS_FILE, 'utf8');
  assert.match(featureLoaders, /proposal-drawer-activity-style\.js\?v=20260913-v1/);
});
