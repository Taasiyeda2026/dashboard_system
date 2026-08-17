#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildCheckPlan, collectChangedFiles } from './ci/check-plan.mjs';

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const frontendMode = args.has('--frontend');
const runTests = !args.has('--no-tests');
const jsonMode = args.has('--json');
const runPlan = args.has('--run-plan');

function run(command, commandArgs) {
  const label = [command, ...commandArgs].join(' ');
  console.log(`[check] ${label}`);
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function trackedFrontendFiles() {
  return execFileSync('git', ['ls-files', 'frontend/src/**/*.js', 'frontend/src/*.js', 'frontend/sw.js', 'sw.js'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim().split(/\r?\n/).filter(Boolean);
}

const ciBase = process.env.CI_BASE_SHA;
const ciHead = process.env.CI_HEAD_SHA;
const changedFiles = frontendMode ? trackedFrontendFiles() : collectChangedFiles({ repoRoot, base: ciBase, head: ciHead });
const plan = frontendMode ? buildCheckPlan(changedFiles) : buildCheckPlan(changedFiles, { repoRoot, base: ciBase, head: ciHead });

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
  process.exit(0);
}

for (const file of plan.syntaxFiles) run('node', ['--check', file]);

if (runTests) {
  for (const testFile of plan.tests) run('node', ['--test', testFile]);
  if (!plan.tests.length) console.log('[check] No focused application tests selected.');
}

if (runPlan && plan.build) run('npm', ['run', 'check:build']);

console.log(`[check] Groups: ${plan.groups.join(', ') || 'validation-only'}`);
console.log('[check] Focused checks complete. Full regression remains available via npm run test:all:legacy.');
