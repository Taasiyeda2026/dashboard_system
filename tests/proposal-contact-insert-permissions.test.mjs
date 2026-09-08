import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260908123000_restore_proposal_manager_contact_insert.sql', import.meta.url),
  'utf8',
);
const approvedMatrix = await readFile(
  new URL('../supabase/migrations/20260823200000_apply_approved_permission_matrix.sql', import.meta.url),
  'utf8',
);

test('school-contact insert accepts contact managers or proposal managers only', () => {
  assert.match(migration, /create policy contacts_schools_insert_managers/i);
  assert.match(
    migration,
    /for insert\s+to authenticated\s+with check \(\s*public\.app_is_admin_or_operation_manager\(\)\s+or public\.app_can_manage_proposals_agreements\(\)\s*\)/i,
  );
  assert.doesNotMatch(migration, /for (?:update|delete)/i);
  assert.doesNotMatch(migration, /alter table|insert into public\.users|update public\.users/i);
});

test('Israas approved permission matrix includes proposal management', () => {
  const israaRow = approvedMatrix.match(/\('3030', array\[(.*?)\]\)/s)?.[1] || '';
  assert.match(israaRow, /'manage_proposals_agreements'/);
});
