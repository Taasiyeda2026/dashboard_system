import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installProposalPdfStorageKeyHotfix,
  proposalPdfFileWithSafeStorageName,
  proposalPdfSafeStorageFileName
} from '../frontend/src/proposal-pdf-storage-key-hotfix.js';

class FakeFile {
  constructor(parts = [], name = '', options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = String(options.type || '');
    this.lastModified = Number(options.lastModified) || 0;
    this.size = parts.reduce((total, part) => total + Number(part?.size || String(part || '').length), 0);
  }
}

test('proposal PDF storage file names contain ASCII-safe characters only', () => {
  const name = proposalPdfSafeStorageFileName('6f2578ca-ca99-4ff2-8f19-8c69d51cdf25', 1721528400000);
  assert.equal(name, 'proposal-6f2578ca-ca99-4ff2-8f19-8c69d51cdf25-1721528400000.pdf');
  assert.match(name, /^[a-zA-Z0-9._-]+$/);
  assert.doesNotMatch(name, /[\u0590-\u05FF\s/\\]/);
});

test('Hebrew display filenames are replaced only for the storage upload payload', async () => {
  const calls = [];
  const fakeApi = {
    async uploadProposalFinalPdf(id, payload) {
      calls.push({ method: 'upload', id, payload });
      return { ok: true };
    },
    async lockAndSendProposalAgreement(id, payload) {
      calls.push({ method: 'send', id, payload });
      return { ok: true };
    }
  };
  const scope = { File: FakeFile };

  assert.equal(installProposalPdfStorageKeyHotfix(fakeApi, scope), true);
  assert.equal(installProposalPdfStorageKeyHotfix(fakeApi, scope), false);

  const original = new FakeFile(['%PDF-test'], 'הצעת_מחיר_אום_אל-פחם_תשפ״ז.pdf', {
    type: 'application/pdf',
    lastModified: 123
  });

  await fakeApi.uploadProposalFinalPdf('proposal-1', { pdfFile: original, documentSnapshot: {}, documentHtmlSnapshot: '<main></main>' });
  await fakeApi.lockAndSendProposalAgreement('proposal-2', { file: original, documentSnapshot: {}, documentHtmlSnapshot: '<main></main>' });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const uploaded = call.payload.pdfFile;
    assert.ok(uploaded instanceof FakeFile);
    assert.notEqual(uploaded, original);
    assert.equal(uploaded.type, 'application/pdf');
    assert.match(uploaded.name, /^[a-zA-Z0-9._-]+\.pdf$/);
    assert.doesNotMatch(uploaded.name, /[\u0590-\u05FF\s/\\]/);
    assert.equal(call.payload.file, uploaded);
  }

  assert.equal(original.name, 'הצעת_מחיר_אום_אל-פחם_תשפ״ז.pdf');
});

test('an already safe PDF filename is reused without cloning', () => {
  const original = new FakeFile(['%PDF-test'], 'proposal-safe.pdf', { type: 'application/pdf' });
  assert.equal(proposalPdfFileWithSafeStorageName(original, 'proposal-3', { File: FakeFile }), original);
});
