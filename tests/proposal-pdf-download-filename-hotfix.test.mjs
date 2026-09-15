import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  proposalPdfDownloadUrl,
  proposalPdfPreferredDownloadFileName
} from '../frontend/src/proposal-pdf-download-filename-hotfix.js';

const source = await readFile(new URL('../frontend/src/proposal-pdf-download-filename-hotfix.js', import.meta.url), 'utf8');

test('school proposal downloads use quote plus school name only', () => {
  const documentRef = {
    title: 'Dashboard',
    querySelectorAll(selector) {
      if (selector === '.proposal-preview-area') {
        return [{
          querySelector() {
            return { textContent: 'בית ספר: רמון | סמל מוסד: 415992 | רשות: באר יעקב' };
          }
        }];
      }
      return [];
    }
  };

  assert.equal(
    proposalPdfPreferredDownloadFileName(documentRef, 'proposal-random-123.pdf'),
    'הצעת מחיר רמון.pdf'
  );
});

test('signed storage download URL receives the readable filename', () => {
  const url = proposalPdfDownloadUrl(
    'https://example.supabase.co/storage/v1/object/sign/proposal-final-pdfs/random.pdf?token=abc',
    'הצעת מחיר רמון.pdf',
    'https://taasiyeda2026.github.io/dashboard_system/'
  );
  assert.equal(new URL(url).searchParams.get('download'), 'הצעת מחיר רמון.pdf');
});

test('generated PDF blob path triggers a named browser download and still returns the object URL', () => {
  assert.match(source, /closest\('\[data-pa-print\]'\)/);
  assert.match(source, /String\(value\?\.type \|\| ''\)\.toLowerCase\(\) === 'application\/pdf'/);
  assert.match(source, /anchor\.download = fileName/);
  assert.match(source, /return objectUrl/);
});
