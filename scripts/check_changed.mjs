#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const frontendMode = args.has('--frontend');
const runTests = !args.has('--no-tests');

const ignoredPrefixes = ['dist/', 'node_modules/', '.git/'];
const jsExtensions = new Set(['.js', '.mjs', '.cjs']);

const screenTestMap = new Map([
  ['frontend/src/screens/proposals-agreements.js', 'tests/proposals-agreements-screen.test.mjs'],
  ['frontend/src/screens/activities.js', 'tests/activities-render.test.mjs'],
  ['frontend/src/screens/admin-settings.js', 'tests/admin-settings-screen.test.mjs'],
  ['frontend/src/screens/permissions.js', 'tests/permissions-screen.test.mjs']
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function isIgnored(relPath) {
  return ignoredPrefixes.some((prefix) => relPath.startsWith(prefix));
}

function walk(dir) {
  const fullDir = path.join(repoRoot, dir);
  if (!fs.existsSync(fullDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    const full = path.join(fullDir, entry.name);
    const rel = toPosix(path.relative(repoRoot, full));
    if (isIgnored(rel)) continue;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function changedFilesFromGit() {
  try {
    const output = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const filePart = line.slice(3).replace(/^"|"$/g, '');
        const renamed = filePart.includes(' -> ') ? filePart.split(' -> ').pop() : filePart;
        return toPosix(renamed);
      })
      .filter((file) => file && exists(file) && !isIgnored(file));
  } catch {
    return [];
  }
}

function filesToCheck() {
  if (frontendMode) {
    return [
      ...walk('frontend/src'),
      'frontend/sw.js',
      'sw.js'
    ].filter((file) => exists(file) && jsExtensions.has(path.extname(file)));
  }

  return changedFilesFromGit().filter((file) => jsExtensions.has(path.extname(file)));
}

function run(command, commandArgs) {
  const label = [command, ...commandArgs].join(' ');
  console.log(`[check] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const checkFiles = Array.from(new Set(filesToCheck()));
if (!checkFiles.length) {
  console.log('[check] No changed JS/MJS files to syntax-check.');
} else {
  for (const file of checkFiles) {
    run('node', ['--check', file]);
  }
}

if (runTests && !frontendMode) {
  const relevantTests = Array.from(new Set(
    changedFilesFromGit()
      .map((file) => screenTestMap.get(file))
      .filter((file) => file && exists(file))
  ));

  for (const testFile of relevantTests) {
    run('node', ['--test', testFile]);
  }

  if (!relevantTests.length) {
    console.log('[check] No mapped screen tests for changed files.');
  }
}

console.log('[check] Focused checks complete. Use npm run test:all:legacy only when explicitly needed.');
