import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API = new URL('../frontend/src/api.js', import.meta.url);
const OPERATIONS = new URL('../frontend/src/screens/operations-management.js', import.meta.url);
const WORKSPACE = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);

test('photo consent permission survives the login and background bootstrap allowlist', async () => {
  const source = await readFile(API, 'utf8');
  const block = source.match(/permission_flags: Object\.fromEntries\(Object\.entries\(flat\)[\s\S]*?\)\),/);
  assert.ok(block, 'bootstrap permission_flags selection must exist');
  assert.match(block[0], /manage_photo_consents/, 'new permission must be included in bootstrap flags');
  assert.match(source, /state/, 'API still uses the shared auth/session path');
});

test('photo consent tile and tab require explicit per-user permission', async () => {
  const operations = await readFile(OPERATIONS, 'utf8');
  const workspace = await readFile(WORKSPACE, 'utf8');
  assert.match(operations, /\{ label: 'אישורי צילום', type: 'ops-tab', value: TAB_PHOTO \}/);
  assert.match(operations, /tabs\.filter\(\(\[key\]\) => canOpenPhotoTab\(state\?\.user, key\)\)/);
  assert.match(operations, /OPERATIONS_HOME_TARGETS\.filter\([\s\S]*?canOpenPhotoTab\(state\?\.user, value\)/);
  const gate = operations.match(/function canOpenPhotoTab\(user, tab\) \{[\s\S]*?\n\}/);
  assert.ok(gate);
  assert.match(gate[0], /user\?\.permissions\?\.manage_photo_consents/);
  assert.doesNotMatch(gate[0], /role\s*===?\s*['"]admin/);
  assert.match(workspace, /state\?\.user\?\.permissions\?\.manage_photo_consents/);
});
