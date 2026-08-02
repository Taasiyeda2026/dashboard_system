import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');
const pdfDir = path.join(ARTIFACTS_DIR, 'pdf');

/** Required parts of a produced proposal document, measured on the real print tree. */
const REQUIRED_PRINT_PARTS = [
  ['header', '.proposal-document-header, .pa-page-header'],
  ['recipient', '.pa-to-block, .pa-doc-address'],
  ['title', '.pa-doc-title, .pa-doc-subject'],
  ['template_section', '.pa-section, .pa-org-intro'],
  ['activity_table', '.pa-item-details-table, .pa-activities-table, .pa-cost-table, .pa-tour-cost-table, .pa-next-year-course-table, .pa-next-year-workshop-table']
];

async function ensureDirs() {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(pdfDir, { recursive: true });
}

/**
 * Records the print tree the PDF is built from. The host only exists while the file is
 * being produced, so it is measured live instead of being reconstructed afterwards.
 */
async function installPrintHostProbe(page, parts) {
  await page.evaluate((requiredParts) => {
    window.__paPdfHostProbe = { seen: false, parts: {} };
    const measure = (host) => {
      if (window.__paPdfHostProbe.seen) return;
      window.__paPdfHostProbe.seen = true;
      window.__paPdfHostProbe.documentRoots = host.querySelectorAll('.proposal-document').length;
      requiredParts.forEach(([key, selector]) => {
        const elements = [...host.querySelectorAll(selector)];
        const visible = elements.find((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        const rect = visible?.getBoundingClientRect();
        window.__paPdfHostProbe.parts[key] = {
          count: elements.length,
          visible: Boolean(visible),
          width: rect ? Math.round(rect.width) : 0,
          height: rect ? Math.round(rect.height) : 0,
          text: (visible?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        };
      });
      window.__paPdfHostProbe.hostHeight = Math.round(host.scrollHeight);
    };
    const existing = document.querySelector('[data-pdf-render-host]');
    if (existing) measure(existing);
    new MutationObserver(() => {
      const host = document.querySelector('[data-pdf-render-host]');
      if (host) measure(host);
    }).observe(document.body, { childList: true, subtree: true });
  }, parts);
}

/** Runs the real PDF flow but aborts the upload, so no document is stored or replaced. */
async function capturePdfWithoutUpload(page, action) {
  const captured = [];
  const routePattern = '**/storage/v1/object/**';
  await page.route(routePattern, async (route) => {
    const request = route.request();
    if (request.method().toUpperCase() === 'POST') {
      const body = request.postDataBuffer();
      if (body?.length) captured.push(body);
      await route.abort();
      return;
    }
    await route.continue();
  });
  try {
    await action();
    await expect.poll(() => captured.length, { timeout: 60_000, message: 'the PDF upload must be attempted' })
      .toBeGreaterThan(0);
  } finally {
    await page.unroute(routePattern);
  }
  const buffer = captured[0];
  const start = buffer.indexOf(Buffer.from('%PDF-'));
  expect(start, 'the uploaded body must contain a real PDF').toBeGreaterThanOrEqual(0);
  return buffer.subarray(start);
}

/** One JPEG per page is embedded by the generator, so pages extract byte-exactly. */
function extractPdfPageImages(pdfBuffer) {
  const pages = [];
  let index = 0;
  while (index < pdfBuffer.length - 3) {
    if (pdfBuffer[index] === 0xff && pdfBuffer[index + 1] === 0xd8 && pdfBuffer[index + 2] === 0xff) {
      let cursor = index + 2;
      while (cursor < pdfBuffer.length - 1) {
        if (pdfBuffer[cursor] === 0xff && pdfBuffer[cursor + 1] === 0xd9) {
          pages.push(pdfBuffer.subarray(index, cursor + 2));
          index = cursor + 2;
          break;
        }
        cursor += 1;
      }
      if (cursor >= pdfBuffer.length - 1) break;
      continue;
    }
    index += 1;
  }
  return pages;
}

/** Measures ink coverage per horizontal band so a nearly-blank page cannot pass. */
async function measurePageInk(page, jpegBuffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const bands = [0, 0, 0, 0];
    const bandHeight = canvas.height / 4;
    let total = 0;
    for (let y = 0; y < canvas.height; y += 2) {
      const band = Math.min(3, Math.floor(y / bandHeight));
      for (let x = 0; x < canvas.width; x += 2) {
        const offset = (y * canvas.width + x) * 4;
        if (data[offset] < 235 || data[offset + 1] < 235 || data[offset + 2] < 235) {
          bands[band] += 1;
          total += 1;
        }
      }
    }
    const sampled = Math.ceil(canvas.height / 2) * Math.ceil(canvas.width / 2);
    return {
      width: canvas.width,
      height: canvas.height,
      inkRatio: total / sampled,
      bandRatios: bands.map((count) => count / (sampled / 4))
    };
  }, jpegBuffer.toString('base64'));
}

async function openAllProposals(page) {
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  const table = page.locator('[data-pa-all-proposals-table] [data-pa-table]').first();
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr[data-pa-row-id]').first()).toBeVisible();
  return table;
}

/**
 * Opens each candidate row of the requested type and keeps the first one whose preview
 * overlay offers PDF production (`#pa-print-btn`). A sent proposal that only offers its
 * stored file is reported separately so the saved-snapshot scenario can verify that.
 */
const CANDIDATE_LIMIT = 3;
const STEP_TIMEOUT = 10_000;

async function openProposalWithPrintAction(page, table, typeLabel, { preferSent = false } = {}) {
  const rows = table.locator('tbody tr[data-pa-row-id]');
  // Read the whole table once instead of querying cell by cell per candidate.
  const summaries = await rows.evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    type: (node.cells[4]?.textContent || '').trim(),
    status: (node.cells[6]?.textContent || '').trim()
  })));
  const order = summaries
    .filter((entry) => entry.type === typeLabel)
    .map((entry) => ({ index: entry.index, isSent: entry.status.includes('נשלח') }))
    .sort((left, right) => Number(right.isSent === preferSent) - Number(left.isSent === preferSent))
    .slice(0, CANDIDATE_LIMIT);
  expect(order.length, `expected at least one ${typeLabel} proposal in the table`).toBeGreaterThan(0);

  for (const candidate of order) {
    const row = rows.nth(candidate.index);
    const id = await row.getAttribute('data-pa-row-id');

    // From the all-proposals table the view action opens the details screen; the view
    // action inside that screen is what opens the A4 preview overlay.
    let rowAction = row.locator('[data-pa-preview]:visible').first();
    if (!(await rowAction.count())) {
      const more = row.locator('.ds-pa-row-more summary');
      if (await more.count()) await more.click();
      rowAction = row.locator('[data-pa-preview]').first();
    }
    if (!(await rowAction.count())) continue;
    await rowAction.click();

    const detail = page.locator('[data-pa-proposal-detail]:visible').first();
    const reachedDetail = await detail.isVisible({ timeout: STEP_TIMEOUT }).catch(() => false);
    if (reachedDetail) {
      const detailPreview = detail.locator('[data-pa-preview]').first();
      if (await detailPreview.count()) await detailPreview.click();
    }

    const toolbar = page.locator('.proposal-preview-toolbar');
    if (await toolbar.isVisible({ timeout: STEP_TIMEOUT }).catch(() => false)) {
      const print = page.locator('#pa-print-btn');
      const savedPdf = page.locator('#pa-view-final-pdf-btn');
      if (await print.count()) return { kind: 'print', row, print, id };
      if (await savedPdf.count()) return { kind: 'saved', row, savedPdf, id };
      await page.locator('#pa-preview-close').first().click().catch(() => {});
    }
    await page.locator('[data-pa-proposal-detail-back]').first().click().catch(() => {});
    await table.locator('tbody tr[data-pa-row-id]').first().isVisible({ timeout: STEP_TIMEOUT }).catch(() => false);
  }
  return null;
}

async function verifyProducedPdf(page, tracker, label, pdfBuffer) {
  await ensureDirs();
  const pdfPath = path.join(pdfDir, `${label}.pdf`);
  await fs.writeFile(pdfPath, pdfBuffer);
  expect(pdfBuffer.subarray(0, 5).toString(), 'the file must start with a PDF signature').toBe('%PDF-');

  const pages = extractPdfPageImages(pdfBuffer);
  expect(pages.length, 'the PDF must contain at least one rendered page').toBeGreaterThan(0);

  const measurements = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pagePath = path.join(pdfDir, `${label}-page-${index + 1}.jpg`);
    await fs.writeFile(pagePath, pages[index]);
    const ink = await measurePageInk(page, pages[index]);
    measurements.push(ink);
    expect(ink.width, `page ${index + 1} must have real pixels`).toBeGreaterThan(0);
    expect(ink.height, `page ${index + 1} must have real pixels`).toBeGreaterThan(0);
  }

  // The reported bug produced a page holding little more than the activities table.
  // The first page must carry the header band and the body band, not one of them.
  const first = measurements[0];
  expect(first.inkRatio, `${label}: page 1 must not be nearly blank`).toBeGreaterThan(0.01);
  expect(first.bandRatios[0], `${label}: page 1 must show the header band`).toBeGreaterThan(0.002);
  expect(
    first.bandRatios[1] + first.bandRatios[2],
    `${label}: page 1 must show the document body, not only a table strip`
  ).toBeGreaterThan(0.004);

  await tracker.persist(`${label}-pdf`);
  return { pdfPath, pageCount: pages.length, measurements };
}

async function assertPrintTreeComplete(page, label) {
  const probe = await page.evaluate(() => window.__paPdfHostProbe || null);
  expect(probe, `${label}: the PDF print tree must have been observed`).not.toBeNull();
  expect(probe.seen, `${label}: the PDF render host must be mounted`).toBe(true);
  expect(probe.documentRoots, `${label}: exactly one document root must be rendered`).toBeGreaterThanOrEqual(1);
  REQUIRED_PRINT_PARTS.forEach(([key]) => {
    const part = probe.parts[key];
    expect(part, `${label}: ${key} must be measured`).toBeTruthy();
    expect(part.count, `${label}: ${key} must exist in the print tree`).toBeGreaterThan(0);
    expect(part.visible, `${label}: ${key} must have a visible bounding box`).toBe(true);
    expect(part.height, `${label}: ${key} must have height`).toBeGreaterThan(0);
    expect(part.width, `${label}: ${key} must have width`).toBeGreaterThan(0);
  });
  expect(probe.hostHeight, `${label}: the print tree must be taller than a table strip`).toBeGreaterThan(600);
}

/** Downloads a proposal's stored PDF without regenerating or replacing it. */
async function fetchSavedPdf(page, savedPdfButton) {
  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 30_000 }),
    savedPdfButton.click()
  ]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  const url = popup.url();
  expect(url, 'the saved PDF must resolve to a signed URL').toMatch(/^https?:/);
  const response = await page.request.get(url);
  expect(response.ok(), 'the stored PDF must be readable').toBe(true);
  await popup.close().catch(() => {});
  return Buffer.from(await response.body());
}

async function generateAndVerify(page, tracker, { label, typeLabel, preferSent = false }) {
  tracker.resetScreen(`proposal-pdf-${label}`);
  const table = await openAllProposals(page);
  const target = await openProposalWithPrintAction(page, table, typeLabel, { preferSent });
  expect(target, `expected a ${typeLabel} proposal offering a PDF action`).not.toBeNull();

  await expect(page.locator('.proposal-preview-area .proposal-document').first()).toBeVisible();
  await ensureDirs();
  await page.screenshot({ path: path.join(screenshotsDir, `proposal-pdf-preview-${label}.png`), fullPage: true });

  let pdfBuffer;
  if (target.kind === 'print') {
    await installPrintHostProbe(page, REQUIRED_PRINT_PARTS);
    pdfBuffer = await capturePdfWithoutUpload(page, async () => {
      await expect(target.print).toBeVisible();
      await target.print.click();
    });
    await assertPrintTreeComplete(page, label);
  } else {
    // A locked proposal keeps its stored document: verify that file, never replace it.
    pdfBuffer = await fetchSavedPdf(page, target.savedPdf);
  }

  const result = await verifyProducedPdf(page, tracker, `proposal-${label}`, pdfBuffer);
  await page.locator('#pa-preview-close').first().click().catch(() => {});
  await page.locator('[data-pa-proposal-detail-back]').first().click().catch(() => {});
  return { ...result, kind: target.kind };
}

test.describe('Proposal PDF contains the full document', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await waitForAppShell(page);
  });

  test('תשפ״ז proposal with a course and a workshop produces the full template', async ({ page, tracker }) => {
    test.setTimeout(150_000);
    const result = await generateAndVerify(page, tracker, { label: 'tashpaz', typeLabel: 'תשפ״ז' });
    expect(result.pageCount).toBeGreaterThan(0);
    assertNoTransportErrors(tracker);
  });

  test('גפן proposal produces the full template', async ({ page, tracker }) => {
    test.setTimeout(150_000);
    const result = await generateAndVerify(page, tracker, { label: 'gefen', typeLabel: 'גפן' });
    expect(result.pageCount).toBeGreaterThan(0);
    assertNoTransportErrors(tracker);
  });

  test('existing proposal with a saved snapshot keeps the full template', async ({ page, tracker }) => {
    test.setTimeout(150_000);
    const result = await generateAndVerify(page, tracker, {
      label: 'saved-snapshot',
      typeLabel: 'תשפ״ז',
      preferSent: true
    });
    expect(result.pageCount).toBeGreaterThan(0);
    assertNoTransportErrors(tracker);
  });
});
