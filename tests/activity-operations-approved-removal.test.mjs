import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migrationUrl = new URL('supabase/migrations/20261029221500_allow_admin_operations_remove_approved_activities.sql', root);
const frontendUrl = new URL('frontend/src/activity-performance-runtime.js', root);

test('admin and operation_manager may soft-remove activities with protected evidence', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /public\.app_can_delete_activity\(\)/);
  assert.match(sql, /protected_evidence_exists/);
  assert.match(sql, /sent_coordination_exists or protected_evidence_exists/);
  assert.match(sql, /coalesce\(public\.app_current_role\(\), ''\) not in \('admin', 'operation_manager'\)/);
  assert.match(sql, /return new;/);
  assert.ok(sql.indexOf('if sent_coordination_exists or protected_evidence_exists then') < sql.indexOf('delete from public.activities'));
});

test('approval, attendance, financial and coordination history is not destroyed', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'attendance_records',
    'activity_completion_approval_uploads',
    'activity_coordination_dispatch_items',
    'finance_collection_tracking',
    'finance_transaction_account_lines',
    'finance_transaction_account_meetings',
    'course_meeting_cancellations',
    'course_meeting_instructor_history',
  ]) assert.match(sql, new RegExp(table));
  assert.doesNotMatch(sql, /delete from public\.(attendance_records|activity_completion_approval_uploads|activity_coordination_dispatch_items r|finance_collection_tracking|finance_transaction_account_lines|finance_transaction_account_meetings)/);
  assert.match(sql, /delete from public\.activities/);
});

test('both privileged roles see the audit-safe confirmation and other permissions remain gated', async () => {
  const [sql, frontend] = await Promise.all([readFile(migrationUrl, 'utf8'), readFile(frontendUrl, 'utf8')]);
  assert.match(frontend, /const privilegedDeleting = \['admin', 'operation_manager'\]/);
  assert.match(frontend, /גם אישורים, נוכחות ונתוני כספים קיימים יישמרו/);
  assert.match(sql, /errcode = '23503'/);
  assert.match(frontend, /הסרה אינה מבטלת הודעה שכבר נשלחה לבית הספר/);
});
