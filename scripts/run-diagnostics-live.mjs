#!/usr/bin/env node
/**
 * Stage 2C-LIVE external diagnostics runner.
 *
 * Usage:
 *   export DASHBOARD_API_URL="https://script.google.com/macros/s/.../exec"
 *   export DASHBOARD_USER_ID="..."
 *   export DASHBOARD_ENTRY_CODE="..."
 *   node scripts/run-diagnostics-live.mjs
 *
 * Notes:
 * - Read-only flow: login + diagnosticsConsistency action calls.
 * - Does not write to Sheet, does not refresh read models, does not mutate data.
 */

const REQUIRED_ENV = ['DASHBOARD_API_URL', 'DASHBOARD_USER_ID', 'DASHBOARD_ENTRY_CODE'];

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function assertEnv() {
  const missing = REQUIRED_ENV.filter((name) => !getEnv(name));
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

async function callApi(apiUrl, body) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for action=${body.action}: ${text.slice(0, 300)}`);
  }

  if (!json.ok) {
    throw new Error(`API error for action=${body.action}: ${json.error || 'unknown_error'}`);
  }

  return json.data || {};
}

function printMismatchTable(month, mismatches) {
  const rows = (mismatches || []).map((m) => ({
    month,
    metric: m.metric ?? '',
    dashboardValue: m.dashboardValue ?? '',
    sourceValue: m.sourceValue ?? '',
    sourceName: m.sourceName ?? '',
    suspectedFunction: m.suspectedFunction ?? '',
    critical: m.critical === true,
    reason: m.reason ?? ''
  }));

  console.table(rows, [
    'month',
    'metric',
    'dashboardValue',
    'sourceValue',
    'sourceName',
    'suspectedFunction',
    'critical',
    'reason'
  ]);
}

function printMonthDiagnostics(month, data) {
  const dashboard = data.dashboard || {};
  const exceptions = data.exceptions || {};
  const finance = data.finance || {};
  const mismatches = Array.isArray(data.mismatches) ? data.mismatches : [];
  const critical = data.critical === true || mismatches.some((m) => m && m.critical === true);

  console.log(`\n===== diagnosticsConsistency | month=${month} =====`);
  console.log('dashboard:', JSON.stringify(dashboard, null, 2));
  console.log('exceptions:', JSON.stringify(exceptions, null, 2));
  console.log('finance:', JSON.stringify(finance, null, 2));
  console.log('mismatches:', JSON.stringify(mismatches, null, 2));
  console.log('critical mismatch:', critical ? 'YES' : 'NO');

  if (mismatches.length) {
    printMismatchTable(month, mismatches);
  } else {
    console.log(`Stage 2C-LIVE passed for month ${month}`);
  }
}

async function main() {
  assertEnv();

  const apiUrl = getEnv('DASHBOARD_API_URL');
  const userId = getEnv('DASHBOARD_USER_ID');
  const entryCode = getEnv('DASHBOARD_ENTRY_CODE');

  const loginData = await callApi(apiUrl, {
    action: 'login',
    user_id: userId,
    entry_code: entryCode
  });

  const token = String(loginData.token || '').trim();
  if (!token) {
    throw new Error('Login succeeded but token is missing in response.');
  }

  const months = ['2026-04', '2026-05'];
  for (const month of months) {
    const data = await callApi(apiUrl, {
      action: 'diagnosticsConsistency',
      token,
      month
    });
    printMonthDiagnostics(month, data);
  }
}

main().catch((error) => {
  console.error('[run-diagnostics-live] Failed:', error?.message || String(error));
  process.exitCode = 1;
});
