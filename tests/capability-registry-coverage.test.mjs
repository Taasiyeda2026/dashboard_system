import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CAPABILITY_REGISTRY, capabilityById, routeCapability } from '../frontend/src/capability-registry.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const collect = (source, regex) => [...source.matchAll(regex)].map((match) => match[1]).filter(Boolean);

test('every capability is managed or explicitly admin-only and has a valid parent', () => {
  const ids = new Set();
  for (const item of CAPABILITY_REGISTRY) {
    assert.ok(item.id && item.label && item.type, JSON.stringify(item));
    assert.equal(ids.has(item.id), false, `duplicate capability ${item.id}`);
    ids.add(item.id);
    assert.notEqual(Boolean(item.permission), Boolean(item.adminOnly), `${item.id} must be managed XOR admin-only`);
  }
  for (const item of CAPABILITY_REGISTRY) {
    if (item.parent) assert.ok(capabilityById.has(item.parent), `orphan capability ${item.id}`);
  }
});

test('every application route is classified by the capability registry', async () => {
  const main = await read('../frontend/src/main.js');
  const loaderBlock = main.match(/const screenLoaders = \{([\s\S]*?)\n\};/)?.[1] || '';
  const routes = [...loaderBlock.matchAll(/^\s*(?:'([^']+)'|([a-z][a-z-]*))\s*:/gm)].map((match) => match[1] || match[2]);
  assert.ok(routes.length > 20, 'screen loader extraction must cover the active application');
  for (const route of routes) assert.ok(routeCapability(route), `unclassified route: ${route}`);
});

test('business tabs, operations targets and management tiles reference registered capabilities', async () => {
  const [instructors, operations, adminHome, adminData, adminMessages] = await Promise.all([
    read('../frontend/src/screens/shared/instructors-workspace-nav.js'),
    read('../frontend/src/screens/operations-management.js'),
    read('../frontend/src/screens/admin-home.js'),
    read('../frontend/src/admin-data-tool.js'),
    read('../frontend/src/admin-messages-card-runtime.js')
  ]);
  const instructorBlock = instructors.match(/INSTRUCTORS_WORKSPACE_TABS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
  for (const tab of collect(instructorBlock, /\{\s*id:\s*'([^']+)'/g)) {
    assert.ok(CAPABILITY_REGISTRY.some((item) => item.tab === tab && item.parent === 'instructors'), `unclassified instructor tab: ${tab}`);
  }
  const operationsBlock = operations.match(/OPERATIONS_HOME_TARGETS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
  for (const target of collect(operationsBlock, /value:\s*'([^']+)'/g)) {
    assert.ok(CAPABILITY_REGISTRY.some((item) => item.tab === target || item.route === target || item.routes?.includes(target)), `unclassified operations target: ${target}`);
  }
  const tileSources = `${adminHome}\n${adminData}\n${adminMessages}`;
  const ids = [...collect(tileSources, /capabilityId:\s*'([^']+)'/g), ...collect(tileSources, /capabilityId\s*=\s*'([^']+)'/g)];
  assert.ok(ids.length >= 10, 'management tile coverage unexpectedly shrank');
  for (const id of ids) assert.ok(capabilityById.has(id), `unclassified management tile: ${id}`);
});

test('sensitive finance tools have database entry-point guards, not UI-only checks', async () => {
  const migration = await read('../supabase/migrations/20260823130000_permissions_ui_source_of_truth.sql');
  assert.match(migration, /app_has_permission\('view_finance_collection'\)/);
  assert.match(migration, /app_has_permission\('manage_finance_transactions'\)/);
  assert.match(migration, /reserve_finance_transaction_account_legacy_impl/);
  assert.match(migration, /upsert_finance_collection_tracking_legacy_impl/);
});
