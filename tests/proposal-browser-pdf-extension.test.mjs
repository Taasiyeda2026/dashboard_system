import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureProposalPdfPrintParityStyles, proposalPdfFileFromBase64 } from '../frontend/src/proposal-browser-pdf-extension.js';

const manifest = JSON.parse(await readFile(new URL('../browser-extension/proposal-pdf/manifest.json', import.meta.url), 'utf8'));
const background = await readFile(new URL('../browser-extension/proposal-pdf/background.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../browser-extension/proposal-pdf/content.js', import.meta.url), 'utf8');

test('extension is Manifest V3 and restricted to the Taasiyeda dashboard', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['debugger']);
  assert.deepEqual(manifest.host_permissions, ['https://taasiyeda2026.github.io/dashboard_system/*']);
  assert.deepEqual(manifest.content_scripts?.[0]?.matches, ['https://taasiyeda2026.github.io/dashboard_system/*']);
});

test('extension delegates PDF creation to Chromium printToPDF with proposal print settings', () => {
  assert.match(background, /Page\.printToPDF/);
  assert.match(background, /printBackground:\s*true/);
  assert.match(background, /preferCSSPageSize:\s*true/);
  assert.match(background, /paperWidth:\s*8\.27/);
  assert.match(background, /paperHeight:\s*11\.69/);
  assert.match(background, /ALLOWED_ORIGIN = 'https:\/\/taasiyeda2026\.github\.io'/);
  assert.match(background, /ALLOWED_PATH_PREFIX = '\/dashboard_system\/'/);
});

test('extension switches Chromium to print media and waits for the rendered proposal before printToPDF', () => {
  assert.match(background, /Runtime\.evaluate/);
  assert.match(background, /\.proposal-preview-area \.proposal-document/);
  assert.match(background, /document\.fonts\?\.ready/);
  assert.match(background, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(background, /Emulation\.setEmulatedMedia', \{ media: 'print' \}/);
  assert.match(background, /proposal_pdf_diagnostic_empty_text/);
  assert.match(background, /proposal_pdf_diagnostic_zero_size/);
  assert.match(background, /proposal_pdf_diagnostic_missing_after_print_media/);

  const printMediaIndex = background.indexOf("'Emulation.setEmulatedMedia', { media: 'print' }");
  const printToPdfIndex = background.indexOf("'Page.printToPDF'");
  assert.ok(printMediaIndex >= 0, 'print media emulation must be present');
  assert.ok(printToPdfIndex > printMediaIndex, 'print media must be enabled before Page.printToPDF');
});

test('extension restores the media override and detaches the debugger in cleanup', () => {
  assert.match(background, /mediaOverridden/);
  assert.match(background, /Emulation\.setEmulatedMedia', \{ media: '' \}/);
  assert.match(background, /detachDebugger\(target\)/);
  assert.match(background, /finally \{/);
});

test('PDF parity style keeps GEFEN school, symbol and authority metadata on one print line', () => {
  const appended = [];
  const fakeDocument = {
    getElementById() { return null; },
    createElement() { return { id: '', textContent: '' }; },
    head: { appendChild(node) { appended.push(node); } }
  };

  ensureProposalPdfPrintParityStyles(fakeDocument);

  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'taasiyeda-proposal-pdf-print-parity');
  assert.match(appended[0].textContent, /\.pa-gefen-school-meta/);
  assert.match(appended[0].textContent, /white-space:\s*nowrap\s*!important/);
});

test('content bridge exposes no Supabase key or storage credentials', () => {
  assert.match(content, /chrome\.runtime\.sendMessage/);
  assert.match(content, /TAASIYEDA_PROPOSAL_PRINT_TO_PDF/);
  assert.doesNotMatch(content, /supabase/i);
  assert.doesNotMatch(background, /service_role|anon[_-]?key|supabase[_-]?key/i);
});

test('dashboard bridge validates that returned bytes are a real PDF', async () => {
  const bytes = Buffer.from('%PDF-1.7\nTaasiyeda\n', 'utf8');
  const scope = {
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    Blob,
    File: globalThis.File
  };
  const file = proposalPdfFileFromBase64(bytes.toString('base64'), 'הצעת מחיר כרמים.pdf', scope);
  assert.equal(file.type, 'application/pdf');
  assert.equal(file.size, bytes.length);
  assert.match(String(file.name || ''), /הצעת מחיר כרמים\.pdf/);
});

test('dashboard bridge rejects non-PDF payloads', () => {
  const bytes = Buffer.from('not-a-pdf', 'utf8');
  const scope = {
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    Blob,
    File: globalThis.File
  };
  assert.throws(
    () => proposalPdfFileFromBase64(bytes.toString('base64'), 'bad.pdf', scope),
    /proposal_pdf_invalid_signature/
  );
});
