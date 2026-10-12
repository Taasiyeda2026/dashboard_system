import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isElementaryPaperTemplate } from '../frontend/src/impact-feedback/feedback-paper-pdf-eligibility.js';

const template = (program_key, audience = 'student', stage = 'pre') => ({ program_key, audience, stage });
const elementary = { key: 'biomimicry', education_level: 'elementary' };
const secondary = { key: 'biomimicry_secondary', education_level: 'secondary' };

test('paper PDFs are elementary student pre/post only (including same-title secondary courses)', () => {
  assert.equal(isElementaryPaperTemplate(template('biomimicry'), elementary), true);
  assert.equal(isElementaryPaperTemplate(template('biomimicry', 'student', 'post'), elementary), true);
  assert.equal(isElementaryPaperTemplate(template('biomimicry_secondary'), secondary), false);
  assert.equal(isElementaryPaperTemplate(template('biomimicry', 'instructor'), elementary), false);
  assert.equal(isElementaryPaperTemplate(template('biomimicry', 'educational_staff', 'final'), elementary), false);
  assert.equal(isElementaryPaperTemplate(template('biomimicry'), secondary), false);
  assert.equal(isElementaryPaperTemplate(template('biomimicry'), null), false);
});

test('templates list and all PDF handlers honor the eligibility rule', async () => {
  const view = await readFile(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
  assert.match(view, /const canUsePaperPdf = isElementaryPaperTemplate\(template, program\)/);
  assert.match(view, /canUsePaperPdf \? '' : ' is-digital'/);
  assert.ok(view.includes("canUsePaperPdf ? "));
  assert.ok(view.includes("program.education_level === 'elementary'"));
  assert.match(view, /data-tpl-open/);
  assert.equal((view.match(/isElementaryPaperTemplate\(template, ui\.programs\.find/g) || []).length, 3);
});

test('client and database both reject non-elementary PDF upload and Storage access', async () => {
  const api = await readFile(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
  const sql = await readFile(new URL('../supabase/migrations/20261012100500_feedback_paper_pdf_elementary_student_only.sql', import.meta.url), 'utf8');
  assert.match(api, /if \(!isElementaryPaperTemplate\(template, program\)\) throw new Error\('feedback_pdf_elementary_only'\)/);
  assert.match(sql, /p\.education_level = 'elementary'/);
  assert.match(sql, /t\.audience = 'student'/);
  assert.match(sql, /private\.feedback_is_elementary_student_template\(new\.template_id::text\)/);
  assert.match(sql, /feedback_template_pdf_insert_admin on storage\.objects/);
  assert.match(sql, /feedback_template_pdf_read_pilot on storage\.objects/);
  assert.match(sql, /feedback_template_pdfs_admin_insert on public\.feedback_template_pdfs/);
  assert.doesNotMatch(sql, /delete from public\.feedback_templates|delete from public\.feedback_template_versions/i);
});
