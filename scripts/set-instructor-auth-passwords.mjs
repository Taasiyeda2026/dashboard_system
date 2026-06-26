/**
 * set-instructor-auth-passwords.mjs
 *
 * עדכון / יצירת סיסמאות Supabase Auth למדריכים פעילים.
 * משתמש ב-REST API ישיר (ללא WebSocket / Realtime).
 *
 * שימוש:
 *   node scripts/set-instructor-auth-passwords.mjs
 *
 * Secrets נדרשים (מ-Replit Secrets):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   INSTRUCTOR_PASSWORDS_JSON  — [{ "emp_id": "...", "full_name": "...", "password": "..." }]
 *
 * לא מדפיס סיסמאות. SERVICE_ROLE_KEY לא ב-frontend.
 */

import process from 'node:process';

const MIN_PASSWORD_LENGTH = 4;

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

async function restGet(baseUrl, serviceKey, path, params = {}) {
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body;
}

async function restPost(baseUrl, serviceKey, path, data) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body;
}

async function restPut(baseUrl, serviceKey, path, data) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body;
}

async function restPatch(baseUrl, serviceKey, path, data, filter = '') {
  const url = `${baseUrl}${path}${filter}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
}

async function listAllAuthUsers(baseUrl, serviceKey) {
  const out = [];
  let page = 1;
  while (true) {
    const data = await restGet(baseUrl, serviceKey, '/auth/v1/admin/users', { page, per_page: 1000 });
    const users = data?.users || [];
    out.push(...users);
    if (users.length < 1000) break;
    page += 1;
  }
  return out;
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
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

  // שליפת כל המדריכים הפעילים מ-public.users
  const usersRows = await restGet(
    supabaseUrl, serviceKey,
    '/rest/v1/users',
    { select: 'user_id,emp_id,username,full_name,role,is_active,auth_user_id,auth_email,migrated_to_auth' }
  );

  // שליפת כל Auth users
  const authUsers = await listAllAuthUsers(supabaseUrl, serviceKey);
  const authByEmail = new Map(authUsers.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const authById = new Map(authUsers.map((u) => [u.id, u]));

  // בדיקת אילנה 1506
  const ilana = (Array.isArray(usersRows) ? usersRows : []).find((r) =>
    asText(r.emp_id) === '1506' || asText(r.user_id) === '1506' || asText(r.username) === '1506'
  );
  console.log(JSON.stringify({
    check: 'ilana_1506',
    found: Boolean(ilana),
    role: ilana?.role || null,
    is_active: ilana?.is_active ?? null,
    auth_email: ilana?.auth_email || null,
    has_auth_user_id: Boolean(ilana?.auth_user_id)
  }));

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const entry of passwordEntries) {
    const empId = asText(entry?.emp_id);
    const password = asText(entry?.password);
    const fullNameInput = asText(entry?.full_name);

    const validErr = validatePassword(password, empId);
    if (validErr) {
      skipped += 1;
      console.log(JSON.stringify({ ok: false, action: 'skipped', reason: validErr, emp_id: empId }));
      continue;
    }

    const userRow = (Array.isArray(usersRows) ? usersRows : []).find((r) =>
      asText(r.emp_id) === empId || asText(r.user_id) === empId || asText(r.username) === empId
    );

    if (!userRow) {
      skipped += 1;
      console.log(JSON.stringify({ ok: false, action: 'skipped', reason: 'instructor_not_found_or_inactive', emp_id: empId }));
      continue;
    }

    const userId = asText(userRow.user_id);
    const username = asText(userRow.username) || empId;
    const fullName = asText(userRow.full_name) || fullNameInput;
    const existingAuthEmail = asText(userRow.auth_email);
    const existingAuthUserId = asText(userRow.auth_user_id);
    const authEmail = existingAuthEmail || buildAuthEmail(username);

    try {
      let action;
      let authUserId;

      if (existingAuthUserId) {
        // יש auth_user_id — עדכון סיסמה ישיר בלי חיפוש
        await restPut(supabaseUrl, serviceKey, `/auth/v1/admin/users/${existingAuthUserId}`, { password });
        authUserId = existingAuthUserId;
        action = 'updated';
        updated += 1;
      } else {
        // אין auth_user_id — חיפוש לפי email, ואם לא קיים — יצירה
        const emailKey = authEmail.toLowerCase();
        let authUser = authByEmail.get(emailKey) || null;
        if (authUser) {
          await restPut(supabaseUrl, serviceKey, `/auth/v1/admin/users/${authUser.id}`, { password });
          authUserId = authUser.id;
          action = 'updated';
          updated += 1;
        } else {
          const newAuthEmail = buildAuthEmail(username);
          authUser = await restPost(supabaseUrl, serviceKey, '/auth/v1/admin/users', {
            email: newAuthEmail,
            password,
            email_confirm: true,
            user_metadata: { employee_id: userId || empId, full_name: fullName, role: 'instructor' }
          });
          authUserId = authUser.id;
          authByEmail.set(newAuthEmail.toLowerCase(), authUser);
          action = 'created';
          created += 1;
        }
      }

      // עדכון public.users
      await restPatch(
        supabaseUrl, serviceKey,
        '/rest/v1/users',
        { auth_user_id: authUserId, auth_email: authEmail, migrated_to_auth: true, is_active: true },
        `?user_id=eq.${encodeURIComponent(userId || empId)}`
      );

      // ניקוי entry_code (אם אפשר)
      try {
        await restPatch(
          supabaseUrl, serviceKey,
          '/rest/v1/users',
          { entry_code: null },
          `?user_id=eq.${encodeURIComponent(userId || empId)}`
        );
      } catch {
        /* entry_code עלול לא לאפשר null — מדלגים */
      }

      console.log(JSON.stringify({ ok: true, action, emp_id: empId, auth_email: authEmail, auth_user_id: authUserId }));
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
    failed,
    active_instructor_emp_ids_hardcoded_list: 'REMOVED — access now from public.users role+is_active'
  }));

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exit(1);
});
