import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

import { ensureProposalActivityDrawerStyles } from '../frontend/src/proposal-drawer-activity-style.js';

const ACTIVITY_LINKING_FILE = new URL('../frontend/src/proposal-activity-linking.js', import.meta.url);
const DOMAIN_ROUTING_FILE = new URL('../frontend/src/proposal-domain-routing.js', import.meta.url);
const PROPOSALS_SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const MAIN_CSS_FILE = new URL('../frontend/src/styles/main.css', import.meta.url);

function drawerFixtureHtml({ itemCount = 1 } = {}) {
  const items = Array.from({ length: itemCount }, (_, index) => `
    <div class="ds-pa-item-card" data-pa-drawer-item="${index + 1}">
      <strong>סדנה ${index + 1}</strong>
    </div>
  `).join('');

  // Mirrors drawerHtml host structure from proposals-agreements.js:
  // activities-wide > itemsHost + activity-creator-host + financialCard
  // then domain-routing-host as the next sibling.
  return `
    <div data-pa-proposal-detail>
      <aside class="ds-pa-drawer" data-pa-drawer>
        <div class="ds-pa-drawer-panel">
          <div class="ds-pa-drawer-body">
            <div class="ds-pa-proposal-info-grid"></div>
            <section class="ds-pa-activities-wide">
              <h4 class="ds-pa-card-title">פעילויות ומחירים</h4>
              <div class="ds-pa-drawer-items-host" data-pa-drawer-items>${items}</div>
              <div data-proposal-activity-creator-host></div>
              <div class="ds-pa-info-card ds-pa-info-card--financial-summary">
                <h4 class="ds-pa-card-title">סה״כ לתשלום</h4>
                <div class="ds-pa-total-amount">₪ 1,500</div>
              </div>
            </section>
            <div data-proposal-domain-routing-host></div>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function mountDrawer({ itemCount = 1 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="app">${drawerFixtureHtml({ itemCount })}</div></body></html>`
  );
  const { document } = dom.window;
  const root = document.querySelector('[data-pa-proposal-detail]');
  return { dom, document, root };
}

function mountActivityCreator(root, { proposalId = 'p1' } = {}) {
  const host = root.querySelector('[data-proposal-activity-creator-host]');
  assert.ok(host, 'activity creator host must exist');
  const card = root.ownerDocument.createElement('section');
  card.className = 'proposal-activity-creator';
  card.setAttribute('data-proposal-activity-creator', proposalId);
  card.innerHTML = '<h3 class="proposal-activity-creator__title">פעילויות 2027</h3>';
  host.replaceChildren(card);
  return { host, card };
}

function mountDomainRouting(root, { proposalId = 'p1' } = {}) {
  const host = root.querySelector('[data-proposal-domain-routing-host]');
  assert.ok(host, 'domain routing host must exist');
  const card = root.ownerDocument.createElement('section');
  card.className = 'proposal-israa-routing';
  card.setAttribute('data-proposal-domain-routing-card', proposalId);
  card.setAttribute('data-proposal-domain-routing', 'E');
  card.innerHTML = '<h3 class="proposal-israa-routing__title">מעקב הצעות גפ״ן – תשפ״ז</h3>';
  host.replaceChildren(card);
  return { host, card };
}

function assertStructuralOrder(root, { expectDomain = false } = {}) {
  const activities = root.querySelector('.ds-pa-activities-wide');
  const items = root.querySelector('[data-pa-drawer-items]');
  const activityHost = root.querySelector('[data-proposal-activity-creator-host]');
  const financial = root.querySelector('.ds-pa-info-card--financial-summary');
  const domainHost = root.querySelector('[data-proposal-domain-routing-host]');
  const creator = root.querySelector('[data-proposal-activity-creator]');

  assert.ok(activities);
  assert.ok(items);
  assert.ok(activityHost);
  assert.ok(financial);
  assert.ok(domainHost);
  assert.ok(creator);

  assert.equal(creator.parentElement, activityHost);
  assert.ok(activities.contains(items));
  assert.ok(activities.contains(activityHost));
  assert.ok(activities.contains(financial));
  assert.ok(activities.contains(creator));
  assert.notEqual(activities.nextElementSibling, creator);

  const kids = [...activities.children];
  assert.ok(kids.indexOf(items) < kids.indexOf(activityHost));
  assert.ok(kids.indexOf(activityHost) < kids.indexOf(financial));
  assert.equal(activities.nextElementSibling, domainHost);

  if (expectDomain) {
    const domainCard = root.querySelector('[data-proposal-domain-routing-card]');
    assert.ok(domainCard);
    assert.equal(domainCard.parentElement, domainHost);
    assert.equal(activityHost.contains(domainCard), false);
    assert.equal(domainCard.getAttribute('data-proposal-domain-routing'), 'E');
    assert.equal(domainCard.hasAttribute('data-proposal-activity-creator'), false);
    assert.equal(creator.hasAttribute('data-proposal-domain-routing-card'), false);
  } else {
    assert.equal(domainHost.children.length, 0);
  }
}

test('drawerHtml source keeps explicit hosts in the required structural order', async () => {
  const proposalsScreen = await readFile(PROPOSALS_SCREEN_FILE, 'utf8');
  assert.match(
    proposalsScreen,
    /ds-pa-activities-wide[\s\S]*\$\{itemsHost\}<div data-proposal-activity-creator-host><\/div>\$\{financialCard\}/
  );
  assert.match(
    proposalsScreen,
    /<\/section>\s*<div data-proposal-domain-routing-host><\/div>/
  );
});

test('activity and domain modules mount only into explicit hosts without afterend', async () => {
  const [activityLinking, domainRouting, mainCss] = await Promise.all([
    readFile(ACTIVITY_LINKING_FILE, 'utf8'),
    readFile(DOMAIN_ROUTING_FILE, 'utf8'),
    readFile(MAIN_CSS_FILE, 'utf8')
  ]);

  assert.match(activityLinking, /\[data-proposal-activity-creator-host\]/);
  assert.match(activityLinking, /replaceChildren\(card\)/);
  assert.doesNotMatch(activityLinking, /afterend/);
  assert.doesNotMatch(activityLinking, /insertAdjacentElement\(/);
  assert.doesNotMatch(activityLinking, /data-proposal-domain-routing-host/);

  assert.match(domainRouting, /\[data-proposal-domain-routing-host\]/);
  assert.match(domainRouting, /replaceChildren\(card\)/);
  assert.doesNotMatch(domainRouting, /afterend/);
  assert.doesNotMatch(domainRouting, /insertAdjacentElement\(/);
  assert.doesNotMatch(domainRouting, /data-proposal-activity-creator-host/);

  assert.doesNotMatch(mainCss, /\.ds-pa-drawer-body\s*\{\s*display:\s*grid/);
});

test('one proposal item keeps creator below items and above financial summary', () => {
  const { root } = mountDrawer({ itemCount: 1 });
  mountActivityCreator(root);
  assertStructuralOrder(root, { expectDomain: false });
  assert.equal(root.querySelectorAll('[data-pa-drawer-item]').length, 1);
});

test('multiple proposal items keep a single creator host below all rows', () => {
  const { root } = mountDrawer({ itemCount: 3 });
  mountActivityCreator(root);
  assertStructuralOrder(root, { expectDomain: false });
  assert.equal(root.querySelectorAll('[data-pa-drawer-item]').length, 3);
  assert.equal(root.querySelectorAll('[data-proposal-activity-creator]').length, 1);
});

test('GEFEN proposal keeps creator inside activities-wide host flow', () => {
  const { root } = mountDrawer({ itemCount: 2 });
  mountActivityCreator(root, { proposalId: 'gefen-1' });
  assertStructuralOrder(root, { expectDomain: false });
});

test('domain E routing uses a separate host and does not share activity attrs', () => {
  const { root } = mountDrawer({ itemCount: 1 });
  mountActivityCreator(root, { proposalId: 'domain-e-1' });
  mountDomainRouting(root, { proposalId: 'domain-e-1' });
  assertStructuralOrder(root, { expectDomain: true });
});

test('empty hosts stay footprint-free and drawer-body flex ownership remains in shell styles', () => {
  const { dom, root } = mountDrawer({ itemCount: 1 });
  assert.equal(ensureProposalActivityDrawerStyles(dom.window), true);

  const style = dom.window.document.getElementById('ds-pa-proposal-activity-drawer-style-v1');
  assert.ok(style);
  assert.match(style.textContent, /\.ds-pa-drawer-body[\s\S]*display:\s*flex !important/);
  assert.match(style.textContent, /\.ds-pa-drawer-body[\s\S]*flex-direction:\s*column !important/);
  assert.match(style.textContent, /\.ds-pa-drawer-body[\s\S]*gap:\s*10px !important/);
  assert.match(style.textContent, /\[data-proposal-activity-creator-host\]:empty/);
  assert.match(style.textContent, /\[data-proposal-domain-routing-host\]:empty/);
  assert.match(style.textContent, /display:\s*none !important/);

  assert.equal(root.querySelector('[data-proposal-activity-creator-host]').children.length, 0);
  assert.equal(root.querySelector('[data-proposal-domain-routing-host]').children.length, 0);
});
