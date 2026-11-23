/**
 * Connected-style save/edit for instructor travel UX simplification.
 * Real daily-travel tab + in-memory store (no production writes).
 * Covers same-location km preserve across save→reload and short labels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mergeDailyTravelLegValues } from '../attendance/src/services/daily-travel-leg-merge.js';
import { summarizeDailyTravel } from '../attendance/src/services/daily-travel.js';

const ARTIFACTS = '/opt/cursor/artifacts';
const entry = fileURLToPath(new URL('../attendance/src/screens/daily-travel-tab.js', import.meta.url));
const readCss = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

const mocks = new Map([
  ['../services/attendance.service.js', "export const getMonthApproval=async()=>null;export const invalidateAttendanceCache=()=>{};"],
  ['../api/client.js', 'export const supabase={};'],
  ['../services/month-gate.service.js', "export const canEditMonth=()=>true;export const formatMonthLabel=(y,m)=>y+'-'+String(m).padStart(2,'0');"],
  ['../services/unsaved-changes.js', `
    export function createUnsavedChangesGuard(root){
      const guard={root,dirty:false,busy:false,markClean(){guard.dirty=false;},confirmLeave(){return true;}};
      root.addEventListener('input',()=>{guard.dirty=true;},{capture:true});
      root.addEventListener('change',()=>{guard.dirty=true;},{capture:true});
      return guard;
    }
  `],
  ['../services/historical-travel-save.js', 'export async function saveHistoricalTravel(){return {};}'],
  ['../services/travel-request-guard.js', `
    export async function withTravelDeadline(fn){return typeof fn==='function'?fn({aborted:false}):fn;}
    export function savedTravelMatchesDraft(){return true;}
  `],
  ['../services/historical-display.service.js', [
    "export const listInstructorDisplayMonths=async()=>['2026-11'];",
    'export const readHistoricalAttendance=async()=>({rows:[],approval:null});',
    'export const historicalTravelDays=()=>[];',
    'export const historicalTravelReports=()=>[];',
    "export const isHistoricTravelMonth=()=>false;",
    "export const monthStatusLabel=()=>'';",
  ].join('\n')],
  ['../components/reported-daily-travel.js', `
    export function createReportedTravelTable(){
      const el=document.createElement('div');
      el.render=()=>{};
      return el;
    }
  `],
  ['../services/daily-travel.service.js', [
    'export const getDailyTravelActivityLegs=async(_id,date)=>window.__store.preview(date);',
    'export const getDailyTravelReport=async(_id,date)=>window.__store.report(date);',
    'export const getDailyTravelReports=async()=>window.__store.reports.slice();',
    'export const getAssignedTravelDays=async()=>window.__store.days.map(d=>({...d}));',
    'export const saveDailyTravel=async(date,legs,noTravel)=>window.__store.save(date,legs,noTravel);',
  ].join('\n')],
]);

const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  globalName: 'TravelComponent',
  plugins: [{
    name: 'mock-services',
    setup(b) {
      b.onResolve({ filter: /^\.\.\/(services|components|api)\// }, (a) => (
        mocks.has(a.path) ? { path: a.path, namespace: 'ux-connected-mock' } : undefined
      ));
      b.onLoad({ filter: /.*/, namespace: 'ux-connected-mock' }, (a) => (
        { contents: mocks.get(a.path), loader: 'js' }
      ));
    },
  }],
});

const css = [
  await readCss('attendance/src/styles/base.css'),
  await readCss('attendance/src/styles/new-report-screen.css'),
  await readCss('attendance/src/styles/new-report-final-alignment.css'),
  'body{margin:12px;background:#f5f7fb;font-family:Arial,sans-serif}[hidden]{display:none!important}',
].join('\n');

async function shot(page, name) {
  await mkdir(ARTIFACTS, { recursive: true });
  const path = `${ARTIFACTS}/ux-simplify-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function open(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('about:blank');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const preview = [
      { kind: 'outbound', from: 'בית', to: 'א', gapMinutes: null, sameLocation: false, contextFingerprint: 'fp' },
      { kind: 'between', from: 'א', to: 'א', gapMinutes: 45, sameLocation: true, contextFingerprint: 'fp' },
      { kind: 'return', from: 'א', to: 'בית', gapMinutes: null, sameLocation: false, contextFingerprint: 'fp' },
    ];
    const db = new Map();
    window.__store = {
      days: [{ date: '2026-11-12', activities: 'א · א', review_status: 'missing', ready: true }],
      reports: [],
      preview: () => preview.map((leg) => ({
        ...leg,
        minutes: leg.kind === 'between' ? leg.gapMinutes : null,
        kilometers: leg.sameLocation ? 0 : null,
      })),
      report: (date) => db.get(date) || null,
      save(date, legs, noTravel) {
        const savedLegs = (legs || []).map((leg) => ({
          ...leg,
          kilometers: leg.kind === 'between' && leg.sameLocation === true
            ? (typeof leg.kilometers === 'number' ? leg.kilometers : 0)
            : leg.kilometers,
        }));
        const row = {
          travel_date: date,
          legs: savedLegs,
          no_travel: Boolean(noTravel),
          total_km: savedLegs.reduce((s, l) => s + Number(l.kilometers || 0), 0),
          reported_at: new Date().toISOString(),
          review_status: 'pending_review',
        };
        db.set(date, row);
        window.__store.reports = [...db.values()];
        return row;
      },
    };
    window.travelTab = window.TravelComponent.createDailyTravelTab({ empId: 1503, initialDate: '2026-11-12' });
    document.body.replaceChildren(window.travelTab.panel);
  });
  await page.evaluate(() => window.travelTab.load({ force: true }));
  await page.waitForFunction(() => document.querySelector('.av2-daily-travel__leg'));
}

test('merge + summarize keep same-location km for connected save payload', () => {
  const preview = { kind: 'between', from: 'א', to: 'א', sameLocation: true, gapMinutes: 45, contextFingerprint: 'fp' };
  const saved = { kind: 'between', from: 'א', to: 'א', sameLocation: true, kilometers: 7, mode: 'car', contextFingerprint: 'fp' };
  const merged = mergeDailyTravelLegValues(preview, saved);
  assert.equal(merged.kilometers, 7);
  assert.equal(summarizeDailyTravel([
    { kind: 'outbound', minutes: 40, kilometers: 10, mode: 'car' },
    merged,
    { kind: 'return', minutes: 40, kilometers: 10, mode: 'car' },
  ]).kilometers, 27);
});

test('staged SQL preserves numeric same-location kilometers', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261123120000_preserve_same_location_travel_km.sql', import.meta.url), 'utf8');
  assert.match(sql, /same_location/);
  assert.match(sql, /jsonb_typeof\(v_item->'kilometers'\) is distinct from 'number'/);
  assert.match(sql, /do not apply to production without explicit approval/i);
});

test('Chromium connected save/edit preserves same-location km and short labels', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const page = await browser.newPage();
      await open(page, { width: viewport.width, height: viewport.height });

      assert.equal(await page.locator('h2').innerText(), 'נסיעות');
      assert.equal(await page.locator('.av2-daily-travel button.av2-btn--primary').innerText(), 'שמור');
      assert.equal(await page.locator('.av2-daily-travel__leg strong').nth(1).innerText(), 'מעבר בין פעילויות');
      assert.equal(await page.locator('.av2-daily-travel__calculated-field').count(), 0);
      assert.match(await page.locator('.av2-daily-travel__km .av2-field__label').first().innerText(), /^קילומטרים$/);
      assert.doesNotMatch(await page.locator('.av2-daily-travel').innerText(), /פער שעות|מחושב משעות|ברירת מחדל/);

      const modeSelects = page.locator('.av2-daily-travel__mode:not([hidden]) select');
      assert.equal(await modeSelects.count(), 2);
      await modeSelects.nth(0).selectOption('car');
      await modeSelects.nth(1).selectOption('car');
      await page.locator('[data-duration-hours="0"]').selectOption('0');
      await page.locator('[data-duration-minutes="0"]').selectOption('40');
      await page.locator('[data-daily-travel-leg="0"][data-field="kilometers"]').fill('12');
      await page.locator('[data-daily-travel-leg="1"][data-field="kilometers"]').fill('7');
      await page.locator('[data-duration-hours="2"]').selectOption('0');
      await page.locator('[data-duration-minutes="2"]').selectOption('35');
      await page.locator('[data-daily-travel-leg="2"][data-field="kilometers"]').fill('12');
      await shot(page, `${viewport.name}-form`);

      await page.locator('.av2-daily-travel button.av2-btn--primary').click();
      await page.waitForFunction(() => document.querySelector('.av2-daily-travel__saved:not([hidden])'));

      const saved = await page.evaluate(() => window.__store.report('2026-11-12'));
      assert.equal(Number(saved.legs[1].kilometers), 7);
      assert.equal(Number(saved.total_km), 31);
      await shot(page, `${viewport.name}-saved`);

      await page.locator('.av2-daily-travel__saved-edit').click();
      await page.waitForFunction(() => document.querySelector('[data-daily-travel-leg="1"]'));
      assert.equal(await page.locator('[data-daily-travel-leg="1"][data-field="kilometers"]').inputValue(), '7');
      await shot(page, `${viewport.name}-reopen`);
      await page.locator('[data-daily-travel-leg="1"][data-field="kilometers"]').fill('9');
      await page.locator('.av2-daily-travel button.av2-btn--primary').click();
      await page.waitForFunction(() => Number(window.__store.report('2026-11-12').legs[1].kilometers) === 9);
      assert.equal(await page.evaluate(() => Number(window.__store.report('2026-11-12').total_km)), 33);
      await shot(page, `${viewport.name}-edited`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
