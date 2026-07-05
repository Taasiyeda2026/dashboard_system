#!/usr/bin/env node
/**
 * Generate real Chromium PDFs for proposal fixtures and verify page-1 content
 * and footer vertical position. See docs/proposal-print-layout.md.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_TOP_MM = 10;
const PAGE_MARGIN_BOTTOM_MM = 10;
const PRINTABLE_HEIGHT_MM = A4_HEIGHT_MM - PAGE_MARGIN_TOP_MM - PAGE_MARGIN_BOTTOM_MM;

function findBuiltCss() {
  const assetsDir = join(root, 'dist', 'assets');
  const cssFile = readdirSync(assetsDir).find((name) => /^style-.*\.css$/.test(name));
  if (!cssFile) throw new Error('Built CSS not found — run npm run build first');
  return readFileSync(join(assetsDir, cssFile), 'utf8');
}

function wrapProposalHtml(documentHtml, cssText) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>Proposal print verify</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap" rel="stylesheet">
  <style>${cssText}</style>
</head>
<body>${documentHtml}</body>
</html>`;
}

async function loadProposalModule() {
  return import(join(root, 'frontend', 'src', 'screens', 'proposals-agreements.js'));
}

function makeRow(overrides = {}) {
  return {
    id: 'verify-proposal-row',
    client_authority: 'רשות לדוגמה',
    school_framework: 'בית ספר לדוגמה',
    document_type: 'הצעת מחיר',
    activity_type_group: 'פעילויות קיץ',
    status: 'approved',
    proposal_date: '2026-07-01',
    contact_name: 'דנה קשר',
    contact_role: 'מנהלת',
    phone: '050-1111111',
    email: 'dana@example.com',
    approved_by: 'עידן נחום',
    approved_at: '2026-07-02T10:00:00.000Z',
    signature_meta: { signer_name: 'עידן נחום' },
    ...overrides
  };
}

function shortItems() {
  return [{
    item_name: 'סדנת רובוטיקה',
    proposal_group: 'summer',
    quantity: 1,
    unit_price: 1200,
    total_price: 1200
  }];
}

function mediumItems() {
  return Array.from({ length: 6 }, (_, index) => ({
    item_name: `פעילות ${index + 1}`,
    proposal_group: 'summer',
    quantity: 2,
    unit_price: 900 + index * 50,
    total_price: (900 + index * 50) * 2
  }));
}

function longItems() {
  return Array.from({ length: 28 }, (_, index) => ({
    item_name: `פעילות ארוכה מספר ${index + 1} עם תיאור נוסף`,
    proposal_group: 'summer',
    quantity: 3,
    unit_price: 750 + index * 25,
    total_price: (750 + index * 25) * 3
  }));
}

const templateSections = [
  { section_key: 'intro', section_title: 'פתיח', section_body: 'שלום רב,\n\nאנו שמחים להציע לכם את הפעילויות הבאות.' },
  { section_key: 'activity_intro', section_title: 'פעילויות', section_body: 'פירוט הפעילויות המוצעות לבית הספר.' },
  { section_key: 'payment_terms', section_title: 'תנאי תשלום', section_body: 'התשלום יבוצע בתוך 30 יום ממועד החתימה.' },
  { section_key: 'org_responsibility', section_title: 'אחריות הארגון', section_body: 'הארגון יספק ציוד ומדריך מוסמך.' },
  { section_key: 'school_responsibility', section_title: 'אחריות בית הספר', section_body: 'בית הספר ידאג לליווי ולתיאום מול המדריך.' },
  { section_key: 'changes_cancellation', section_title: 'שינויים וביטולים', section_body: 'ביטול עד 14 יום לפני המועד ללא חיוב.' },
  { section_key: 'notes', section_title: 'הערות', section_body: 'ההצעה תקפה ל-30 יום.' },
  { section_key: 'signature', section_title: 'חתימה', section_body: 'בברכה,' }
];

async function analyzeFixture(playwright, html, outPath) {
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const layout = await page.evaluate((printableHeightMm) => {
      const doc = document.querySelector('.proposal-document');
      const footer = document.querySelector('.pa-page-footer');
      const gap = document.querySelector('.pa-page-footer-gap');
      const body = document.body;
      const docRect = doc.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const gapStyles = gap ? getComputedStyle(gap) : null;
      const footerStyles = footer ? getComputedStyle(footer) : null;
      const pxPerMm = docRect.width > 0 ? docRect.width / 178 : 96 / 25.4;
      const docHeightMm = doc.scrollHeight / pxPerMm;
      const footerTopMm = (footerRect.top - docRect.top) / pxPerMm;
      const footerBottomMm = (footerRect.bottom - docRect.top) / pxPerMm;
      const gapHeightMm = gap ? gap.offsetHeight / pxPerMm : 0;
      const pageCountEstimate = Math.max(1, Math.ceil(docHeightMm / printableHeightMm));
      const footerFromPageBottomMm = printableHeightMm - footerBottomMm;
      return {
        hasLekavod: body.textContent.includes('לכבוד'),
        hasTitle: /הצעת מחיר|הסכם/.test(body.textContent),
        hasFooter: body.textContent.includes('think.org.il'),
        footerPosition: footerStyles?.position || '',
        gapMinHeight: gapStyles?.minHeight || '',
        gapHeightMm,
        docHeightMm,
        footerTopMm,
        footerBottomMm,
        footerFromPageBottomMm,
        pageCountEstimate
      };
    }, PRINTABLE_HEIGHT_MM);

    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(readFileSync(outPath));
    const pdfDoc = await pdfjs.getDocument({ data }).promise;
    const pdfPageCount = pdfDoc.numPages;

    return { ...layout, pdfPageCount };
  } finally {
    await browser.close();
  }
}

async function main() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('playwright is required for this script: npm install --no-save playwright');
    process.exit(1);
  }

  const { proposalPreviewBodyHtml } = await loadProposalModule();
  const cssText = findBuiltCss();
  const outDir = join(root, 'artifacts', 'proposal-print-verify');
  mkdirSync(outDir, { recursive: true });

  const fixtures = [
    { name: 'short', row: makeRow(), items: shortItems() },
    { name: 'short-next-year', row: makeRow({ activity_type_group: 'שנת הלימודים תשפ״ז' }), items: shortItems().map((item) => ({ ...item, proposal_group: 'שנת הלימודים תשפ״ז' })) },
    { name: 'medium', row: makeRow(), items: mediumItems() },
    { name: 'long', row: makeRow(), items: longItems() }
  ];

  const results = [];
  for (const fixture of fixtures) {
    const documentHtml = proposalPreviewBodyHtml(fixture.row, fixture.items, templateSections);
    const html = wrapProposalHtml(documentHtml, cssText);
    const pdfPath = join(outDir, `${fixture.name}.pdf`);
    const analysis = await analyzeFixture(playwright, html, pdfPath);
    results.push({ fixture: fixture.name, pdfPath, ...analysis });
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));

  let failed = false;
  for (const result of results) {
    console.log(`\n[${result.fixture}] pdfPages=${result.pdfPageCount} doc≈${result.docHeightMm.toFixed(1)}mm footerBottom≈${result.footerBottomMm.toFixed(1)}mm gap≈${result.gapHeightMm.toFixed(1)}mm (${result.gapMinHeight})`);
    console.log(`  footer position: ${result.footerPosition}`);
    console.log(`  page-1 markers: לכבוד=${result.hasLekavod} title=${result.hasTitle} footer=${result.hasFooter}`);

    if (!result.hasLekavod || !result.hasTitle || !result.hasFooter) {
      console.error(`  FAIL: missing expected document markers`);
      failed = true;
    }
    if (result.footerPosition === 'fixed') {
      console.error('  FAIL: footer must not use position:fixed');
      failed = true;
    }
    if (result.fixture === 'short' || result.fixture === 'short-next-year') {
      if (result.pdfPageCount !== 1) {
        console.error(`  FAIL: short proposal should stay on one page (got ${result.pdfPageCount})`);
        failed = true;
      }
      if (result.gapHeightMm > 1) {
        console.error(`  FAIL: short proposal footer gap must not reserve page height (got ${result.gapHeightMm.toFixed(1)}mm)`);
        failed = true;
      }
      if (result.footerBottomMm >= PRINTABLE_HEIGHT_MM) {
        console.error(`  FAIL: short proposal footer must stay on page 1 (footerBottom=${result.footerBottomMm.toFixed(1)}mm)`);
        failed = true;
      }
      if (result.footerFromPageBottomMm > 20) {
        console.error(`  FAIL: short proposal footer should sit near page bottom (footerFromPageBottom=${result.footerFromPageBottomMm.toFixed(1)}mm)`);
        failed = true;
      }
    }
    if (result.fixture === 'medium' && result.pdfPageCount > 2) {
      console.error(`  FAIL: medium proposal should not explode past 2 pages (got ${result.pdfPageCount})`);
      failed = true;
    }
    if (result.fixture === 'long' && result.pdfPageCount < 2) {
      console.error('  FAIL: long proposal should break to at least 2 pages');
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('\nAll proposal print PDF checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
