import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(value).trim();
}

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function buildAuthEmail(userId) {
  return `${asText(userId)}@taasiyeda.local`.toLowerCase();
}

async function listAllAuthUsers(supabase) {
  const out = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000
    });

    if (error) throw error;

    const users = data?.users || [];
    out.push(...users);

    if (users.length < 1000) break;
    page += 1;
  }

  return out;
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data: rows, error: rowsError } = await supabase
    .from('users')
    .select('user_id, entry_code, full_name, role, is_active, auth_user_id, migrated_to_auth')
    .eq('is_active', true);

  if (rowsError) throw rowsError;

  const authUsers = await listAllAuthUsers(supabase);
  const authByEmail = new Map(
    authUsers
      .filter((user) => user.email)
      .map((user) => [String(user.email).toLowerCase(), user])
  );

  let created = 0;
  let existing = 0;
  let skipped = 0;
  let updated = 0;
  let failed = 0;

  for (const row of rows || []) {
    const userId = asText(row.user_id);
    const entryCode = asText(row.entry_code);
    const fullName = asText(row.full_name);
    const role = asText(row.role);
    const authEmail = buildAuthEmail(userId);

    if (!userId || !entryCode) {
      skipped += 1;
      console.log(JSON.stringify({
        ok: false,
        action: 'skipped',
        reason: 'missing_user_id_or_entry_code',
        user_id: userId,
        full_name: fullName
      }));
      continue;
    }

    try {
      let authUser = authByEmail.get(authEmail);

      if (authUser) {
        existing += 1;
      } else {
        const { data: createdUser, error: createError } =
          await supabase.auth.admin.createUser({
            email: authEmail,
            password: entryCode,
            email_confirm: true,
            user_metadata: {
              employee_id: userId,
              full_name: fullName,
              role
            }
          });

        if (createError) throw createError;

        authUser = createdUser.user;
        authByEmail.set(authEmail, authUser);
        created += 1;
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({
          auth_user_id: authUser.id,
          auth_email: authEmail,
          migrated_to_auth: true
        })
        .eq('user_id', userId);

      if (updateError) throw updateError;

      updated += 1;

      console.log(JSON.stringify({
        ok: true,
        action: authUser.email === authEmail && existing ? 'existing' : 'created_or_existing',
        user_id: userId,
        auth_email: authEmail,
        auth_user_id: authUser.id
      }));
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        ok: false,
        action: 'failed',
        user_id: userId,
        auth_email: authEmail,
        error: error?.message || String(error)
      }));
    }
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    active_users_found: rows?.length || 0,
    created,
    existing,
    skipped,
    updated,
    failed
  }));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error)
  }));
  process.exit(1);
});
