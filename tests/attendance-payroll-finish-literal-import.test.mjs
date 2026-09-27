import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATTENDANCE_CONTROL = join(ROOT, 'frontend/src/screens/attendance-control.js');
const DIST_ASSETS = join(ROOT, 'dist/assets');
const FINISH_VERSION = '20260927-training-km-field-choice-v2';

async function collectJsFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsFiles(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

test('attendance-control loads payroll-control-finish via literal dynamic import only', async () => {
  const source = await readFile(ATTENDANCE_CONTROL, 'utf8');
  assert.doesNotMatch(source, /finishModuleImport/);
  assert.doesNotMatch(source, /import\(\s*finishModuleImport\s*\)/);
  assert.doesNotMatch(source, /const\s+\w+\s*=\s*['"]\.\/payroll-control-finish\.js/);
  const literalImports = source.match(
    /import\(\s*['"]\.\/payroll-control-finish\.js\?v=[^'"]+['"]\s*\)/g
  ) || [];
  assert.ok(literalImports.length >= 4, 'expected at least four literal finish-module imports');
  for (const statement of literalImports) {
    assert.match(statement, new RegExp(`\\?v=${FINISH_VERSION}`));
  }
});

test('built dist rewrites payroll-control-finish imports to hashed chunks', async () => {
  assert.ok(existsSync(DIST_ASSETS), 'run npm run build before verifying dist finish-module imports');
  const jsFiles = await collectJsFiles(DIST_ASSETS);
  assert.ok(jsFiles.length > 0, 'dist/assets must contain built JS chunks');

  const brokenPatterns = [
    /assets\/payroll-control-finish\.js(?:\?|$|["'])/,
    /\.\/payroll-control-finish\.js\?v=/,
    /payroll-control-finish\.js\?v=/
  ];

  let hashedFinishChunk = null;
  for (const filePath of jsFiles) {
    const source = await readFile(filePath, 'utf8');
    for (const pattern of brokenPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${filePath} must not keep a raw payroll-control-finish.js runtime import`
      );
    }
    if (/payroll-control-finish-[A-Za-z0-9_-]+\.js/.test(filePath)
      || /payroll-control-finish-[A-Za-z0-9_-]+\.js/.test(source)) {
      hashedFinishChunk = filePath;
    }
  }

  const hashedFiles = jsFiles.filter((filePath) => /payroll-control-finish-[A-Za-z0-9_-]+\.js$/.test(filePath));
  assert.ok(
    hashedFiles.length > 0 || hashedFinishChunk,
    'Vite must emit a hashed payroll-control-finish chunk under dist/assets'
  );
});
