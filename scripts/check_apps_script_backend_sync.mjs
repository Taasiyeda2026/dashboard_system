#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const repoRoot = process.cwd();
const repoBackend = path.join(repoRoot, 'backend');
const criticalFiles = [
  'config.gs',
  'helpers.gs',
  'sheets.gs',
  'settings.gs',
  'router.gs',
  'actions.gs',
  'auth.gs',
  'dashboard-snapshot.gs',
  'script-cache.gs',
  'Code.gs'
];

const requiredScriptCacheFunctions = [
  'scriptCacheGetJson_',
  'scriptCachePutJson_',
  'scriptCacheDebugMark_',
  'scriptCacheInvalidateDataViews_',
  'dataViewsCacheVersion_',
  'bumpDataViewsCacheVersion_'
];

const arg = process.argv.find(a => a.startsWith('--active-dir='));
const activeDir = arg ? path.resolve(arg.split('=')[1]) : null;

function fileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hasFunction(fileContents, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\(`);
  return re.test(fileContents);
}

const report = {
  missingInRepo: [],
  scriptCacheMissingFunctions: [],
  activeComparison: {
    enabled: Boolean(activeDir),
    missingInActive: [],
    mismatched: [],
    matched: []
  }
};

for (const rel of criticalFiles) {
  const filePath = path.join(repoBackend, rel);
  if (!fs.existsSync(filePath)) {
    report.missingInRepo.push(`backend/${rel}`);
  }
}

const scriptCachePath = path.join(repoBackend, 'script-cache.gs');
if (fs.existsSync(scriptCachePath)) {
  const content = fs.readFileSync(scriptCachePath, 'utf8');
  for (const fn of requiredScriptCacheFunctions) {
    if (!hasFunction(content, fn)) {
      report.scriptCacheMissingFunctions.push(fn);
    }
  }
}

if (activeDir) {
  for (const rel of criticalFiles) {
    const repoFile = path.join(repoBackend, rel);
    const activeFile = path.join(activeDir, rel);

    if (!fs.existsSync(activeFile)) {
      report.activeComparison.missingInActive.push(`backend/${rel}`);
      continue;
    }

    const same = fileHash(repoFile) === fileHash(activeFile);
    if (same) {
      report.activeComparison.matched.push(`backend/${rel}`);
    } else {
      report.activeComparison.mismatched.push(`backend/${rel}`);
    }
  }
}

console.log(JSON.stringify(report, null, 2));

const hasIssues =
  report.missingInRepo.length > 0 ||
  report.scriptCacheMissingFunctions.length > 0 ||
  (report.activeComparison.enabled &&
    (report.activeComparison.missingInActive.length > 0 || report.activeComparison.mismatched.length > 0));

process.exit(hasIssues ? 1 : 0);
