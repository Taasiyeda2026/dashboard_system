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
const MIN_PASSWORD_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 5;
const CHALLENGE_MINUTES = 10;
const MAX_REQUESTS_PER_TEN_MINUTES = 3;

const PROD_ORIGIN = 'https://taasiyeda2026.github.io';
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']);

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

function json(origin: string, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
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

function fakeChallengeId() {
  return crypto.randomUUID();
}

function createVerificationCode() {
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= 4_294_000_000);
  return String(values[0] % 1_000_000).padStart(6, '0');
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function graphAccessToken() {
  const tenant = String(Deno.env.get('MS_TENANT_ID') || '').trim();
  const clientId = String(Deno.env.get('MS_CLIENT_ID') || '').trim();
  const clientSecret = String(Deno.env.get('MS_CLIENT_SECRET') || '').trim();
  if (!tenant || !clientId || !clientSecret) throw new Error('microsoft_graph_not_configured');

  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw new Error(`microsoft_graph_token_${response.status}`);
  return String(payload.access_token);
}

async function sendVerificationCode(email: string, code: string) {
  const accessToken = await graphAccessToken();
  const sender = normalizeEmail(Deno.env.get('PASSWORD_RESET_SENDER_EMAIL') || 'office@think.org.il');
  const body = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#172033;line-height:1.6">
      <h2 style="margin:0 0 12px">איפוס קוד כניסה – תעשיידע</h2>
      <p>התקבלה בקשה לאיפוס קוד הכניסה למערכת.</p>
      <p>קוד האימות שלך:</p>
      <div dir="ltr" style="font-size:30px;font-weight:700;letter-spacing:8px;padding:14px 18px;background:#f1f5f9;border-radius:10px;text-align:center">${code}</div>
      <p>הקוד תקף למשך ${CHALLENGE_MINUTES} דקות. יש להזין אותו במסך האיפוס הפתוח במערכת ולבחור קוד כניסה חדש.</p>
      <p style="color:#64748b;font-size:13px">אם לא ביקשת לאפס את קוד הכניסה, אפשר להתעלם מהודעה זו.</p>
    </div>`;

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        subject: 'קוד אימות לאיפוס הכניסה – תעשיידע',
        body: { contentType: 'HTML', content: body },
        toRecipients: [{ emailAddress: { address: email } }]
      },
      saveToSentItems: false
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('password_recovery_graph_send_failed', response.status, text.slice(0, 300));
    throw new Error(`microsoft_graph_send_${response.status}`);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== 'POST') return json(origin, { ok: false }, 405);
  if (origin && origin !== PROD_ORIGIN && !DEV_ORIGINS.has(origin)) return json(origin, { ok: true, challenge_id: fakeChallengeId() });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json(origin, { ok: true, challenge_id: fakeChallengeId() });
  }

  const action = String(payload?.action || 'request').trim().toLowerCase();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) return json(origin, { ok: action === 'request', challenge_id: fakeChallengeId() });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (action === 'complete') {
    const challengeId = String(payload?.challenge_id || '').trim();
    const code = String(payload?.code || '').trim();
    const newPassword = String(payload?.new_password || '');
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code) || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 128) {
      return json(origin, { ok: false, error: 'invalid_or_expired' });
    }

    const { data: challenge } = await admin
      .from('password_recovery_challenges')
      .select('id,user_id,auth_user_id,email,code_hash,expires_at,attempts,consumed_at')
      .eq('id', challengeId)
      .maybeSingle();

    const now = new Date();
    if (!challenge || challenge.consumed_at || Number(challenge.attempts || 0) >= MAX_CODE_ATTEMPTS || new Date(challenge.expires_at).getTime() <= now.getTime()) {
      return json(origin, { ok: false, error: 'invalid_or_expired' });
    }

    const codeHash = await sha256(code);
    if (codeHash !== String(challenge.code_hash || '')) {
      await admin
        .from('password_recovery_challenges')
        .update({ attempts: Math.min(10, Number(challenge.attempts || 0) + 1) })
        .eq('id', challengeId)
        .is('consumed_at', null);
      return json(origin, { ok: false, error: 'invalid_or_expired' });
    }

    const { error: passwordError } = await admin.auth.admin.updateUserById(String(challenge.auth_user_id), { password: newPassword });
    if (passwordError) {
      console.error('password_recovery_password_update_failed', passwordError.message);
      return json(origin, { ok: false, error: 'update_failed' });
    }

    await admin
      .from('password_recovery_challenges')
      .update({ consumed_at: now.toISOString() })
      .eq('id', challengeId)
      .is('consumed_at', null);

    return json(origin, { ok: true });
  }

  const email = normalizeEmail(payload?.email);
  const fakeId = fakeChallengeId();
  if (!email || !email.endsWith('@think.org.il')) return json(origin, { ok: true, challenge_id: fakeId });

  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count: recentCount } = await admin
      .from('password_recovery_challenges')
      .select('id', { head: true, count: 'exact' })
      .eq('email', email)
      .gte('created_at', tenMinutesAgo);
    if (Number(recentCount || 0) >= MAX_REQUESTS_PER_TEN_MINUTES) return json(origin, { ok: true, challenge_id: fakeId });

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
    if (!userRow) return json(origin, { ok: true, challenge_id: fakeId });

    const authUserId = String(userRow.auth_user_id || '').trim();
    if (!authUserId) return json(origin, { ok: true, challenge_id: fakeId });

    const { data: authResult, error: authLookupError } = await admin.auth.admin.getUserById(authUserId);
    if (authLookupError || !authResult?.user) return json(origin, { ok: true, challenge_id: fakeId });

    const currentAuthEmail = normalizeEmail(authResult.user.email);
    if (currentAuthEmail !== email) {
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(authUserId, { email });
      if (authUpdateError) return json(origin, { ok: true, challenge_id: fakeId });
      await admin.from('users').update({ auth_email: email }).eq('user_id', userRow.user_id);
    }

    const code = createVerificationCode();
    const codeHash = await sha256(code);
    const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString();
    const { data: challenge, error: insertError } = await admin
      .from('password_recovery_challenges')
      .insert({
        user_id: String(userRow.user_id),
        auth_user_id: authUserId,
        email,
        code_hash: codeHash,
        expires_at: expiresAt
      })
      .select('id')
      .single();
    if (insertError || !challenge?.id) return json(origin, { ok: true, challenge_id: fakeId });

    try {
      await sendVerificationCode(email, code);
    } catch (error) {
      console.error('password_recovery_email_failed', error instanceof Error ? error.message : String(error));
      await admin.from('password_recovery_challenges').delete().eq('id', challenge.id);
      return json(origin, { ok: true, challenge_id: fakeId });
    }

    admin.from('password_recovery_challenges').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString()).then(() => {}).catch(() => {});
    return json(origin, { ok: true, challenge_id: challenge.id });
  } catch (error) {
    console.error('password_recovery_request_failed', error instanceof Error ? error.message : String(error));
    return json(origin, { ok: true, challenge_id: fakeId });
  }
});
