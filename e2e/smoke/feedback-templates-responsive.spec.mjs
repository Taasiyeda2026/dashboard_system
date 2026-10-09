import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const css = await readFile(
  new URL('../../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8'
);

const slots = ['תלמידים (התחלה)', 'תלמידים (סיום)', 'צוות חינוכי', 'מדריכים (התחלה)', 'מדריכים (סיום)'];
const programs = [
  'ביומימיקרי', 'משחקי קופסה', 'מנהיגות ירוקה', 'טכנולוגיות החלל', 'יישומי AI',
  'ביומימיקרי חטיבה', 'רוקחים עולם', 'אופק פרימיום', 'סודות ויסודות AI', 'פורצות דרך'
];

function html(count = 10) {
  const cards = programs.slice(0, count).map((name) => `
    <article class="ifb-template-card">
      <div class="ifb-template-card__inner">
        <h3 class="ifb-template-card__title">${name}</h3>
        <p class="ifb-template-card__gefen">6089 · יסודי</p>
        <div class="ifb-template-card__slots">
          ${slots.map((slot) => `<div class="ifb-template-card__slot">
            <button class="ifb-template-card__open">${slot}</button>
            <button class="ifb-template-card__pdf" disabled>PDF</button>
            <button class="ifb-template-card__upload">↑</button>
          </div>`).join('')}
        </div>
      </div>
    </article>`).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${css}</style>
    <style>
      body { margin:0; }
      .layout { display:flex; min-height:100vh; width:100%; }
      .sidebar { width:196px; flex:0 0 196px; background:#084153; }
      .main { flex:1 1 auto; min-width:0; padding:16px; }
      @media(max-width:800px) {.sidebar {display:none;}}
    </style></head><body><div class="layout">
    <aside class="sidebar"></aside>
    <main class="main">
      <section class="ifb-admin"><div class="ifb-view">
        <div data-ifb-templates><div class="ifb-template-grid">${cards}</div></div>
      </div></section>
    </main></div></body></html>`;
}

for (const width of [1649, 1440, 1200, 960, 680, 390, 320]) {
  test(`templates stay inside dashboard without horizontal scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 930 });
    await page.setContent(html());
    const result = await page.evaluate(() => {
      const grid = document.querySelector('.ifb-template-grid');
      const frame = document.querySelector('[data-ifb-templates]');
      const outer = frame.getBoundingClientRect();
      const box = grid.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.ifb-template-card')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: Math.round(rect.top), left: rect.left, right: rect.right };
      });
      const buttonsInsideCards = [...document.querySelectorAll('.ifb-template-card__slot button')]
        .every((element) => {
          const b = element.getBoundingClientRect();
          const parent = element.closest('.ifb-template-card').getBoundingClientRect();
          return b.left >= parent.left - 1 && b.right <= parent.right + 1;
        });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        frameLeft: outer.left, frameRight: outer.right,
        gridLeft: box.left, gridRight: box.right,
        frameCenter: (outer.left + outer.right) / 2,
        gridCenter: (box.left + box.right) / 2,
        cards, buttonsInsideCards
      };
    });
    expect(result.scrollWidth, 'No horizontal scrollbar in the dashboard').toBeLessThanOrEqual(result.viewportWidth + 1);
    expect(result.gridLeft, 'Grid must stay inside the feedback view').toBeGreaterThanOrEqual(result.frameLeft - 1);
    expect(result.gridRight).toBeLessThanOrEqual(result.frameRight + 1);
    expect(Math.abs(result.frameCenter - result.gridCenter), 'Grid must be centered').toBeLessThan(2);
    expect(result.buttonsInsideCards, 'PDF/upload/open controls must fit inside cards').toBe(true);
    for (const rect of result.cards) {
      expect(rect.left).toBeGreaterThanOrEqual(result.frameLeft - 1);
      expect(rect.right).toBeLessThanOrEqual(result.frameRight + 1);
    }
    const firstRow = result.cards.filter((card) => card.top === result.cards[0].top).length;
    expect(firstRow).toBeLessThanOrEqual(5);
    if (width === 1649) expect(firstRow).toBe(5);
    if (width === 320) expect(firstRow).toBe(1);
  });
}

test('a single filtered course is centered in the same container', async ({ page }) => {
  await page.setViewportSize({ width: 1649, height: 930 });
  await page.setContent(html(1));
  const result = await page.evaluate(() => {
    const frame = document.querySelector('[data-ifb-templates]').getBoundingClientRect();
    const card = document.querySelector('.ifb-template-card').getBoundingClientRect();
    return { difference: Math.abs((frame.left + frame.right) / 2 - (card.left + card.right) / 2), width: card.width };
  });
  expect(result.difference).toBeLessThan(2);
  expect(result.width).toBeLessThanOrEqual(260);
});
