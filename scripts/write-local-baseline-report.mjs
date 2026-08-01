import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const OUTPUT_ROOT = path.join(os.tmpdir(), 'ds-stage-2-baseline');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function safeOutputPath(fileName, outputRoot = OUTPUT_ROOT) {
  const root = path.resolve(outputRoot);
  const candidate = path.resolve(root, String(fileName || ''));
  if (!inside(root, candidate)) throw new Error('baseline_output_path_not_allowed');
  const blocked = new Set(['frontend', 'dist', 'public', 'sw', 'service-worker', 'precache']);
  if (candidate.split(path.sep).some((part) => blocked.has(part.toLowerCase()))) throw new Error('baseline_output_path_not_allowed');
  return candidate;
}

function size(value) { return Number.isFinite(value) ? value : 'N/A'; }
function csv(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export function buildReport(payload = {}) {
  const rows = Array.isArray(payload.records) ? payload.records : [];
  const fetchIds = new Set(rows.filter((row) => row.source === 'fetch+resource' && row.matched_fetch_id).map((row) => row.matched_fetch_id));
  const unique = rows.filter((row) => !(row.source === 'fetch' && fetchIds.has(row.id)));
  const grouped = new Map();
  unique.forEach((row) => {
    const scenario = row.scenario?.name || 'unassigned';
    const key = `${scenario}|${row.method || 'UNKNOWN'}|${row.service}|${row.path}|${row.request_shape_group || ''}`;
    const list = grouped.get(key) || [];
    list.push(row); grouped.set(key, list);
  });
  const duplicates = [...grouped.values()].filter((list) => list.length > 1 && Math.max(...list.map((r) => r.started_at_ms || 0)) - Math.min(...list.map((r) => r.started_at_ms || 0)) <= 1500);
  const heavy = unique.filter((row) => Number.isFinite(row.transfer_size)).sort((a, b) => b.transfer_size - a.transfer_size).slice(0, 10);
  const summaries = [...new Set(unique.map((row) => row.scenario?.name || 'unassigned'))].map((name) => {
    const subset = unique.filter((row) => (row.scenario?.name || 'unassigned') === name);
    return { scenario: name, temperature: subset[0]?.scenario?.temperature || 'unknown', requests: subset.length, transfer_size: subset.every((r) => !Number.isFinite(r.transfer_size)) ? 'N/A' : subset.reduce((sum, r) => sum + (Number.isFinite(r.transfer_size) ? r.transfer_size : 0), 0), duration_ms: subset.length ? Math.max(...subset.map((r) => (r.started_at_ms || 0) + (r.duration_ms || 0))) - Math.min(...subset.map((r) => r.started_at_ms || 0)) : 0 };
  });
  const csvText = ['scenario,temperature,requests,transfer_size,duration_ms', ...summaries.map((r) => [r.scenario, r.temperature, r.requests, r.transfer_size, r.duration_ms].map(csv).join(','))].join('\n');
  const table = ['| Scenario | Temperature | Requests | Transfer bytes | Duration ms |', '|---|---|---:|---:|---:|', ...summaries.map((r) => `| ${r.scenario} | ${r.temperature} | ${r.requests} | ${size(r.transfer_size)} | ${Math.round(r.duration_ms)} |`)].join('\n');
  const markdown = `# Stage 2 local baseline\n\n${table}\n\n## Ten heaviest requests\n\n${heavy.map((r, i) => `${i + 1}. ${r.service} ${r.path} — ${r.transfer_size} bytes`).join('\n') || 'None / N/A'}\n\n## Duplicate requests\n\n${duplicates.map((list) => `- ${list[0].service} ${list[0].path}: ${list.length}`).join('\n') || 'None'}\n\n## Early loads\n\n${unique.filter((r) => r.context?.tab === 'unknown' && /completion|inventory|document|storage/.test(`${r.service} ${r.path}`)).map((r) => `- ${r.service} ${r.path}`).join('\n') || 'None detected'}\n\n## Cold versus warm\n\n${summaries.map((r) => `- ${r.scenario}: ${r.temperature}, ${r.requests} requests, ${size(r.transfer_size)} bytes`).join('\n')}\n\n## Expected-impact ranking\n\n${heavy.map((r, i) => `${i + 1}. ${r.service} ${r.path}`).join('\n') || 'Insufficient size data'}\n`;
  return { normalized: { schema_version: 1, records: unique }, csv: csvText, markdown, duplicates, heavy, summaries };
}

export function writeReport(inputPath, outputRoot = OUTPUT_ROOT) {
  const report = buildReport(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(safeOutputPath('baseline.normalized.json', outputRoot), `${JSON.stringify(report.normalized, null, 2)}\n`);
  fs.writeFileSync(safeOutputPath('baseline-summary.csv', outputRoot), `${report.csv}\n`);
  fs.writeFileSync(safeOutputPath('baseline-report.md', outputRoot), report.markdown);
  return outputRoot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: npm run baseline:report -- /path/to/export.json');
  console.log(writeReport(path.resolve(process.argv[2])));
}
