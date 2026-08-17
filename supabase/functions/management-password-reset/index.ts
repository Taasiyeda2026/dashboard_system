import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MANAGEMENT_ROLES = [
  'admin',
  'operation_manager',
  'finance',
  'activities_manager',
  'domain_manager',
  'business_development_manager',
  'instructor_manager'
];
const MANAGEMENT_ROLE_SET = new Set(MANAGEMENT_ROLES);
const TEST_EMPLOYEE_ID = '9901';

const PROD_ORIGIN = 'https://taasiyeda2026.github.io';
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function responseHeaders(origin = '') {
  const allowedOrigin = origin === PROD_ORIGIN || DEV_ORIGINS.has(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}

function genericOk(origin = '') {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: responseHeaders(origin) });
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function isAllowedRecoveryUser(row: Record<string, unknown> | null | undefined) {
  if (!row) return false;
  const role = String(row.role || '').trim();
  if (MANAGEMENT_ROLE_SET.has(role)) return true;
  return role === 'instructor'
    && String(row.user_id || '').trim() === TEST_EMPLOYEE_ID
    && String(row.emp_id || '').trim() === TEST_EMPLOYEE_ID;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: responseHeaders(origin) });
  }

  // This endpoint is intentionally unauthenticated because it is used from the login screen.
  // It never reveals whether an account exists and only sends a recovery email to an allowed
  // organizational account. Employee 9901 is the single pinned instructor test account.
  if (origin && origin !== PROD_ORIGIN && !DEV_ORIGINS.has(origin)) return genericOk(origin);

  let email = '';
  try {
    const body = await req.json();
    email = normalizeEmail(body?.email);
  } catch {
    return genericOk(origin);
  }

  if (!email || !email.endsWith('@think.org.il')) return genericOk(origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return genericOk(origin);

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Management is a small set. Load active management rows plus the single pinned
    // instructor test account, then compare normalized emails in code so '_' is literal.
    const [{ data: managementRows }, { data: testEmployeeRow }] = await Promise.all([
      admin
        .from('users')
        .select('user_id,emp_id,email,auth_email,auth_user_id,role,is_active')
        .eq('is_active', true)
        .in('role', MANAGEMENT_ROLES),
      admin
        .from('users')
        .select('user_id,emp_id,email,auth_email,auth_user_id,role,is_active')
        .eq('is_active', true)
        .eq('user_id', TEST_EMPLOYEE_ID)
        .eq('emp_id', TEST_EMPLOYEE_ID)
        .eq('role', 'instructor')
        .maybeSingle()
    ]);

    const candidates = [
      ...(Array.isArray(managementRows) ? managementRows : []),
      ...(testEmployeeRow ? [testEmployeeRow] : [])
    ];
    const userRow = candidates.find((row) => isAllowedRecoveryUser(row) && normalizeEmail(row?.email) === email);

    if (!userRow) return genericOk(origin);
    const authUserId = String(userRow.auth_user_id || '').trim();
    if (!authUserId) return genericOk(origin);

    const { data: authResult, error: authLookupError } = await admin.auth.admin.getUserById(authUserId);
    if (authLookupError || !authResult?.user) return genericOk(origin);

    const currentAuthEmail = normalizeEmail(authResult.user.email);
    if (currentAuthEmail !== email) {
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(authUserId, { email });
      if (authUpdateError) return genericOk(origin);
      await admin.from('users').update({ auth_email: email }).eq('user_id', userRow.user_id);
    }

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    await publicClient.auth.resetPasswordForEmail(email);
  } catch {
    // Deliberately return the same response for missing users, provider errors and success.
  }

  return genericOk(origin);
});
