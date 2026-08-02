import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const screenshots = path.resolve('artifacts/screenshots');

test('proposal regression path: full template, logo header, saved price, next-year areas and responsive contact', async ({ page }) => {
  await fs.mkdir(screenshots, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const module = await import('/frontend/src/screens/proposals-agreements.js');
    const row = { activity_type_group: 'next_year', proposal_date: '2026-08-02', client_authority: 'רשות לדוגמה', school_framework: 'בית ספר לדוגמה' };
    const items = [
      { item_name: 'בינה מלאכותית', item_type: 'קורס', proposal_group: 'next_year_courses', quantity: 1, unit_price: 8000, total_price: 8000, gefen_number: '6089' },
      { item_name: 'סדנת חלל', item_type: 'סדנה', proposal_group: 'next_year_workshops', quantity: 1, unit_price: 650, total_price: 650 }
    ];
    const template = [{ template_key: 'next_year', section_key: 'intro', section_title: 'פתיח', section_body: 'תוכן תבנית מלא', is_active: true }];
    const html = module.proposalPreviewBodyHtml(row, items, template);
    document.body.innerHTML = `<main dir="rtl"><section id="document">${html}</section>
      <section id="price"><h2>מחיר היסטורי</h2><label>כמות <input id="qty" type="number" value="1"></label><label>מחיר יחידה <input id="unit" data-pa-item-price value="8000"></label><output id="total">₪ 8,000</output></section>
      <section id="contact" dir="rtl"><h2>עדכון איש קשר</h2><div class="contact-grid"><label>איש קשר<input></label><label>תפקיד<input></label><label>נייד<input></label><label>דוא״ל<input></label><button>שמירת פרטי קשר</button><small>נייד קיים · דוא״ל קיים</small></div></section></main>`;
    const style = document.createElement('style');
    style.textContent = `body{font-family:Arial;margin:24px;background:#f8fafc}main{display:grid;gap:20px}#price,#contact{background:white;padding:18px;border:1px solid #cbd5e1;border-radius:12px}#price{display:flex;gap:18px;align-items:end}label{display:grid;gap:5px;min-width:0}input{min-width:0;width:100%;box-sizing:border-box;padding:8px}.contact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;align-items:end;min-width:0}.contact-grid small{grid-column:1/-1}`;
    document.head.append(style);
    const check = module.validateProposalDocumentTree(document.querySelector('#document'));
    const qty = document.querySelector('#qty');
    qty.addEventListener('input', () => { document.querySelector('#total').textContent = `₪ ${(Number(qty.value) * 8000).toLocaleString('en-US')}`; });
    return { ok: check.ok, missing: check.missing, courses: document.querySelectorAll('.pa-next-year-course-table').length, workshops: document.querySelectorAll('.pa-next-year-workshop-table').length };
  });
  expect(result).toEqual({ ok: true, missing: [], courses: 1, workshops: 1 });
  await expect(page.locator('#document')).not.toContainText('לא נמצאה תבנית פעילה');
  await page.locator('#document').screenshot({ path: path.join(screenshots, 'proposal-full-template.png') });
  await page.locator('#document').screenshot({ path: path.join(screenshots, 'proposal-next-year-two-areas.png') });
  await expect(page.locator('#total')).toHaveText('₪ 8,000');
  await page.locator('#qty').fill('2');
  await expect(page.locator('#total')).toHaveText('₪ 16,000');
  await page.locator('#price').screenshot({ path: path.join(screenshots, 'proposal-saved-price.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#contact').screenshot({ path: path.join(screenshots, 'proposal-contact-layout.png') });
  await page.setViewportSize({ width: 720, height: 900 });
  const overflow = await page.locator('#contact').evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
