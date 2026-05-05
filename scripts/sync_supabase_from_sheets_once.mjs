import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(value).trim();
}

async function readJsonFile(path) {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array in ${path}`);
  }
  return parsed;
}

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const normalized = asText(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'active', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'inactive', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function parsePermissions(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = asText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapPermissionRow(row) {
  return {
    user_id: asText(row.user_id || row.UserID || row.user || row.email),
    email: asText(row.email || row.Email),
    name: asText(row.name || row.full_name || row.Name || row.display_name),
    role: asText(row.role || row.Role || 'authorized_user') || 'authorized_user',
    emp_id: asText(row.emp_id || row.EmployeeID || row.employee_id),
    is_active: asBool(row.is_active ?? row.active ?? row.Active, true),
    permissions: parsePermissions(row.permissions ?? row.Permissions),
    entry_code: asText(row.entry_code || row.EntryCode)
  };
}

function mapSettingRow(row) {
  return {
    key: asText(row.key || row.Key),
    value: asText(row.value || row.Value),
    description: asText(row.description || row.Description)
  };
}

async function upsertUsers(supabase, rows) {
  const payload = rows
    .map(mapPermissionRow)
    .filter((row) => row.user_id);
  if (!payload.length) return 0;
  const { error } = await supabase.from('users').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
  return payload.length;
}

async function upsertSettings(supabase, rows) {
  const payload = rows
    .map(mapSettingRow)
    .filter((row) => row.key);
  if (!payload.length) return 0;
  const { error } = await supabase.from('settings').upsert(payload, { onConflict: 'key' });
  if (error) throw error;
  return payload.length;
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const permissionsPath = requireEnv('PERMISSIONS_SHEET_JSON');
  const settingsPath = requireEnv('SETTINGS_SHEET_JSON');
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [permissionRows, settingRows] = await Promise.all([
    readJsonFile(permissionsPath),
    readJsonFile(settingsPath)
  ]);

  const usersCount = await upsertUsers(supabase, permissionRows);
  const settingsCount = await upsertSettings(supabase, settingRows);

  console.log(JSON.stringify({
    ok: true,
    users_upserted: usersCount,
    settings_upserted: settingsCount
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error)
  }));
  process.exit(1);
});
