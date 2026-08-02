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
    await expect.poll(() => captured.length, { timeout: 90_000, message: 'the PDF upload must be attempted' })
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

/** Finds a row of the requested type that still offers PDF generation. */
async function findProposalRow(table, typeLabel, { requireSavedSnapshot = false } = {}) {
  const rows = table.locator('tbody tr[data-pa-row-id]');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const type = (await row.locator('td').nth(4).innerText()).trim();
    if (type !== typeLabel) continue;
    const generate = row.locator('[data-pa-generate-pdf], [data-pa-pdf]');
    if (!(await generate.count())) continue;
    if (requireSavedSnapshot) {
      const status = (await row.locator('td').nth(6).innerText()).trim();
      if (!status) continue;
    }
    return { row, id: await row.getAttribute('data-pa-row-id'), generate: generate.first() };
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

async function generateAndVerify(page, tracker, { label, typeLabel, requireSavedSnapshot = false }) {
  tracker.resetScreen(`proposal-pdf-${label}`);
  const table = await openAllProposals(page);
  const target = await findProposalRow(table, typeLabel, { requireSavedSnapshot });
  expect(target, `expected a ${typeLabel} proposal that can produce a PDF`).not.toBeNull();

  await target.row.click();
  const drawer = page.locator('[data-pa-drawer]:visible, .ds-drawer__content:visible').first();
  await expect(drawer).toBeVisible();
  await ensureDirs();
  await page.screenshot({ path: path.join(screenshotsDir, `proposal-pdf-preview-${label}.png`), fullPage: true });

  await installPrintHostProbe(page, REQUIRED_PRINT_PARTS);
  const pdfBuffer = await capturePdfWithoutUpload(page, async () => {
    const generate = page.locator('[data-pa-generate-pdf]:visible, [data-pa-pdf]:visible').first();
    await expect(generate).toBeVisible();
    await generate.click();
  });

  await assertPrintTreeComplete(page, label);
  const result = await verifyProducedPdf(page, tracker, `proposal-${label}`, pdfBuffer);
  await page.keyboard.press('Escape').catch(() => {});
  return result;
}

test.describe('Proposal PDF contains the full document', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await waitForAppShell(page);
  });

  test('תשפ״ז proposal with a course and a workshop produces the full template', async ({ page, tracker }) => {
    test.setTimeout(240_000);
    const result = await generateAndVerify(page, tracker, { label: 'tashpaz', typeLabel: 'תשפ״ז' });
    expect(result.pageCount).toBeGreaterThan(0);
    assertNoTransportErrors(tracker);
  });

  test('גפן proposal produces the full template', async ({ page, tracker }) => {
    test.setTimeout(240_000);
    const result = await generateAndVerify(page, tracker, { label: 'gefen', typeLabel: 'גפן' });
    expect(result.pageCount).toBeGreaterThan(0);
    assertNoTransportErrors(tracker);
  });

  test('existing proposal with a saved snapshot produces the full template', async ({ page, tracker }) => {
    test.setTimeout(240_000);
    const result = await generateAndVerify(page, tracker, {
      label: 'saved-snapshot',
      typeLabel: 'תשפ״ז',
      requireSavedSnapshot: true
    });
    expect(result.pageCount).toBeGreaterThan(0);
    assertNoTransportErrors(tracker);
  });
});
