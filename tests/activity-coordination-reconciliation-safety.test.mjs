import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [view, outlook, activities, graphMail, migration] = await Promise.all([
  readFile(new URL('../frontend/src/activity-coordination/view.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/activity-coordination/outlook.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/microsoft/graph-mail.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260922150500_coordination_draft_owner_reconciliation.sql', import.meta.url), 'utf8')
]);

test('coordination reconciliation only inspects Outlook drafts owned by the signed-in auth user', () => {
  assert.match(view, /reconcileVisibleDrafts\(context, \{ loginHint = '', authUserId = '' \}/);
  assert.match(view, /draftOwnerId !== currentAuthUserId/);
  assert.match(activities, /authUserId: state\?\.user\?\.auth_user_id \|\| ''/);
  assert.match(migration, /active_draft\.draft_created_by/);
});

test('coordination reconciliation never cancels a draft merely because Outlook has not indexed it yet', () => {
  assert.match(outlook, /status: 'draft_missing'/);
  assert.doesNotMatch(outlook, /finishDispatch\(dispatch\.id, 'cancelled', null, 'הטיוטה הקודמת לא נמצאה'\)/);
});

test('coordination draft status is explicit and cannot be selected again as ready', () => {
  assert.match(view, /טיוטה ב-Outlook · ממתין לשליחה/);
  assert.match(view, /item\.status === COORDINATION_STATUS\.READY \? `<input type="checkbox" data-coordination-item/);
  assert.match(view, /item\.status !== COORDINATION_STATUS\.DRAFT/);
});

test('returning from Outlook triggers immediate reconciliation and periodic checks are shorter', () => {
  assert.match(activities, /setInterval\(reconcileNow, 30000\)/);
  assert.match(activities, /window\.addEventListener\('focus', state\.activityCoordinationFocusHandler\)/);
  assert.match(activities, /document\.addEventListener\('visibilitychange', state\.activityCoordinationVisibilityHandler\)/);
});

test('delegated Graph token is bound to the requested mailbox instead of the first cached account', () => {
  assert.match(graphMail, /candidate\?\.username/);
  assert.match(graphMail, /normalizedLoginHint/);
  assert.doesNotMatch(graphMail, /getAllAccounts\(\)\[0\]/);
});
