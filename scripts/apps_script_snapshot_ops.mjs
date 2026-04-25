#!/usr/bin/env node

/**
 * End-to-end operational helper for dashboard snapshots on Google Apps Script.
 *
 * Required env vars:
 * - GOOGLE_OAUTH_ACCESS_TOKEN
 * - GAS_SCRIPT_ID
 * - SPREADSHEET_ID
 *
 * Optional env vars:
 * - REDEPLOY_WEBAPP=true|false
 * - WEBAPP_DEPLOYMENT_ID=<deployment id to update>
 * - SNAPSHOT_REFRESH_RUNS=<number, default 5>
 * - SYNC_ACTIVE_PROJECT=true|false (default true)
 */
import fs from 'fs';
import path from 'path';

const {
  GOOGLE_OAUTH_ACCESS_TOKEN,
  GAS_SCRIPT_ID,
  SPREADSHEET_ID,
  REDEPLOY_WEBAPP,
  WEBAPP_DEPLOYMENT_ID,
  SNAPSHOT_REFRESH_RUNS,
  SYNC_ACTIVE_PROJECT
} = process.env;

const REFRESH_RUNS = Math.max(1, Number(SNAPSHOT_REFRESH_RUNS || 5));

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

function authHeaders() {
  return {
    Authorization: `Bearer ${GOOGLE_OAUTH_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

async function gfetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function runFunction(functionName, parameters = []) {
  const url = `https://script.googleapis.com/v1/scripts/${encodeURIComponent(GAS_SCRIPT_ID)}:run`;
  return gfetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ function: functionName, parameters })
  });
}

function executionResult(executionResponse) {
  if (executionResponse.error) {
    throw new Error(`Apps Script execution error: ${JSON.stringify(executionResponse.error)}`);
  }
  return executionResponse.response?.result ?? null;
}

async function readRange(rangeA1) {
  const range = encodeURIComponent(rangeA1);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${range}`;
  const data = await gfetch(url, { headers: { Authorization: `Bearer ${GOOGLE_OAUTH_ACCESS_TOKEN}` } });
  return data.values || [];
}

function rowsToObjects(rows, { skipHebrewHeaderRow = true } = {}) {
  if (!rows.length) return [];
  const headers = rows[0].map(String);
  const startIndex = rows.length > 1 && skipHebrewHeaderRow ? 2 : 1;
  return rows.slice(startIndex).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });
}

function countByUniqueKey(rows, keySelector) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(keySelector(row) || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([key, count]) => ({ key, count }));

  return {
    rows_with_key: [...counts.values()].reduce((a, b) => a + b, 0),
    unique_keys: counts.size,
    duplicate_keys: duplicates,
    has_duplicates: duplicates.length > 0
  };
}

function buildRunMetrics(summaryRows, byManagerRows, controlRows) {
  const summaryStats = countByUniqueKey(summaryRows, (r) => r.month_ym);
  const byManagerStats = countByUniqueKey(
    byManagerRows,
    (r) => r.snapshot_key || `${r.month_ym || ''}|${r.activity_manager || ''}`
  );
  const controlStats = countByUniqueKey(controlRows, (r) => r.key);

  return {
    summary: {
      rows: summaryRows.length,
      ...summaryStats
    },
    by_manager: {
      rows: byManagerRows.length,
      ...byManagerStats
    },
    refresh_control: {
      rows: controlRows.length,
      ...controlStats
    }
  };
}

function validateNoGrowthAcrossRuns(runMetrics) {
  if (runMetrics.length <= 1) {
    return { ok: true, reason: 'single_run' };
  }

  const baseline = runMetrics[0];
  const unchanged = runMetrics.slice(1).every((m) =>
    m.summary.rows === baseline.summary.rows &&
    m.by_manager.rows === baseline.by_manager.rows &&
    m.refresh_control.rows === baseline.refresh_control.rows
  );

  return {
    ok: unchanged,
    baseline_rows: {
      summary: baseline.summary.rows,
      by_manager: baseline.by_manager.rows,
      refresh_control: baseline.refresh_control.rows
    },
    per_run_rows: runMetrics.map((m) => ({
      summary: m.summary.rows,
      by_manager: m.by_manager.rows,
      refresh_control: m.refresh_control.rows
    }))
  };
}

async function syncActiveProjectBackendFiles() {
  const backendDir = path.join(process.cwd(), 'backend');
  const localBackendFiles = fs.readdirSync(backendDir).filter((f) => f.endsWith('.gs'));
  const contentUrl = `https://script.googleapis.com/v1/projects/${encodeURIComponent(GAS_SCRIPT_ID)}/content`;
  const content = await gfetch(contentUrl, { headers: authHeaders() });
  const files = Array.isArray(content.files) ? content.files : [];

  const updatedFiles = [];
  for (const rel of localBackendFiles) {
    const baseName = rel.replace(/\.gs$/i, '');
    const localSource = fs.readFileSync(path.join(backendDir, rel), 'utf8');
    const idx = files.findIndex((f) => f.name === baseName && f.type === 'SERVER_JS');
    if (idx >= 0) {
      if (files[idx].source !== localSource) {
        files[idx] = { ...files[idx], source: localSource };
        updatedFiles.push(rel);
      }
      continue;
    }
    files.push({ name: baseName, type: 'SERVER_JS', source: localSource });
    updatedFiles.push(rel);
  }

  await gfetch(contentUrl, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ files })
  });

  return { synced: true, updated_files: updatedFiles };
}

async function maybeRedeploy() {
  if (String(REDEPLOY_WEBAPP).toLowerCase() !== 'true') {
    return { redeployed: false, reason: 'skipped' };
  }

  if (!WEBAPP_DEPLOYMENT_ID) {
    return { redeployed: false, reason: 'missing WEBAPP_DEPLOYMENT_ID' };
  }

  const versionResp = await gfetch(
    `https://script.googleapis.com/v1/projects/${encodeURIComponent(GAS_SCRIPT_ID)}/versions`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: `ops refresh ${new Date().toISOString()}` })
    }
  );

  const versionNumber = versionResp.versionNumber;
  await gfetch(
    `https://script.googleapis.com/v1/projects/${encodeURIComponent(GAS_SCRIPT_ID)}/deployments/${encodeURIComponent(WEBAPP_DEPLOYMENT_ID)}`,
    {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        deploymentConfig: {
          versionNumber,
          manifestFileName: 'appsscript',
          description: `ops redeploy ${new Date().toISOString()}`
        }
      })
    }
  );

  return { redeployed: true, versionNumber };
}

async function main() {
  required('GOOGLE_OAUTH_ACCESS_TOKEN', GOOGLE_OAUTH_ACCESS_TOKEN);
  required('GAS_SCRIPT_ID', GAS_SCRIPT_ID);
  required('SPREADSHEET_ID', SPREADSHEET_ID);

  const shouldSync = String(SYNC_ACTIVE_PROJECT || 'true').toLowerCase() !== 'false';
  const syncResult = shouldSync
    ? await syncActiveProjectBackendFiles()
    : { synced: false, reason: 'disabled' };

  const runResults = [];
  const runMetrics = [];

  for (let i = 0; i < REFRESH_RUNS; i += 1) {
    const refreshResp = await runFunction('refreshDashboardSnapshots');
    runResults.push(executionResult(refreshResp));

    const summaryRows = rowsToObjects(await readRange('dashboard_summary_snapshot!A1:T'));
    const byManagerRows = rowsToObjects(await readRange('dashboard_by_manager_snapshot!A1:M'));
    const controlRows = rowsToObjects(await readRange('dashboard_refresh_control!A1:C'));
    runMetrics.push(buildRunMetrics(summaryRows, byManagerRows, controlRows));
  }

  const finalControlRows = rowsToObjects(await readRange('dashboard_refresh_control!A1:C'));
  const controlMap = Object.fromEntries(finalControlRows.map((r) => [String(r.key || ''), String(r.value || '')]));
  const triggerDiagnosticsResp = await runFunction('getSnapshotRefreshDiagnostics');
  const triggerDiagnostics = executionResult(triggerDiagnosticsResp) || {};

  const redeploy = await maybeRedeploy();
  const noGrowthCheck = validateNoGrowthAcrossRuns(runMetrics);
  const finalMetrics = runMetrics[runMetrics.length - 1] || buildRunMetrics([], [], []);

  const result = {
    synced_active_project: syncResult,
    refresh_runs: REFRESH_RUNS,
    refresh_run_results: runResults,
    last_status: controlMap.last_status || '',
    last_message: controlMap.last_message || '',
    validations: {
      summary_single_row_per_month: !finalMetrics.summary.has_duplicates,
      by_manager_single_row_per_snapshot_key: !finalMetrics.by_manager.has_duplicates,
      refresh_control_single_row_per_key: !finalMetrics.refresh_control.has_duplicates,
      no_row_growth_across_runs: noGrowthCheck.ok,
      refresh_trigger_count_is_one: Number(triggerDiagnostics.refresh_snapshot_trigger_count || 0) <= 1
    },
    metrics: {
      final: finalMetrics,
      per_run: runMetrics,
      no_growth_check: noGrowthCheck
    },
    trigger_diagnostics: triggerDiagnostics,
    redeploy
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
