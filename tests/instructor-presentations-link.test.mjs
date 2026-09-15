import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DRIVE_URL = 'https://drive.google.com/drive/u/0/folders/1_RpFcgaQO8ADCPq9tjxIRckI-j9FJ8ee';

test('instructor presentations navigation uses the approved Drive folder', () => {
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  const dashboard = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/dashboard.js', import.meta.url), 'utf8');
  const marker = fs.readFileSync(new URL('../frontend/src/release-marker-20260908.js', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');

  assert.ok(index.includes(`instructorPresentationsUrl: '${DRIVE_URL}'`));
  assert.match(main, /externalUrlBlank:\s*config\.instructorPresentationsUrl/);
  assert.match(dashboard, /window\.open\(config\.instructorPresentationsUrl, '_blank'/);
  assert.match(marker, /instructor-presentations-link-20260915-v1/);
  assert.match(sw, /const CACHE_VERSION = 1718;/);
});
