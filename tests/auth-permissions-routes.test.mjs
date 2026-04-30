import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const AUTH_FILE = new URL('../backend/auth.gs', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);

test('can_edit_request is treated as backward-compatible alias for can_request_edit', async () => {
  const source = await readFile(AUTH_FILE, 'utf8');
  assert.match(source, /explicit\s*=\s*text_\(permission\.can_request_edit\)\.toLowerCase\(\)/);
  assert.match(source, /if\s*\(!explicit\)\s*explicit\s*=\s*text_\(permission\.can_edit_request\)\.toLowerCase\(\)/);
});

test('view_edit_requests does not grant can_request_edit in effectiveCanRequestEdit_', async () => {
  const source = await readFile(AUTH_FILE, 'utf8');
  const fnMatch = source.match(/function effectiveCanRequestEdit_\([\s\S]*?\n}\n/);
  assert.ok(fnMatch, 'effectiveCanRequestEdit_ function should exist');
  assert.doesNotMatch(fnMatch[0], /view_edit_requests/);
});

test('operation_manager can access edit-requests route, non-manager still uses view_edit_requests', async () => {
  const source = await readFile(AUTH_FILE, 'utf8');
  assert.match(source, /if \(route === 'edit-requests'\) \{[\s\S]*isOperationManagerRole_\(role\)[\s\S]*permYes_\(permission, 'view_edit_requests'\)/);
});

test('operations route is not part of known routes and operations default maps to dashboard', async () => {
  const authSource = await readFile(AUTH_FILE, 'utf8');
  const knownRoutesBlock = authSource.match(/function allKnownRoutes_\(\) \{[\s\S]*?\n}\n/);
  assert.ok(knownRoutesBlock, 'allKnownRoutes_ should exist');
  assert.doesNotMatch(knownRoutesBlock[0], /'operations'/);
  assert.match(authSource, /view_operations_data:\s*'dashboard'/);

  const mainSource = await readFile(MAIN_FILE, 'utf8');
  assert.doesNotMatch(mainSource, /operations:\s*\(\)\s*=>\s*import\('\.\/screens\/operations\.js'\)/);
});
