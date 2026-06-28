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
 *   INSTRUCTOR_PASSWORDS_JSON  — [{ "emp_id": "...", "full_name": "...", "password": "..." }] או [{ "full_name": "...", "username": "...", "password": "..." }]
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

function normalizeKey(value) {
  return asText(value).toLowerCase();
}

function buildAuthEmail(usernameOrEmpId) {
  return `${normalizeKey(usernameOrEmpId)}@think.org.il`;
}

function validatePassword(password, identifier) {
  if (!password || !String(password).trim()) return 'empty_password';
  if (String(password).length < MIN_PASSWORD_LENGTH) return `too_short_min_${MIN_PASSWORD_LENGTH}`;
  if (identifier && String(password).trim() === String(identifier).trim()) return 'password_equals_identifier';
  return null;
}

function normalizeEntry(entry) {
  const empId = asText(entry?.emp_id);
  const username = asText(entry?.username) || empId;
  const fullName = asText(entry?.full_name);
  const password = asText(entry?.password);
  if (!username) return { error: 'missing_username_or_emp_id', empId, username, fullName };
  if (!fullName) return { error: 'missing_full_name', empId, username, fullName };
  const passwordError = validatePassword(password, empId || username);
  if (passwordError) return { error: passwordError, empId, username, fullName };
  return { empId, username, fullName, password, authEmail: buildAuthEmail(username) };
}

function buildUserIndexes(rows) {
  const byFullName = new Map();
  const byUsername = new Map();
  const byAuthEmail = new Map();
  const byEmpId = new Map();
  const byUserId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const fullName = normalizeKey(row.full_name || row.name);
    const username = normalizeKey(row.username);
    const authEmail = normalizeKey(row.auth_email);
    const empId = normalizeKey(row.emp_id);
    const userId = normalizeKey(row.user_id);
    if (fullName && !byFullName.has(fullName)) byFullName.set(fullName, row);
    if (username && !byUsername.has(username)) byUsername.set(username, row);
    if (authEmail && !byAuthEmail.has(authEmail)) byAuthEmail.set(authEmail, row);
    if (empId && !byEmpId.has(empId)) byEmpId.set(empId, row);
    if (userId && !byUserId.has(userId)) byUserId.set(userId, row);
  }
  return { byFullName, byUsername, byAuthEmail, byEmpId, byUserId };
}

function findUserRow(indexes, entry) {
  return indexes.byFullName.get(normalizeKey(entry.fullName))
    || indexes.byUsername.get(normalizeKey(entry.username))
    || indexes.byAuthEmail.get(normalizeKey(entry.authEmail))
    || (entry.empId ? indexes.byEmpId.get(normalizeKey(entry.empId)) : null)
    || (entry.empId ? indexes.byUserId.get(normalizeKey(entry.empId)) : null)
    || null;
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

async function restPost(baseUrl, serviceKey, path, data, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders
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

async function restPatch(baseUrl, serviceKey, path, data, filter = '', extraHeaders = {}) {
  const url = `${baseUrl}${path}${filter}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...extraHeaders
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
}

async function signInWithPassword(baseUrl, apiKey, email, password) {
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error_description || body?.msg || body?.message || body?.error || `HTTP ${res.status}`);
  return body;
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
  const verifyLogins = ['1', 'true', 'yes'].includes(normalizeKey(process.env.VERIFY_INSTRUCTOR_LOGINS));
  const authSignInKey = asText(process.env.SUPABASE_ANON_KEY) || serviceKey;

  let passwordEntries;
  try {
    passwordEntries = JSON.parse(passwordsJson);
  } catch {
    throw new Error('INSTRUCTOR_PASSWORDS_JSON אינו JSON תקין');
  }
  if (!Array.isArray(passwordEntries) || passwordEntries.length === 0) {
    throw new Error('INSTRUCTOR_PASSWORDS_JSON חייב להיות מערך לא ריק');
  }

  const usersRows = await restGet(
    supabaseUrl, serviceKey,
    '/rest/v1/users',
    { select: 'user_id,emp_id,username,name,full_name,role,display_role,is_active,auth_user_id,auth_email,migrated_to_auth' }
  );

  const authUsers = await listAllAuthUsers(supabaseUrl, serviceKey);
  const authByEmail = new Map(authUsers.filter((u) => u.email).map((u) => [normalizeKey(u.email), u]));
  const authById = new Map(authUsers.map((u) => [u.id, u]));
  const userIndexes = buildUserIndexes(usersRows);

  let created = 0, updated = 0, skipped = 0, failed = 0, verified = 0;

  for (const rawEntry of passwordEntries) {
    const entry = normalizeEntry(rawEntry);
    if (entry.error) {
      skipped += 1;
      console.log(JSON.stringify({ ok: false, action: 'skipped', reason: entry.error, username: entry.username || null, full_name: entry.fullName || null }));
      continue;
    }

    let userRow = findUserRow(userIndexes, entry);
    const publicUserAction = userRow ? 'updated' : 'created';
    const existingAuthUserId = asText(userRow?.auth_user_id);
    const existingAuthUser = existingAuthUserId ? authById.get(existingAuthUserId) : null;
    const existingEmailAuthUser = authByEmail.get(normalizeKey(entry.authEmail)) || null;
    let authUser = existingAuthUser || existingEmailAuthUser || null;
    const publicUserId = asText(userRow?.user_id) || entry.empId || entry.username;
    const preservedEmpId = asText(userRow?.emp_id) || entry.empId || null;

    try {
      let authAction = 'updated';
      if (authUser) {
        authUser = await restPut(supabaseUrl, serviceKey, `/auth/v1/admin/users/${authUser.id}`, {
          email: entry.authEmail,
          password: entry.password,
          email_confirm: true,
          user_metadata: { employee_id: preservedEmpId || publicUserId, full_name: entry.fullName, role: 'instructor', username: entry.username }
        });
        updated += 1;
      } else {
        authUser = await restPost(supabaseUrl, serviceKey, '/auth/v1/admin/users', {
          email: entry.authEmail,
          password: entry.password,
          email_confirm: true,
          user_metadata: { employee_id: preservedEmpId || publicUserId, full_name: entry.fullName, role: 'instructor', username: entry.username }
        });
        authAction = 'created';
        created += 1;
      }
      authByEmail.set(normalizeKey(entry.authEmail), authUser);
      authById.set(authUser.id, authUser);

      const publicPayload = {
        username: entry.username,
        name: entry.fullName,
        full_name: entry.fullName,
        auth_email: entry.authEmail,
        role: 'instructor',
        display_role: 'instructor',
        is_active: true,
        migrated_to_auth: true,
        auth_user_id: authUser.id
      };
      if (preservedEmpId) publicPayload.emp_id = preservedEmpId;

      if (userRow) {
        await restPatch(supabaseUrl, serviceKey, '/rest/v1/users', publicPayload, `?user_id=eq.${encodeURIComponent(publicUserId)}`);
      } else {
        userRow = await restPost(supabaseUrl, serviceKey, '/rest/v1/users', { user_id: publicUserId, ...publicPayload }, { Prefer: 'return=representation' });
      }

      try {
        await restPatch(supabaseUrl, serviceKey, '/rest/v1/users', { entry_code: null }, `?user_id=eq.${encodeURIComponent(publicUserId)}`);
      } catch {
        /* entry_code may be absent or non-nullable — skip without failing the secure auth sync. */
      }

      if (verifyLogins) {
        await signInWithPassword(supabaseUrl, authSignInKey, entry.authEmail, entry.password);
        verified += 1;
      }

      console.log(JSON.stringify({
        ok: true,
        action: authAction,
        username: entry.username,
        full_name: entry.fullName,
        public_user: publicUserAction,
        has_auth_user_id: Boolean(authUser.id),
        login_verified: verifyLogins ? true : undefined
      }));
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ ok: false, action: 'failed', username: entry.username, full_name: entry.fullName, error: error?.message || String(error) }));
    }
  }

  console.log(JSON.stringify({ ok: failed === 0, total_in_input: passwordEntries.length, created, updated, skipped, failed, verified }));
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exit(1);
});
