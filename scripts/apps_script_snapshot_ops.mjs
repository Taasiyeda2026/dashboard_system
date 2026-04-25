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
 */

const {
  GOOGLE_OAUTH_ACCESS_TOKEN,
  GAS_SCRIPT_ID,
  SPREADSHEET_ID,
  REDEPLOY_WEBAPP,
  WEBAPP_DEPLOYMENT_ID
} = process.env;

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

async function readRange(rangeA1) {
  const range = encodeURIComponent(rangeA1);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${range}`;
  const data = await gfetch(url, { headers: { Authorization: `Bearer ${GOOGLE_OAUTH_ACCESS_TOKEN}` } });
  return data.values || [];
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(String);
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });
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

  await runFunction('refreshDashboardSnapshots');

  const controlRows = rowsToObjects(
    await readRange('dashboard_refresh_control!A1:C')
  );

  const controlMap = Object.fromEntries(
    controlRows.map((r) => [String(r.key || ''), String(r.value || '')])
  );

  const lastStatus = controlMap.last_status || '';
  const lastMessage = controlMap.last_message || '';

  const summaryRows = rowsToObjects(
    await readRange('dashboard_summary_snapshot!A1:T')
  );
  const byManagerRows = rowsToObjects(
    await readRange('dashboard_by_manager_snapshot!A1:L')
  );

  const summaryFilled = summaryRows.length > 0;
  const byManagerFilled = byManagerRows.length > 0;

  const redeploy = await maybeRedeploy();

  const result = {
    last_status: lastStatus,
    last_message: lastMessage,
    snapshots: {
      dashboard_summary_snapshot_filled: summaryFilled,
      dashboard_by_manager_snapshot_filled: byManagerFilled
    },
    redeploy
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
