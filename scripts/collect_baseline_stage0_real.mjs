import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { dashboardScreen } from '../frontend/src/screens/dashboard.js';
import { activitiesScreen } from '../frontend/src/screens/activities.js';
import { monthScreen } from '../frontend/src/screens/month.js';
import { weekScreen } from '../frontend/src/screens/week.js';
import { exceptionsScreen } from '../frontend/src/screens/exceptions.js';
import { financeScreen } from '../frontend/src/screens/finance.js';
import { instructorsScreen } from '../frontend/src/screens/instructors.js';
import { contactsScreen } from '../frontend/src/screens/contacts.js';
import { endDatesScreen } from '../frontend/src/screens/end-dates.js';

const API_URL = process.env.DASHBOARD_API_URL || 'https://script.google.com/macros/s/AKfycbx_N-zondGSjlTV4mH2RKEJH8AjgC0y-Wbulf-fd-kQGK5ygOCiAwaex38vPKvJ7AAF/exec';
const USER_ID = process.env.DASHBOARD_USER_ID || '';
const ENTRY_CODE = process.env.DASHBOARD_ENTRY_CODE || '';
const SAMPLES_PER_SCREEN = Number(process.env.STAGE0B_SAMPLES || 20);
const REPORT_PATH = 'docs/architecture/read-models-stage0-real-baseline.md';

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function callApi(body) {
  const start = performance.now();
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body)
    });
  } catch (error) {
    const code = error?.cause?.code ? ` (${error.cause.code})` : '';
    throw new Error(`Network error while calling ${body.action}${code}: ${error.message || 'fetch failed'}`);
  }
  const text = await response.text();
  const durationMs = Math.round((performance.now() - start) * 100) / 100;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!json.ok) {
    throw new Error(`API error (${body.action}): ${json.error || 'unknown_error'}`);
  }
  return { json, durationMs, responseTextBytes: text.length };
}

function firstRenderMs(screenModule, route, data) {
  const state = {
    route,
    user: { display_role: 'operation_manager', user_id: USER_ID || 'unknown' },
    activityTab: 'all',
    financeTab: 'active',
    financeStatusFilter: '',
    financeSearch: '',
    financeDateFrom: '',
    financeDateTo: '',
    financeMonthYm: '',
    dashboardMonthYm: '2026-04',
    weekOffset: 0,
    monthYm: '2026-04'
  };
  const t0 = performance.now();
  screenModule.render(data, { state });
  return Math.round((performance.now() - t0) * 100) / 100;
}

function summarizeBottleneck(debugPerf, renderMs) {
  if (!debugPerf) return 'missing debug_perf';
  const notes = [];
  const sheetReads = Array.isArray(debugPerf.sheet_reads) ? debugPerf.sheet_reads : [];
  const serverReads = sheetReads.filter((x) => !x.from_cache);
  if (serverReads.length) {
    const top = [...serverReads].sort((a, b) => b.duration_ms - a.duration_ms)[0];
    notes.push(`sheet ${top.sheet}=${top.duration_ms}ms`);
  }
  if (Array.isArray(debugPerf.steps) && debugPerf.steps.length) {
    const topStep = [...debugPerf.steps].sort((a, b) => b.duration_ms - a.duration_ms)[0];
    if (topStep && Number(topStep.duration_ms || 0) > 0) {
      notes.push(`step ${topStep.step}=${topStep.duration_ms}ms`);
    }
  }
  if (typeof renderMs === 'number' && renderMs >= 120) {
    notes.push(`frontend render=${renderMs}ms`);
  }
  return notes.length ? notes.join('; ') : 'no clear bottleneck in sample';
}

function toPct(n) {
  if (n == null) return 'N/A';
  return `${(n * 100).toFixed(1)}%`;
}

function writeBlockedReport(reason) {
  const now = new Date().toISOString();
  const content = [
    '# Stage 0B Real Environment Baseline (Blocked)',
    '',
    `- Generated at (UTC): ${now}`,
    `- API URL: ${API_URL}`,
    `- Samples per screen requested: ${SAMPLES_PER_SCREEN}`,
    '',
    '## Status',
    '',
    `Collection was blocked: ${reason}`,
    '',
    '## What is required to complete Stage 0B',
    '',
    '1. Outbound network access from this environment to Google Apps Script endpoint.',
    '2. Valid credentials via env vars: `DASHBOARD_USER_ID` and `DASHBOARD_ENTRY_CODE`.',
    '3. Re-run `node scripts/collect_baseline_stage0_real.mjs`.',
    ''
  ].join('\n');
  fs.writeFileSync(REPORT_PATH, `${content}\n`, 'utf8');
}

function writeSuccessReport(results, meta = {}) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push('# Stage 0B Real Environment Baseline');
  lines.push('');
  lines.push(`- Generated at (UTC): ${now}`);
  lines.push(`- API URL: ${API_URL}`);
  lines.push(`- Samples per screen: ${SAMPLES_PER_SCREEN}`);
  lines.push(`- User ID used: ${USER_ID || 'N/A'}`);
  lines.push(`- Cache warmup policy: first sample may be server, subsequent samples may hit server cache.`);
  lines.push('');
  lines.push('| Screen | API p50 (ms) | API p95 (ms) | Payload p50 (bytes) | Payload p95 (bytes) | First render (ms) | Cache hit ratio | Source split | Sheets reads p50 | Bottleneck note |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|---:|---|');

  for (const row of results) {
    const split = `cache:${row.cache_hits} / server:${row.server_hits}`;
    lines.push(`| ${row.screen} | ${row.api_p50_ms ?? 'N/A'} | ${row.api_p95_ms ?? 'N/A'} | ${row.payload_p50_bytes ?? 'N/A'} | ${row.payload_p95_bytes ?? 'N/A'} | ${row.first_render_ms ?? 'N/A'} | ${toPct(row.cache_hit_ratio)} | ${split} | ${row.sheet_reads_p50 ?? 'N/A'} | ${row.bottleneck_note} |`);
  }

  lines.push('');
  if (meta.mockComparison) {
    lines.push('## Quick comparison vs Stage 0A mock baseline');
    lines.push('');
    lines.push(meta.mockComparison);
    lines.push('');
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function extractMockFinanceRender() {
  try {
    const raw = fs.readFileSync('docs/architecture/read-models-stage0-baseline.md', 'utf8');
    const line = raw.split('\n').find((l) => l.startsWith('| finance |'));
    if (!line) return null;
    const parts = line.split('|').map((x) => x.trim());
    return Number(parts[6]);
  } catch {
    return null;
  }
}

async function main() {
  if (!USER_ID || !ENTRY_CODE) {
    const reason = 'Missing credentials. Set DASHBOARD_USER_ID and DASHBOARD_ENTRY_CODE.';
    writeBlockedReport(reason);
    throw new Error(reason);
  }

  const screens = [
    { screen: 'dashboard', action: 'dashboard', payload: { month: '2026-04' }, module: dashboardScreen, route: 'dashboard' },
    { screen: 'activities', action: 'activities', payload: { activity_type: 'all' }, module: activitiesScreen, route: 'activities' },
    { screen: 'month', action: 'month', payload: { month: '2026-04' }, module: monthScreen, route: 'month' },
    { screen: 'week', action: 'week', payload: { offset: 0 }, module: weekScreen, route: 'week' },
    { screen: 'exceptions', action: 'exceptions', payload: {}, module: exceptionsScreen, route: 'exceptions' },
    { screen: 'finance', action: 'finance', payload: {}, module: financeScreen, route: 'finance' },
    { screen: 'instructors', action: 'instructors', payload: {}, module: instructorsScreen, route: 'instructors' },
    { screen: 'contacts', action: 'contacts', payload: {}, module: contactsScreen, route: 'contacts' },
    { screen: 'endDates', action: 'endDates', payload: {}, module: endDatesScreen, route: 'endDates' }
  ];

  try {
    const loginResp = await callApi({ action: 'login', user_id: USER_ID, entry_code: ENTRY_CODE, debug_perf: true });
    const token = loginResp.json?.data?.token;
    if (!token) throw new Error('Login succeeded but token missing.');

    const results = [];
    for (const spec of screens) {
      const apiDurations = [];
      const payloadBytes = [];
      const sheetReadCounts = [];
      let firstRender = null;
      let cacheHits = 0;
      let serverHits = 0;
      let bottleneck = 'no data';

      for (let i = 0; i < SAMPLES_PER_SCREEN; i++) {
        const { json, responseTextBytes } = await callApi({
          action: spec.action,
          token,
          debug_perf: true,
          ...spec.payload
        });

        const data = json.data || {};
        const debugPerf = data.debug_perf || {};
        apiDurations.push(Number(debugPerf.total_ms || 0));
        payloadBytes.push(Number(debugPerf.response_size_bytes || responseTextBytes || 0));

        const reads = Array.isArray(debugPerf.sheet_reads) ? debugPerf.sheet_reads.length : 0;
        sheetReadCounts.push(reads);

        if (debugPerf.cache_hit) cacheHits += 1;
        else serverHits += 1;

        if (i === 0) {
          firstRender = firstRenderMs(spec.module, spec.route, data);
          bottleneck = summarizeBottleneck(debugPerf, firstRender);
        }
      }

      const total = cacheHits + serverHits;
      results.push({
        screen: spec.screen,
        api_p50_ms: percentile(apiDurations, 50),
        api_p95_ms: percentile(apiDurations, 95),
        payload_p50_bytes: percentile(payloadBytes, 50),
        payload_p95_bytes: percentile(payloadBytes, 95),
        first_render_ms: firstRender,
        cache_hit_ratio: total ? cacheHits / total : null,
        cache_hits: cacheHits,
        server_hits: serverHits,
        sheet_reads_p50: percentile(sheetReadCounts, 50),
        bottleneck_note: bottleneck
      });
    }

    const mockFinanceRender = extractMockFinanceRender();
    const realFinance = results.find((r) => r.screen === 'finance')?.first_render_ms;
    const cmp = (mockFinanceRender != null && realFinance != null)
      ? `Finance first-render: mock=${mockFinanceRender}ms vs real=${realFinance}ms.`
      : 'Comparison placeholder: rerun after real measurements are collected.';

    writeSuccessReport(results, { mockComparison: cmp });
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    writeBlockedReport(error?.message || String(error));
    throw error;
  }
}

main().catch((error) => {
  console.error('[stage0b]', error.message || error);
  process.exitCode = 1;
});
