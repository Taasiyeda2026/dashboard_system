import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_FILE_RULES,
  GEFEN_DOC_MAX_BYTES,
  fileRuleForArea,
  makeLinkedDocument,
  normalizeDocuments,
  primaryDocumentUrl,
  renderDocumentUploader,
  validateUploadFile
} from '../frontend/src/gefen-tender/document-upload.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('admin file rules enforce 5MB and typed accepts for key sections', () => {
  assert.equal(ADMIN_FILE_RULES[1].maxBytes, GEFEN_DOC_MAX_BYTES);
  assert.deepEqual(ADMIN_FILE_RULES[3].accept, ['.pdf']);
  assert.equal(ADMIN_FILE_RULES[5].multiple, true);
  assert.equal(ADMIN_FILE_RULES[12].multiple, false);
  const rule = fileRuleForArea('administrative', 3);
  assert.equal(rule.accept.includes('.pdf'), true);
  assert.equal(rule.accept.includes('.docx'), false);
});

test('validateUploadFile rejects oversized and wrong-type files', () => {
  const rule = fileRuleForArea('administrative', 3);
  assert.throws(
    () => validateUploadFile({ name: 'a.pdf', size: GEFEN_DOC_MAX_BYTES + 1, type: 'application/pdf' }, rule),
    /5MB/
  );
  assert.throws(
    () => validateUploadFile({ name: 'a.docx', size: 100, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, rule),
    /לא מורשה/
  );
  assert.doesNotThrow(() => validateUploadFile({ name: 'ok.pdf', size: 1024, type: 'application/pdf' }, rule));
});

test('normalizeDocuments upgrades legacy url strings and objects', () => {
  const fromUrl = normalizeDocuments('https://sharepoint.example/file.pdf');
  assert.equal(fromUrl.length, 1);
  assert.equal(fromUrl[0].url, 'https://sharepoint.example/file.pdf');
  assert.equal(fromUrl[0].source, 'link');

  const fromObj = normalizeDocuments({ name: 'a.pdf', url: 'https://x/a.pdf' });
  assert.equal(fromObj.length, 1);
  assert.equal(primaryDocumentUrl(fromObj), 'https://x/a.pdf');
});

test('makeLinkedDocument keeps SharePoint link option', () => {
  const doc = makeLinkedDocument('https://think365orgil.sharepoint.com/sites/x/doc.pdf', 'אישור');
  assert.equal(doc.source, 'link');
  assert.equal(doc.name, 'אישור');
  assert.equal(doc.url.includes('sharepoint.com'), true);
  assert.throws(() => makeLinkedDocument(''), /קישור/);
});

test('renderDocumentUploader is compact and exposes open/replace/unlink hooks', () => {
  const html = renderDocumentUploader({
    docs: [{
      name: 'תצהיר.pdf',
      url: 'https://example.com/t.pdf',
      uploaded_at: '2026-11-27T10:00:00.000Z',
      source: 'upload'
    }],
    area: 'administrative',
    scopeKey: 'admin:3',
    sectionNumber: 3
  });
  assert.match(html, /gt-upload/);
  assert.match(html, /data-doc-drop="admin:3"/);
  assert.match(html, /data-doc-pick="admin:3"/);
  assert.match(html, /data-doc-replace="admin:3"/);
  assert.match(html, /data-doc-unlink="admin:3"/);
  assert.match(html, /פתיחה/);
  assert.match(html, /הורדה/);
  assert.match(html, /החלפה/);
  assert.match(html, /הסרת שיוך/);
  assert.match(html, /קישור SharePoint/);
  assert.match(html, /accept="\.pdf"/);
  assert.doesNotMatch(html, /הושלם אוטומטית/);
});

test('edge function keeps Graph credentials server-side and maps tender folders', () => {
  const src = readFileSync(join(root, 'supabase/functions/gefen-tender-sharepoint/index.ts'), 'utf8');
  assert.match(src, /MS_TENANT_ID/);
  assert.match(src, /MS_CLIENT_SECRET/);
  assert.match(src, /assertAdmin/);
  assert.match(src, /11 - טופס מנהלי והצהרות/);
  assert.match(src, /05 - המלצות/);
  assert.match(src, /07 - ניסיון בהפעלת תוכניות/);
  assert.match(src, /06 - מפתחים ומפעילים/);
  assert.match(src, /08 - אישורים ואסמכתאות/);
  assert.match(src, /\/items\/\$\{encodeURIComponent\(folder\.id\)\}/);
  assert.equal(/client_secret:\s*["'][^$"']+["']/.test(src), false);
});

test('screen wires upload zones across admin program operator and documents tabs', () => {
  const src = readFileSync(join(root, 'frontend/src/screens/gefen-tender-2027.js'), 'utf8');
  assert.match(src, /renderDocumentUploader/);
  assert.match(src, /scopeKey: `admin:\$\{n\}`/);
  assert.match(src, /experience_documents/);
  assert.match(src, /recommendations_documents/);
  assert.match(src, /scopeKey: `operator:\$\{row\.id\}`/);
  assert.match(src, /data-doc-drop/);
  assert.match(src, /העלאת מסמך אינה מסמנת את הסעיף כהושלם/);
  assert.match(src, /section\.documents = normalizeDocuments/);
  assert.doesNotMatch(src, /section\.status\s*=\s*['"]הושלם['"]/);
});
