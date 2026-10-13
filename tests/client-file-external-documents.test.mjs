import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  externalClientDocumentsHtml,
  externalClientDocumentFormHtml,
  externalClientDocumentRowsHtml,
  mountClientExternalDocuments,
} from '../frontend/src/client-file-external-documents.js';

const source = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261013192000_client_file_external_documents.sql', import.meta.url), 'utf8');

test('external document controls render only for selected client files, never in proposal lists', () => {
  const withinSelected = source.slice(source.indexOf('function selectedClientFileHtml('), source.indexOf('function clientContactEditorHtml('));
  const landing = source.slice(source.indexOf('function clientFileLandingHtml('), source.indexOf('function clientSearchResultsHtml('));
  const table = source.slice(source.indexOf('export function proposalsAgreementsTableRowsHtml('), source.indexOf('function clientFileLandingHtml('));
  assert.match(withinSelected, /externalClientDocumentsHtml\(canManage\)/);
  assert.doesNotMatch(landing, /externalClientDocumentsHtml|mountClientExternalDocuments/);
  assert.doesNotMatch(table, /externalClientDocumentsHtml|mountClientExternalDocuments/);
  const mounts = source.match(/mountClientExternalDocuments\(clientWorkspace, file, \{ canManage, signal \}\)/g) || [];
  assert.equal(mounts.length, 2, 'selected file and returning from proposal details both hydrate their documents');
});

test('viewers can see documents but only managers get the add and delete actions', () => {
  assert.match(externalClientDocumentsHtml(true), /data-ext-add/);
  assert.doesNotMatch(externalClientDocumentsHtml(false), /data-ext-add/);
  const row = { id: 'example', document_kind: 'quote', title: 'הצעה מגורם חיצוני', file_path: 'documents/example.pdf', amount: 8000 };
  assert.match(externalClientDocumentRowsHtml([row], true), /הצעת מחיר חיצונית/);
  assert.match(externalClientDocumentRowsHtml([row], true), /data-ext-delete/);
  assert.doesNotMatch(externalClientDocumentRowsHtml([row], false), /data-ext-delete/);
  assert.match(externalClientDocumentRowsHtml([{ ...row, document_kind: 'agreement' }]), /הסכם חיצוני/);
});

test('external document form requires PDF and includes external metadata, not workflow fields', () => {
  const document = new JSDOM('<body>' + externalClientDocumentFormHtml() + '</body>').window.document;
  for (const name of ['document_kind', 'title', 'document_date', 'amount', 'document_file', 'notes']) {
    assert.ok(document.querySelector('[name="' + name + '"]'), name);
  }
  assert.equal(document.querySelector('[name="document_file"]').getAttribute('accept'), '.pdf,application/pdf');
  assert.ok(document.querySelector('[name="title"]').required);
  assert.ok(document.querySelector('[name="document_file"]').required);
  assert.equal(document.querySelector('[name="document_kind"] option[value="quote"]').textContent, 'הצעת מחיר חיצונית');
  assert.equal(document.querySelector('[name="external_number"]'), null, 'external document number is hidden from the new form');
  assert.equal(document.querySelectorAll('.ds-client-external__fields > label').length, 6, 'three compact symmetrical rows');
  assert.equal(document.querySelectorAll('[data-ext-full]').length, 0, 'PDF and notes occupy equal-width columns');
  assert.doesNotMatch(document.body.innerHTML, /quote_number|approval_status|gefen_number|proposal_agreement_id/);
});

test('external document form is centered, compact and symmetrical on desktop', async () => {
  const source = await readFile(new URL('../frontend/src/client-file-external-documents.js', import.meta.url), 'utf8');
  assert.match(source, /\.ds-client-external__form\{[^}]*max-width:900px/);
  assert.match(source, /\.ds-client-external__fields\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /@media\(max-width:640px\)\{\.ds-client-external__fields\{grid-template-columns:1fr\}\}/);
  assert.doesNotMatch(externalClientDocumentFormHtml(), /external_number|data-ext-full/);
});

test('external document metadata is escaped in client-file HTML', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = externalClientDocumentRowsHtml([{ id: bad, title: bad, document_kind: 'agreement', amount: null }], true);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /data-ext-row="<img/);
});

test('backend isolates external files with own private bucket and RLS, no proposal writes', () => {
  assert.match(migration, /create table if not exists public\.client_external_documents/);
  assert.match(migration, /alter table public\.client_external_documents enable row level security/);
  assert.match(migration, /public\.app_can_view_proposals_agreements\(\)/);
  assert.match(migration, /public\.app_can_manage_proposals_agreements\(\)/);
  assert.match(migration, /'client-external-documents', 'client-external-documents', false/);
  assert.match(migration, /file_path = 'documents\/' \|\| id::text \|\| '\.pdf'/);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from|alter table)\s+public\.proposals_agreements/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*?to anon/);
});


test('selected client file nests external documents directly below contacts in the same width column', async () => {
  const selected = source.slice(source.indexOf('function selectedClientFileHtml('), source.indexOf('function clientContactEditorHtml('));
  const layout = await readFile(new URL('../frontend/src/screens/client-file-layout-polish.js', import.meta.url), 'utf8');
  const rightStart = selected.indexOf('<div class="ds-client-file__contacts-column">');
  const identityStart = selected.indexOf('<section class="ds-client-file__identity">');
  const contactEnd = selected.indexOf('</section>', identityStart);
  const externalAt = selected.indexOf('\${externalClientDocumentsHtml(canManage)}');
  const asideAt = selected.indexOf('<aside class="ds-client-file__proposals">');
  assert.ok(rightStart >= 0 && identityStart > rightStart);
  assert.ok(contactEnd > identityStart && externalAt > contactEnd && asideAt > externalAt);
  assert.match(layout, /ds-client-file\.is-layout-polished > \.ds-client-file__contacts-column\s*\{[^}]*grid-column: 2/);
  assert.match(layout, /ds-client-file\.is-layout-polished > \.ds-client-file__contacts-column > \.ds-client-file__identity\s*\{[^}]*width: 100%/);
  assert.match(layout, /ds-client-file\.is-layout-polished > \.ds-client-file__contacts-column > \.ds-client-external\s*\{[^}]*width: 100%/);
  assert.match(layout, /@media \(max-width: 1000px\)/);
});

test('layout polisher preserves external upload panel while moving title to header', async () => {
  const js = await readFile(new URL('../frontend/src/screens/client-file-layout-polish.js', import.meta.url), 'utf8');
  const preamble = js.slice(0, js.indexOf("if (document.readyState === 'loading')"));
  assert.ok(preamble.length && preamble.length < js.length);
  const dom = new JSDOM('<main id="app"><div class="ds-client-file">' +
    '<button data-pa-client-close>✕</button>' +
    '<div class="ds-client-file__contacts-column">' +
    '<section class="ds-client-file__identity"><h2 class="ds-client-file__title">בית ספר</h2>' +
    '<p><span>תחום</span><strong>E</strong></p><div class="ds-client-file__contacts-head"><h3>אנשי קשר</h3></div>' +
    '<div class="ds-client-contacts"></div></section>' +
    externalClientDocumentsHtml(true) +
    '</div>' +
    '<aside class="ds-client-file__proposals"><div class="ds-client-file__proposals-head">' +
    '<h3>הצעות עדכניות</h3><button data-pa-client-add-proposal>הצעה חדשה</button></div>' +
    '<details class="ds-client-archive"><summary>ארכיון הצעות מחיר — 0</summary></details>' +
    '</aside></div></main>', { url: 'http://localhost/' });
  const { polishClientFile } = new Function('document', preamble + '; return {polishClientFile};')(dom.window.document);
  const file = dom.window.document.querySelector('.ds-client-file');
  polishClientFile(file);
  assert.ok(file.classList.contains('is-layout-polished'));
  assert.ok(file.querySelector(':scope > .ds-client-file__header .ds-client-file__title'));
  const column = file.querySelector(':scope > .ds-client-file__contacts-column');
  assert.deepEqual(Array.from(column.children).map(x => x.className), ['ds-client-file__identity', 'ds-client-external']);
  assert.ok(column.children[1].querySelector('[data-ext-add]'));
  assert.ok(file.querySelector(':scope > .ds-client-file__proposals'));
  assert.equal(file.querySelectorAll('[data-pa-external-documents]').length, 1);
  polishClientFile(file);
  assert.equal(file.querySelectorAll('[data-pa-external-documents]').length, 1);
});

async function withMockPdfForm({ failUpload = false, failInsert = false, isManager = true } = {}, evaluate) {
  const dom = new JSDOM('<div id="app">' + externalClientDocumentsHtml(isManager) + '</div>', { url: 'https://dashboard.example.test/' });
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    FormData: globalThis.FormData,
  };
  const calls = { uploads: [], inserts: [], removals: [], signedLinks: [], selections: [] };
  const items = [];
  const fakePdf = { name: 'הסכם חיצוני.pdf', type: 'application/pdf', size: 842 };
  const client = {
    from(table) {
      assert.equal(table, 'client_external_documents');
      return {
        select: columns => ({
          eq: (field, key) => ({
            order: async () => {
              calls.selections.push({ columns, field, key });
              return { data: items.filter(row => row.client_key === key), error: null };
            }
          })
        }),
        insert: async value => {
          calls.inserts.push(value);
          if (failInsert) return { error: new Error('failed to insert metadata') };
          items.push({ ...value, created_at: new Date().toISOString() });
          return { data: null, error: null };
        },
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: null })
          })
        })
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'client-external-documents');
        return {
          upload: async (path, file, options) => {
            calls.uploads.push({ path, file, options });
            return { error: failUpload ? new Error('upload failed') : null };
          },
          remove: async paths => {
            calls.removals.push(paths);
            return { error: null };
          },
          createSignedUrl: async (path, duration) => {
            calls.signedLinks.push({ path, duration });
            return { data: { signedUrl: 'https://signed.example.test/' + path }, error: null };
          }
        };
      }
    }
  };
  dom.window.open = () => ({ opener: null, closed: false, location: { replace: url => { calls.viewedUrl = url; } }, close() {} });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.FormData = class {
    constructor(form) { this.form = form; }
    get(key) {
      if (key === 'document_file') return fakePdf;
      return this.form.querySelector('[name="' + key + '"]')?.value ?? null;
    }
  };
  try {
    await mountClientExternalDocuments(dom.window.document, { key: 'school:123456' }, { canManage: isManager, client });
    if (isManager) {
      const button = dom.window.document.querySelector('[data-ext-add]');
      button.click();
      const form = dom.window.document.querySelector('[data-ext-form]');
      assert.ok(form, 'upload form must open');
      form.querySelector('[name="title"]').value = 'קורס לדוגמה';
      form.querySelector('[name="document_kind"]').value = 'quote';
      form.querySelector('[name="amount"]').value = '8000';
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await evaluate({ root: dom.window.document, calls, items, fakePdf });
  } finally {
    globalThis.document = original.document;
    globalThis.window = original.window;
    globalThis.FormData = original.FormData;
    dom.window.close();
  }
}

test('PDF upload uploads private file, persists matching client metadata, refreshes and opens signed PDF', async () => {
  await withMockPdfForm({}, async ({ root, calls, items, fakePdf }) => {
    assert.equal(calls.uploads.length, 1, 'one PDF upload');
    assert.equal(calls.uploads[0].file, fakePdf);
    assert.match(calls.uploads[0].path, /^documents\/[a-f0-9-]{36}\.pdf$/);
    assert.deepEqual(calls.uploads[0].options, { contentType: 'application/pdf', upsert: false });
    assert.equal(calls.inserts.length, 1);
    assert.equal(calls.inserts[0].client_key, 'school:123456');
    assert.equal(calls.inserts[0].file_path, calls.uploads[0].path);
    assert.equal(calls.inserts[0].amount, 8000);
    assert.equal(calls.inserts[0].document_kind, 'quote');
    assert.equal(calls.inserts[0].title, 'קורס לדוגמה');
    assert.equal(items.length, 1);
    assert.equal(calls.removals.length, 0);
    assert.match(root.querySelector('[data-ext-list]').textContent, /קורס לדוגמה/);
    root.querySelector('[data-ext-view]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.signedLinks.length, 1);
    assert.equal(calls.signedLinks[0].path, calls.uploads[0].path);
    assert.equal(calls.signedLinks[0].duration, 90);
    assert.match(calls.viewedUrl, /^https:\/\/signed.example.test\//);
  });
});

test('failed PDF upload saves no document metadata and surfaces a clear error', async () => {
  await withMockPdfForm({ failUpload: true }, async ({ root, calls, items }) => {
    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.inserts.length, 0);
    assert.equal(items.length, 0);
    assert.match(root.querySelector('[data-ext-error]').textContent, /שמירת המסמך נכשלה/);
    assert.equal(root.querySelector('[data-ext-save]').disabled, false);
  });
});

test('failed metadata insert cleans uploaded PDF and does not report success', async () => {
  await withMockPdfForm({ failInsert: true }, async ({ root, calls, items }) => {
    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.inserts.length, 1);
    assert.deepEqual(calls.removals, [[calls.uploads[0].path]]);
    assert.equal(items.length, 0);
    assert.match(root.querySelector('[data-ext-error]').textContent, /שמירת המסמך נכשלה/);
  });
});

test('non-managers cannot open upload form and no upload occurs', async () => {
  await withMockPdfForm({ isManager: false }, async ({ root, calls }) => {
    assert.equal(root.querySelector('[data-ext-add]'), null);
    assert.equal(calls.uploads.length, 0);
    assert.equal(calls.inserts.length, 0);
  });
});
