/**
 * set-instructor-auth-passwords.mjs
 *
 * עדכון / יצירת סיסמאות Supabase Auth למדריכים פעילים.
 *
 * שימוש:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... INSTRUCTOR_PASSWORDS_JSON='[...]' \
 *   node scripts/set-instructor-auth-passwords.mjs
 *
 * INSTRUCTOR_PASSWORDS_JSON — מערך JSON בפורמט:
 *   [{ "emp_id": "1500", "password": "..." }, ...]
 *
 * הסקריפט לא מדפיס סיסמאות ללוגים ולא שומר אותן בקובץ.
 * SERVICE_ROLE_KEY אסור ב-frontend; להריץ רק מקומית / Replit shell.
 */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const MIN_PASSWORD_LENGTH = 8;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`Missing required env: ${name}`);
  return String(value).trim();
}

function asText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function buildAuthEmail(usernameOrEmpId) {
  return `${asText(usernameOrEmpId).toLowerCase()}@think.org.il`;
}

function validatePassword(password, empId) {
  if (!password || !String(password).trim()) return 'empty_password';
  if (String(password).length < MIN_PASSWORD_LENGTH) return `too_short_min_${MIN_PASSWORD_LENGTH}`;
  if (String(password).trim() === String(empId).trim()) return 'password_equals_emp_id';
  return null;
}

async function listAllAuthUsers(supabase) {
  const out = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
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
  const passwordsJson = requireEnv('INSTRUCTOR_PASSWORDS_JSON');

  let passwordEntries;
  try {
    passwordEntries = JSON.parse(passwordsJson);
  } catch {
    throw new Error('INSTRUCTOR_PASSWORDS_JSON אינו JSON תקין');
  }

  if (!Array.isArray(passwordEntries) || passwordEntries.length === 0) {
    throw new Error('INSTRUCTOR_PASSWORDS_JSON חייב להיות מערך לא ריק');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: usersRows, error: usersError } = await supabase
    .from('users')
    .select('user_id, emp_id, username, full_name, role, is_active, auth_user_id, auth_email, migrated_to_auth')
    .eq('role', 'instructor')
    .eq('is_active', true);

  if (usersError) throw usersError;

  const authUsers = await listAllAuthUsers(supabase);
  const authByEmail = new Map(
    authUsers.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u])
  );
  const authById = new Map(authUsers.map((u) => [u.id, u]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of passwordEntries) {
    const empId = asText(entry?.emp_id);
    const password = asText(entry?.password);

    const validationError = validatePassword(password, empId);
    if (validationError) {
      skipped += 1;
      console.log(JSON.stringify({ ok: false, action: 'skipped', reason: validationError, emp_id: empId }));
      continue;
    }

    const userRow = (usersRows || []).find((row) =>
      asText(row.emp_id) === empId ||
      asText(row.user_id) === empId ||
      asText(row.username) === empId
    );

    if (!userRow) {
      skipped += 1;
      console.log(JSON.stringify({ ok: false, action: 'skipped', reason: 'instructor_not_found_or_inactive', emp_id: empId }));
      continue;
    }

    const userId = asText(userRow.user_id);
    const username = asText(userRow.username) || empId;
    const fullName = asText(userRow.full_name);
    const existingAuthEmail = asText(userRow.auth_email);
    const existingAuthUserId = asText(userRow.auth_user_id);

    const authEmail = existingAuthEmail || buildAuthEmail(username);

    try {
      let authUser = existingAuthUserId ? authById.get(existingAuthUserId) : null;
      if (!authUser) authUser = authByEmail.get(authEmail.toLowerCase()) || null;

      let action;

      if (authUser) {
        const { error: updateError } = await supabase.auth.admin.updateUserById(authUser.id, { password });
        if (updateError) throw updateError;
        action = 'updated';
        updated += 1;
      } else {
        const { data: createdData, error: createError } = await supabase.auth.admin.createUser({
          email: authEmail,
          password,
          email_confirm: true,
          user_metadata: { employee_id: userId || empId, full_name: fullName, role: 'instructor' }
        });
        if (createError) throw createError;
        authUser = createdData.user;
        authByEmail.set(authEmail.toLowerCase(), authUser);
        authById.set(authUser.id, authUser);
        action = 'created';
        created += 1;
      }

      const patch = {
        auth_user_id: authUser.id,
        auth_email: authEmail,
        migrated_to_auth: true
      };

      const { error: patchError } = await supabase
        .from('users')
        .update(patch)
        .eq('user_id', userId || empId);

      if (patchError) {
        console.log(JSON.stringify({ ok: false, action: 'auth_ok_but_db_update_failed', emp_id: empId, auth_email: authEmail, error: patchError.message }));
      } else {
        try {
          await supabase.from('users').update({ entry_code: null }).eq('user_id', userId || empId);
        } catch {
          /* entry_code עלול לא לאפשר null — מדלגים בשקט */
        }
      }

      console.log(JSON.stringify({ ok: true, action, emp_id: empId, auth_email: authEmail, auth_user_id: authUser.id }));
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ ok: false, action: 'failed', emp_id: empId, auth_email: authEmail, error: error?.message || String(error) }));
    }
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    total_in_input: passwordEntries.length,
    created,
    updated,
    skipped,
    failed
  }));

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exit(1);
});
