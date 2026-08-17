import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260817114500_employee_file_service_role_refresh_access.sql', import.meta.url),
  'utf8'
);

test('employee-file refresh grants snapshot persistence only to the server service role', () => {
  assert.match(migration, /grant select on public\.instructor_employee_folders to service_role/i);
  assert.match(migration, /grant select, insert, update on public\.instructor_employee_document_status to service_role/i);
  assert.doesNotMatch(migration, /to\s+(?:anon|authenticated)\b/i);
});
