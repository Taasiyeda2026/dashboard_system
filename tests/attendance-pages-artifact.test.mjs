import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATTENDANCE_ROOT = join(ROOT, 'attendance');
const DIST_ATTENDANCE_ROOT = join(ROOT, 'dist', 'attendance');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

test('Pages attendance artifact is a verbatim copy of the current Attendance V2 runtime', async () => {
  assert.ok(existsSync(DIST_ATTENDANCE_ROOT), 'run npm run build before verifying the Pages artifact');
  const sourceFiles = [
    join(ATTENDANCE_ROOT, 'index.html'),
    join(ATTENDANCE_ROOT, 'manifest.json'),
    join(ATTENDANCE_ROOT, 'sw.js'),
    ...await collectFiles(join(ATTENDANCE_ROOT, 'src'))
  ];

  for (const sourcePath of sourceFiles) {
    const relPath = relative(ATTENDANCE_ROOT, sourcePath);
    const artifactPath = join(DIST_ATTENDANCE_ROOT, relPath);
    assert.ok(existsSync(artifactPath), `Pages artifact is missing attendance/${relPath}`);
    assert.equal(
      await readFile(artifactPath, 'utf8'),
      await readFile(sourcePath, 'utf8'),
      `Pages artifact is stale for attendance/${relPath}`
    );
  }
});

test('Attendance cache and cache-busting version stay aligned in the Pages artifact', async () => {
  const [sourceSw, sourceHtml, artifactSw, artifactHtml] = await Promise.all([
    readFile(join(ATTENDANCE_ROOT, 'sw.js'), 'utf8'),
    readFile(join(ATTENDANCE_ROOT, 'index.html'), 'utf8'),
    readFile(join(DIST_ATTENDANCE_ROOT, 'sw.js'), 'utf8'),
    readFile(join(DIST_ATTENDANCE_ROOT, 'index.html'), 'utf8')
  ]);
  const sourceVersion = sourceSw.match(/const CACHE_VERSION = (\d+);/)?.[1];
  const artifactVersion = artifactSw.match(/const CACHE_VERSION = (\d+);/)?.[1];

  assert.ok(sourceVersion, 'Attendance source service worker must declare a cache version');
  assert.equal(artifactVersion, sourceVersion, 'Pages artifact must use the current Attendance cache version');
  for (const html of [sourceHtml, artifactHtml]) {
    const versions = [...html.matchAll(/\?v=(\d+)/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, 'Attendance HTML must version its runtime assets');
    assert.deepEqual([...new Set(versions)], [sourceVersion], 'Attendance HTML asset versions must match CACHE_VERSION');
  }
});