import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260823130000_permissions_ui_source_of_truth.sql', import.meta.url),
  'utf8'
);

// Frozen expectations guard the migration against accidental privilege expansion.
const LEGACY_EFFECTIVE = Object.freeze({
  view_activities: new Set(['operation_manager', 'activities_manager', 'finance', 'domain_manager', 'business_development_manager', 'instructor_manager', 'authorized_user']),
  view_operations_management: new Set(['operation_manager', 'activities_manager']),
  view_instructors: new Set(['operation_manager', 'activities_manager', 'finance', 'domain_manager', 'business_development_manager', 'instructor_manager', 'authorized_user']),
  finance_access: new Set(),
  view_proposals_agreements: new Set(['operation_manager', 'domain_manager', 'business_development_manager']),
  can_access_personal_reports: new Set(),
  view_employee_files: new Set(),
  view_catalog: new Set(['operation_manager', 'activities_manager', 'finance', 'domain_manager', 'business_development_manager', 'instructor_manager']),
  view_orders: new Set(['operation_manager', 'activities_manager', 'finance', 'domain_manager', 'business_development_manager', 'instructor_manager']),
  view_israa_management: new Set()
});

function migrateExisting(role, existing = {}) {
  const compatibility = Object.fromEntries(
    Object.entries(LEGACY_EFFECTIVE)
      .filter(([, roles]) => roles.has(role))
      .map(([permission]) => [permission, 'yes'])
  );
  return { ...compatibility, ...existing };
}

test('compatibility snapshot preserves effective access without privilege expansion', () => {
  for (const [permission, legacyRoles] of Object.entries(LEGACY_EFFECTIVE)) {
    for (const role of ['operation_manager', 'activities_manager', 'finance', 'domain_manager', 'business_development_manager', 'instructor_manager', 'authorized_user']) {
      const before = legacyRoles.has(role);
      const after = migrateExisting(role)[permission] === 'yes';
      assert.equal(after, before, `${role}:${permission}`);
      assert.equal(migrateExisting(role, { [permission]: 'no' })[permission], 'no', `explicit no: ${role}:${permission}`);
    }
  }
});

test('migration uses a frozen legacy snapshot, not current role templates', () => {
  assert.match(migration, /legacy_effective_permissions/);
  assert.doesNotMatch(migration, /\bcomplete_templates\b|\brole_templates\b/);
  const financeBlock = migration.match(/\('finance', jsonb_build_object\(([\s\S]*?)\)\),\n  \('domain_manager'/)?.[1] || '';
  assert.doesNotMatch(financeBlock, /view_operations_management|finance_access|can_access_personal_reports|view_employee_files|view_israa_management/);
  const authorizedBlock = migration.match(/\('authorized_user', jsonb_build_object\(([\s\S]*?)\)\),\n  \('instructor'/)?.[1] || '';
  assert.doesNotMatch(authorizedBlock, /view_operations_management|view_catalog|view_orders|view_proposals_agreements|finance_access|can_access_personal_reports|view_employee_files|view_israa_management/);
});

test('legacy proposal view is not promoted into canonical database access', async () => {
  const [policy, api] = await Promise.all([
    readFile(new URL('../frontend/src/permission-policy.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(policy, /view_proposals_agreements:\s*\['view_proposals'\]/);
  assert.doesNotMatch(api, /permissionFlagYes\(flat\.view_proposals\)/);
  assert.doesNotMatch(migration, /permissions\s*->>\s*'view_proposals'/);
  const readHelper = migration.match(/create or replace function public\.app_can_use_proposals_agreements\(\)[\s\S]*?\$\$;/)?.[0] || '';
  assert.doesNotMatch(readHelper, /view_proposals'/);
});
