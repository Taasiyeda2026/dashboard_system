import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'server_configuration_missing' }, 500);

  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse({ error: 'authentication_required' }, 401);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return jsonResponse({ error: 'invalid_authentication' }, 401);

  const { data: appUser, error: appUserError } = await db
    .from('users')
    .select('role,is_active')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (appUserError) return jsonResponse({ error: 'authorization_check_failed' }, 500);
  if (!['admin', 'operation_manager'].includes(String(appUser?.role || ''))) {
    return jsonResponse({ error: 'scheduling_permission_denied' }, 403);
  }

  let payload: { origin?: unknown; destination?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const origin = String(payload.origin || '').trim();
  const destination = String(payload.destination || '').trim();
  if (!origin || !destination || origin.length > 500 || destination.length > 500) {
    return jsonResponse({ error: 'missing_or_invalid_locations' }, 400);
  }

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!key) return jsonResponse({ calculated: false, reason: 'google_key_not_configured' });

  const cacheKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
  const originKey = cacheKey(origin);
  const destinationKey = cacheKey(destination);
  const { data: cached, error: cacheReadError } = await db
    .from('scheduling_travel_cache')
    .select('*')
    .eq('origin_key', originKey)
    .eq('destination_key', destinationKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (cacheReadError) return jsonResponse({ calculated: false, reason: 'cache_read_failed' }, 500);
  if (cached) return jsonResponse({ calculated: true, cached: true, ...cached });

  const google = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: 'DRIVE'
    })
  });
  if (!google.ok) return jsonResponse({ calculated: false, reason: 'route_service_unavailable' }, 502);

  const route = (await google.json())?.routes?.[0];
  const distanceKm = Number(route?.distanceMeters) / 1000;
  const durationSeconds = Number.parseFloat(String(route?.duration || '').replace(/s$/i, ''));
  if (!Number.isFinite(distanceKm) || !Number.isFinite(durationSeconds)) {
    return jsonResponse({ calculated: false, reason: 'route_not_found' }, 422);
  }
  const durationMinutes = Math.ceil(durationSeconds / 60);

  const { error: cacheWriteError } = await db.from('scheduling_travel_cache').upsert({
    origin_key: originKey,
    destination_key: destinationKey,
    distance_km: distanceKm,
    duration_minutes: durationMinutes,
    provider: 'google',
    calculated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
  });
  if (cacheWriteError) return jsonResponse({ calculated: false, reason: 'cache_write_failed' }, 500);

  return jsonResponse({
    calculated: true,
    cached: false,
    distance_km: distanceKm,
    duration_minutes: durationMinutes
  });
});
