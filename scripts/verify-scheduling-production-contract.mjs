const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '');

if (!url || !anonKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
}

async function accessToken() {
  const supplied = String(process.env.SCHEDULING_VERIFY_ACCESS_TOKEN || '');
  if (supplied) return supplied;
  const email = String(process.env.E2E_USERNAME || '');
  const password = String(process.env.E2E_PASSWORD || '');
  if (!email || !password) {
    throw new Error('Set SCHEDULING_VERIFY_ACCESS_TOKEN or E2E_USERNAME/E2E_PASSWORD');
  }
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.message || body.error_description || 'Supabase login failed');
  return body.access_token;
}

const token = await accessToken();
const response = await fetch(`${url}/rest/v1/rpc/scheduling_runtime_contract`, {
  method: 'POST',
  headers: {
    apikey: anonKey,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  },
  body: '{}'
});
const body = await response.json();
if (!response.ok) throw new Error(body.message || `Runtime contract RPC failed (${response.status})`);
if (!body?.ok) throw new Error(`Scheduling production contract failed: ${JSON.stringify(body)}`);
console.log(JSON.stringify(body, null, 2));

