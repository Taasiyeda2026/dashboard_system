import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MANAGEMENT_ROLES = new Set([
  'admin',
  'operation_manager',
  'finance',
  'activities_manager',
  'domain_manager',
  'business_development_manager',
  'instructor_manager'
]);

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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: responseHeaders(origin) });
  }

  // This endpoint is intentionally unauthenticated because it is used from the login screen.
  // It never reveals whether an account exists and only sends a recovery email to the
  // verified management email already stored in the database. Supabase Auth applies its
  // own recovery-email rate limits as an additional abuse control.
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

    const { data: userRow } = await admin
      .from('users')
      .select('user_id,email,auth_email,auth_user_id,role,is_active')
      .ilike('email', email)
      .eq('is_active', true)
      .maybeSingle();

    if (!userRow || !MANAGEMENT_ROLES.has(String(userRow.role || '').trim())) return genericOk(origin);
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
