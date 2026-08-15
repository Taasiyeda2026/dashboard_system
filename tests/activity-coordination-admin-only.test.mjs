import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = await readFile(new URL('../frontend/src/activity-coordination/data.js', import.meta.url), 'utf8');
const visibility = await readFile(new URL('../frontend/src/activity-coordination/admin-visibility.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260815001500_activity_coordination_admin_only.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('coordination data waits for auth, fails closed for non-admin users and uses an admin-only email RPC', () => {
  assert.match(data, /waitForSupabaseAuthSession/);
  assert.match(data, /await waitForSupabaseAuthSession\(\{ timeoutMs: 8000 \}\)/);
  assert.match(data, /if \(!session\?\.user\?\.id\) return false/);
  assert.match(data, /rpc\('activity_coordination_is_admin'\)/);
  assert.match(data, /if \(!isAdmin\) return \{ items: \[\], byActivityId: new Map\(\), access: 'denied' \}/);
  assert.match(data, /rpc\('activity_coordination_contact_emails'/);
  assert.doesNotMatch(data, /from\('contact_emails'\)/);
});

test('admin visibility waits for auth restore and rechecks on auth lifecycle events', () => {
  assert.match(index, /activity-coordination\/admin-visibility\.js\?v=20260815-admin-only-v2/);
  assert.match(visibility, /waitForSupabaseAuthSession/);
  assert.match(visibility, /await waitForSupabaseAuthSession\(\{ timeoutMs: 8000 \}\)/);
  assert.match(visibility, /onAuthStateChange/);
  assert.match(visibility, /INITIAL_SESSION/);
  assert.match(visibility, /SIGNED_IN/);
  assert.match(visibility, /TOKEN_REFRESHED/);
  assert.match(visibility, /SIGNED_OUT/);
});

test('non-admin UI hides the coordination tab and drawer action', () => {
  assert.match(visibility, /data-activity-period-tab=\\?"coordination_approvals\\?"/);
  assert.match(visibility, /data-coordination-approval/);
  assert.doesNotMatch(visibility, /ds-table--activities-2027[\s\S]*nth-child\(5\)/);
  assert.match(visibility, /coordination-workspace/);
  assert.match(visibility, /data-activity-period-tab=\\?"year_all\\?"/);
});

test('database coordination reads and writes require the app admin role', () => {
  assert.match(migration, /create or replace function public\.activity_coordination_is_admin\(\)/i);
  assert.match(migration, /app_current_role\(\) = 'admin'/i);
  assert.match(migration, /activity_coordination_dispatches_select_admin[\s\S]*using \(public\.activity_coordination_is_admin\(\)\)/i);
  assert.match(migration, /activity_coordination_dispatch_items_select_admin[\s\S]*using \(public\.activity_coordination_is_admin\(\)\)/i);
  assert.match(migration, /reserve_activity_coordination_dispatch[\s\S]*if not public\.activity_coordination_is_admin\(\)/i);
  assert.match(migration, /mark_activity_coordination_dispatch_draft[\s\S]*if not public\.activity_coordination_is_admin\(\)/i);
  assert.match(migration, /finish_activity_coordination_dispatch[\s\S]*if not public\.activity_coordination_is_admin\(\)/i);
  assert.match(migration, /record_activity_coordination_reconciliation[\s\S]*if not public\.activity_coordination_is_admin\(\)/i);
  assert.match(migration, /where public\.activity_coordination_is_admin\(\)/i);
  assert.doesNotMatch(migration, /grant select on (table )?public\.contact_emails to authenticated/i);
});
