import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const ACCESS_PERMISSIONS = Object.freeze({
  view_dashboard: 'yes',
  access_attendance_reporting: 'yes',
  access_password_recovery: 'yes',
});

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function rpc(req: Request, name: string, body: Record<string, unknown>) {
  const url = clean(Deno.env.get('SUPABASE_URL'));
  const key = clean(Deno.env.get('SUPABASE_ANON_KEY'));
  const authorization = clean(req.headers.get('authorization'));
  if (!url || !key || !authorization) throw new Error('not_authorized');

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name}_failed:${response.status}`);
  return await response.json();
}

async function assertOnboardingAllowed(req: Request) {
  const user = await rpc(req, 'get_current_app_user', {});
  const current = Array.isArray(user) ? user[0] : user;
  const permissions = current?.permissions || {};
  const allowed = [true, 'yes', 'true', '1', 1].includes(permissions?.manage_instructor_onboarding)
    && [true, 'yes', 'true', '1', 1].includes(permissions?.view_instructors);
  if (!current?.is_active || (clean(current?.role) !== 'admin' && !allowed)) {
    throw new Error('not_authorized');
  }
}

function syntheticAuthEmail(empId: number) {
  return `${empId}@taasiyeda.local`.toLowerCase();
}

function randomInitialPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `Taasiyeda-${token}!9a`;
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((user) => clean(user.email).toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, message: 'method_not_allowed' }, 405);

  try {
    await assertOnboardingAllowed(req);

    const body = await req.json().catch(() => ({}));
    const empId = Number(body?.emp_id);
    if (!Number.isSafeInteger(empId) || empId <= 0) {
      return json({ ok: false, message: 'invalid_employee_id' }, 400);
    }

    const supabaseUrl = clean(Deno.env.get('SUPABASE_URL'));
    const serviceRoleKey = clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    if (!supabaseUrl || !serviceRoleKey) throw new Error('service_not_configured');

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: instructor, error: instructorError } = await admin
      .from('contacts_instructors')
      .select('emp_id,full_name,email,active')
      .eq('emp_id', empId)
      .maybeSingle();
    if (instructorError) throw instructorError;
    if (!instructor || ['no', 'false', '0', 'inactive'].includes(clean(instructor.active).toLowerCase())) {
      return json({ ok: false, message: 'active_instructor_not_found' }, 404);
    }

    const userId = String(empId);
    const { data: existingUser, error: existingUserError } = await admin
      .from('users')
      .select('user_id,emp_id,username,name,full_name,email,role,is_active,permissions,auth_user_id,auth_email,migrated_to_auth')
      .eq('user_id', userId)
      .maybeSingle();
    if (existingUserError) throw existingUserError;

    const permissions = {
      ...(existingUser?.permissions && typeof existingUser.permissions === 'object' ? existingUser.permissions : {}),
      ...ACCESS_PERMISSIONS,
    };

    let authUser = null;
    const linkedAuthId = clean(existingUser?.auth_user_id);
    if (linkedAuthId) {
      const { data, error } = await admin.auth.admin.getUserById(linkedAuthId);
      if (!error && data?.user) authUser = data.user;
    }

    const authEmail = syntheticAuthEmail(empId);
    if (!authUser) {
      authUser = await findAuthUserByEmail(admin, authEmail);
    }

    let createdAuth = false;
    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: authEmail,
        password: randomInitialPassword(),
        email_confirm: true,
        user_metadata: {
          employee_id: userId,
          full_name: clean(instructor.full_name),
          role: 'instructor',
        },
      });
      if (error) throw error;
      authUser = data?.user || null;
      createdAuth = true;
    }
    if (!authUser?.id) throw new Error('auth_user_not_created');

    const payload = {
      user_id: userId,
      emp_id: userId,
      username: clean(existingUser?.username) || userId,
      name: clean(instructor.full_name),
      full_name: clean(instructor.full_name),
      role: 'instructor',
      display_role: clean(existingUser?.display_role) || 'instructor',
      email: clean(instructor.email),
      is_active: true,
      permissions,
      auth_user_id: authUser.id,
      auth_email: clean(authUser.email) || authEmail,
      migrated_to_auth: true,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await admin
      .from('users')
      .upsert(payload, { onConflict: 'user_id' });
    if (upsertError) throw upsertError;

    return json({
      ok: true,
      emp_id: empId,
      created_auth: createdAuth,
      migrated_to_auth: true,
      permissions: ACCESS_PERMISSIONS,
    });
  } catch (error) {
    console.error('[instructor-onboarding-access]', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'not_authorized' ? 403 : 500;
    return json({ ok: false, message: status === 403 ? 'not_authorized' : 'access_provision_failed' }, status);
  }
});
