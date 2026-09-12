import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  applyClientFileProposalDisplayPolish,
  compactProposalRowActions,
  gefenApprovalListOptions,
  installGefenApprovalListStatus,
  prepareProposalDetailDrawer
} from '../frontend/src/proposal-gefen-approval-list-status.js';
import { proposalsAgreementsScreen, proposalsAgreementsTableRowsHtml } from '../frontend/src/screens/proposals-agreements.js';

const FEATURE_LOADERS_FILE = new URL('../frontend/src/feature-loaders.js', import.meta.url);
const SERVICE_WORKER_FILE = new URL('../frontend/sw.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);

function adminState() {
  return {
    user: { role: 'admin', display_role: 'admin' },
    effectiveRoutes: ['proposals-agreements']
  };
}

test('proposal list requests always include saved linked-document metadata', async () => {
  let receivedOptions = null;
  const generatedRow = {
    id: 'gefen-generated-after-reload',
    quote_number: '10201',
    activity_type_group: 'gefen',
    gefen_approval_status: 'generated',
    gefen_approval_path: 'proposals/example/gefen-approval.pdf',
    status: 'sent'
  };
  const targetApi = {
    proposalsAgreements: async (options) => {
      receivedOptions = options;
      return { rows: [generatedRow] };
    }
  };

  assert.equal(installGefenApprovalListStatus(targetApi), true);
  assert.equal(installGefenApprovalListStatus(targetApi), false);

  const result = await targetApi.proposalsAgreements({
    limit: 50,
    offset: 0,
    includeLinkedDocuments: false
  });

  assert.deepEqual(receivedOptions, {
    limit: 50,
    offset: 0,
    includeLinkedDocuments: true
  });

  const html = proposalsAgreementsTableRowsHtml(result.rows, adminState());
  assert.match(html, /ds-pa-gefen-status-text--generated">הופק<\/span>/);
  assert.doesNotMatch(html, /ds-pa-gefen-status-text--missing">חסר<\/span>/);
});

test('linked-document option helper preserves paging and filters', () => {
  assert.deepEqual(gefenApprovalListOptions({
    limit: 50,
    offset: 50,
    status: 'sent',
    sort: 'updated_at_desc'
  }), {
    limit: 50,
    offset: 50,
    status: 'sent',
    sort: 'updated_at_desc',
    includeLinkedDocuments: true
  });
});

test('proposalsAgreementsScreen.load requests linked documents from the screen itself', async () => {
  let receivedOptions = null;
  const api = {
    proposalsAgreements: async (options) => {
      receivedOptions = options;
      return { rows: [] };
    }
  };

  await proposalsAgreementsScreen.load({ api, state: adminState() });
  assert.deepEqual(receivedOptions, {
    limit: 50,
    offset: 0,
    includeLinkedDocuments: true
  });

  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screenSource, /limit: 50, offset: 0, includeLinkedDocuments: true/);
  assert.match(screenSource, /includeLinkedDocuments:\s*true/);
  assert.doesNotMatch(screenSource, /includeLinkedDocuments:\s*false/);
});

test('client-file proposal table hides GEFEN columns and gives 20px from actions to domain and quote number', () => {
  const headers = [
    'תחום', 'מס׳', 'רשות', 'בית הספר', 'סוג הצעה', 'תאריך', 'סטטוס', 'סה״כ',
    'אישור גפ״ן', 'חתום / הוזמן', 'פעולות'
  ];
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app">
    <table class="ds-pa-table" data-pa-table>
      <colgroup>${headers.map(() => '<col style="width:95px">').join('')}</colgroup>
      <thead><tr>${headers.map((label, index) => `<th class="${index === 10 ? 'ds-pa-actions-col' : ''}">${label}</th>`).join('')}</tr></thead>
      <tbody><tr>${headers.map((label, index) => `<td class="${index === 9 ? 'ds-pa-gfen-signed-col' : index === 10 ? 'ds-pa-actions-cell' : ''}">${index === 8 ? '<span class="ds-pa-gefen-status-text">הופק</span>' : label}</td>`).join('')}</tr></tbody>
    </table>
  </div></body></html>`);

  applyClientFileProposalDisplayPolish(dom.window.document, dom.window);

  const table = dom.window.document.querySelector('[data-pa-table]');
  const visibleHeaders = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim());
  assert.deepEqual(visibleHeaders, ['תחום', 'מס׳', 'רשות', 'בית הספר', 'סוג הצעה', 'תאריך', 'סטטוס', 'סה״כ', 'פעולות']);
  assert.equal(table.querySelectorAll('tbody td').length, 9);
  assert.equal(table.querySelectorAll('colgroup col').length, 9);
  const widths = Array.from(table.querySelectorAll('colgroup col')).map((col) => col.style.width);
  assert.deepEqual(widths, ['65px', '65px', '145px', '160px', '120px', '110px', '110px', '120px', '150px']);
  assert.equal(widths.reduce((sum, width) => sum + Number.parseInt(width, 10), 0), 1045);
  const injectedStyle = dom.window.document.getElementById('ds-pa-client-file-gefen-layout-v2');
  assert.ok(injectedStyle);
  assert.match(injectedStyle.textContent, /width:\s*150px !important/);
  assert.match(injectedStyle.textContent, /text-align:\s*center !important/);
  assert.doesNotMatch(injectedStyle.textContent, /width:\s*170px !important/);
});

test('proposal row actions remove duplicated overflow actions and remove ellipsis when nothing remains', () => {
  const dom = new JSDOM(`<!doctype html><html><body><table><tbody><tr>
    <td class="ds-pa-actions-cell">
      <div class="ds-pa-actions-inner">
        <button data-pa-generate-gefen-approval="p1">quick</button>
        <details class="ds-pa-row-more">
          <summary>⋯</summary>
          <div class="ds-pa-row-more-menu">
            <button data-pa-generate-gefen-approval="p1">duplicate</button>
          </div>
        </details>
      </div>
    </td>
  </tr></tbody></table></body></html>`);

  compactProposalRowActions(dom.window.document);

  assert.equal(dom.window.document.querySelector('.ds-pa-row-more'), null);
  assert.ok(dom.window.document.querySelector('[data-pa-generate-gefen-approval="p1"]'));
});

test('proposal details are prepared as an accessible side drawer and keep existing content/actions', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app">
    <div data-pa-proposal-detail>
      <div class="ds-pa-proposal-detail-toolbar"><button>חזרה</button></div>
      <aside class="ds-pa-drawer">
        <div class="ds-pa-drawer-panel">
          <header class="ds-pa-drawer-head"><button data-pa-close-drawer>✕</button></header>
          <div class="ds-pa-drawer-body">
            <div class="ds-pa-proposal-info-grid"><section class="ds-pa-info-card">פרטי ההצעה</section><section class="ds-pa-info-card">איש קשר</section></div>
            <section class="ds-pa-activities-wide">פעילויות ומחירים</section>
          </div>
        </div>
      </aside>
    </div>
  </div></body></html>`);

  prepareProposalDetailDrawer(dom.window.document);
  applyClientFileProposalDisplayPolish(dom.window.document, dom.window);

  const detail = dom.window.document.querySelector('[data-pa-proposal-detail]');
  assert.equal(detail.getAttribute('role'), 'dialog');
  assert.equal(detail.getAttribute('aria-modal'), 'true');
  assert.equal(detail.getAttribute('aria-label'), 'פרטי הצעה');
  assert.ok(detail.querySelector('[data-pa-close-drawer]'));
  assert.ok(detail.querySelector('.ds-pa-activities-wide'));
  const style = dom.window.document.getElementById('ds-pa-client-file-gefen-layout-v2').textContent;
  assert.match(style, /position:\s*fixed !important/);
  assert.match(style, /width:\s*min\(720px, calc\(100vw - 32px\)\) !important/);
  assert.match(style, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) !important/);
  assert.match(style, /ds-pa-proposal-detail-toolbar[\s\S]*display:\s*none !important/);
});

test('drawer keeps one proposal view action and moves GEFEN eye beside approval status', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app">
    <section class="ds-pa-drawer-panel">
      <div class="ds-pa-drawer-icon-btns">
        <button data-pa-preview="p1" aria-label="צפייה במסמך שנשלח"></button>
        <button data-pa-view-final-pdf="p1" aria-label="צפייה ב-PDF שנשלח"></button>
        <button data-pa-view-gefen-approval="p1" aria-label="צפייה באישור גפ״ן"></button>
      </div>
      <div class="ds-pa-info-cell">
        <span class="ds-pa-info-label">אישור גפ״ן</span>
        <span class="ds-pa-info-value">הופק</span>
      </div>
    </section>
  </div></body></html>`);

  applyClientFileProposalDisplayPolish(dom.window.document, dom.window);

  const panel = dom.window.document.querySelector('.ds-pa-drawer-panel');
  const actions = panel.querySelector('.ds-pa-drawer-icon-btns');
  assert.equal(actions.querySelector('[data-pa-preview]'), null);
  assert.ok(actions.querySelector('[data-pa-view-final-pdf]'));
  assert.equal(actions.querySelector('[data-pa-view-gefen-approval]'), null);

  const approvalValue = panel.querySelector('.ds-pa-info-value');
  assert.match(approvalValue.textContent, /הופק/);
  assert.ok(approvalValue.querySelector('[data-pa-view-gefen-approval].ds-pa-gefen-inline-view'));
});

test('proposal feature loads the refreshed layout runtime and current frontend cache version', async () => {
  const [featureLoaders, serviceWorker] = await Promise.all([
    readFile(FEATURE_LOADERS_FILE, 'utf8'),
    readFile(SERVICE_WORKER_FILE, 'utf8')
  ]);
  assert.match(featureLoaders, /proposal-gefen-approval-list-status\.js\?v=20260913-side-drawer-table-v2/);
  assert.match(serviceWorker, /const CACHE_VERSION = 1695;/);
});
