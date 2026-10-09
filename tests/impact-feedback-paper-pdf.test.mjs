import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewUrl = new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url);
const apiUrl = new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url);
const sqlUrl = new URL('../supabase/migrations/20261009053000_feedback_template_saved_pdfs.sql', import.meta.url);

test('five PDF controls only download stored, version-current documents', async () => {
  const [view, api] = await Promise.all([readFile(viewUrl, 'utf8'), readFile(apiUrl, 'utf8')]);
  assert.match(view, /const outdated = Boolean\(file && file\.version_id !== template\.current_version_id\)/);
  assert.match(view, /data-tpl-pdf=/);
  assert.match(view, /upToDate \? '' : 'disabled'/);
  assert.match(view, /await downloadSavedPaperPdf\(record\)/);
  assert.doesNotMatch(view, /import\('\.\/feedback-print-pdf\.js'\)/);
  assert.match(api, /createSignedUrl\(record\.storage_path, 60\)/);
  assert.match(api, /URL\.createObjectURL\(file\)/);
});

test('admin can upload, replace and remove private PDFs, without creating digital responses', async () => {
  const [view, api] = await Promise.all([readFile(viewUrl, 'utf8'), readFile(apiUrl, 'utf8')]);
  assert.match(view, /data-tpl-upload=/);
  assert.match(view, /data-tpl-delete=/);
  assert.match(view, /await uploadSavedPaperPdf\(template, file, upload\.dataset\.tplLang\)/);
  assert.match(view, /await deleteSavedPaperPdf\(record\)/);
  assert.match(api, /application\/pdf/);
  assert.match(api, /String\.fromCharCode\(\.\.\.signature\) !== '%PDF-'/);
  assert.match(api, /upsert\(\{/);
  assert.match(api, /onConflict: 'template_id,language'/);
  assert.doesNotMatch(api, /feedback_public_submit/);
});

test('only administrators may write metadata and Storage objects', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  assert.match(sql, /public\.feedback_template_pdfs/);
  assert.match(sql, /feedback_pdf_version_mismatch/);
  assert.match(sql, /new\.version_id/);
  assert.match(sql, /private\.feedback_is_admin\(\)/);
  assert.match(sql, /alter table public\.feedback_template_pdfs enable row level security/);
  assert.match(sql, /feedback_template_pdfs_admin_insert/);
  assert.match(sql, /feedback_template_pdfs_admin_update/);
  assert.match(sql, /feedback_template_pdfs_admin_delete/);
  assert.match(sql, /feedback_template_pdf_insert_admin on storage\.objects/);
  assert.match(sql, /feedback_template_pdf_delete_admin on storage\.objects/);
  assert.match(sql, /'feedback-template-pdfs', false, 10485760/);
});

test('saved PDF behavior does not change the six feedback tabs or WhatsApp and email', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
  const view = await readFile(viewUrl, 'utf8');
  const css = await readFile(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
  assert.match(screen, /key: 'templates', label: 'תבניות'/);
  assert.equal((screen.match(/renderTemplatesView\(ui/g) || []).length, 1);
  assert.match(screen, /data-ifb-share="whatsapp"/);
  assert.match(screen, /data-ifb-share="email"/);
  assert.match(screen, /data-ifb-qr/);
  assert.match(view, /ifb-template-card__warning/);
  assert.match(css, /max-width: min\(100%, 1320px\)/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 240px\), 1fr\)\)/);
  assert.match(css, /\.ifb-template-grid\s*\{[^}]*margin-inline: auto/s);
  assert.match(css, /\.ifb-view \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.ifb-view > \[data-ifb-templates\]/);
  assert.match(css, /\.ifb-template-card__slot\s*\{[^}]*width: 100%/s);
  assert.match(css, /\.ifb-template-card__open,[\s\S]*?text-align: center/);
  assert.match(css, /ifb-template-card__upload/);
});


test('printable Hebrew and Arabic PDFs are keyed independently, and existing Hebrew records are preserved', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261010114500_feedback_template_pdfs_two_languages.sql', import.meta.url), 'utf8');
  const [view, api, css] = await Promise.all([
    readFile(viewUrl, 'utf8'),
    readFile(apiUrl, 'utf8'),
    readFile(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8')
  ]);
  assert.match(sql, /add column if not exists language text not null default 'he'/);
  assert.match(sql, /check \(language in \('he', 'ar'\)\)/);
  assert.match(sql, /primary key \(template_id, language\)/);
  assert.doesNotMatch(sql, /drop table|delete from public\.feedback_template_pdfs/i);
  assert.match(api, /select\('template_id,language,version_id,storage_path,file_name,uploaded_at'\)/);
  assert.match(api, /export async function uploadSavedPaperPdf\(template, file, language = 'he'\)/);
  assert.match(api, /\.eq\('template_id', template\.id\)\.eq\('language', language\)\.maybeSingle\(\)/);
  assert.match(api, /onConflict: 'template_id,language'/);
  assert.match(api, /\.eq\('template_id', record\.template_id\)\.eq\('language', record\.language\)/);
  assert.match(view, /data-tpl-lang="\$\{language\}"/);
  assert.match(view, /item\.template_id === template\?\.id && item\.language === pdf\.dataset\.tplLang/);
  assert.match(view, /item\.template_id === template\?\.id && item\.language === remove\.dataset\.tplLang/);
  assert.match(view, /languageControls\('he'\)/);
  assert.match(view, /languageControls\('ar'\)/);
  assert.match(view, /<span lang="he">עברית<\/span><span lang="ar">ערבית<\/span>/);
  assert.match(css, /\.ifb-admin \.ifb-template-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.ifb-admin \.ifb-template-card__language-headings,[\s\S]*?column-gap: 3px;/);
  assert.match(css, /@media \(max-width: 680px\) \{\s*\.ifb-admin \.ifb-template-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(api, /feedback_public_submit/);
});
