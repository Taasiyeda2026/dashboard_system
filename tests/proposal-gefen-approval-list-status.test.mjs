import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  gefenApprovalListOptions,
  installGefenApprovalListStatus
} from '../frontend/src/proposal-gefen-approval-list-status.js';
import { proposalsAgreementsScreen, proposalsAgreementsTableRowsHtml } from '../frontend/src/screens/proposals-agreements.js';

const FEATURE_LOADERS_FILE = new URL('../frontend/src/feature-loaders.js', import.meta.url);
const SERVICE_WORKER_FILE = new URL('../frontend/sw.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);

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

test('proposal feature loads the status fix and cache version is refreshed', async () => {
  const [featureLoaders, serviceWorker, config] = await Promise.all([
    readFile(FEATURE_LOADERS_FILE, 'utf8'),
    readFile(SERVICE_WORKER_FILE, 'utf8'),
    readFile(CONFIG_FILE, 'utf8')
  ]);
  assert.match(featureLoaders, /proposal-gefen-approval-list-status\.js\?v=20260804-v1/);
  assert.match(serviceWorker, /const CACHE_VERSION = 1455;/);
  assert.match(config, /gefen-approval-list-status-load-20260807-v1/);
});
