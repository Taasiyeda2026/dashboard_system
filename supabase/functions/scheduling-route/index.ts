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

const cacheKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

async function computeRoute(origin: string, destination: string, key: string) {
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
  if (!google.ok) return { ok: false as const, reason: 'route_service_unavailable' };
  const route = (await google.json())?.routes?.[0];
  const distanceKm = Number(route?.distanceMeters) / 1000;
  const durationSeconds = Number.parseFloat(String(route?.duration || '').replace(/s$/i, ''));
  if (!Number.isFinite(distanceKm) || !Number.isFinite(durationSeconds)) return { ok: false as const, reason: 'route_not_found' };
  return { ok: true as const, distance_km: distanceKm, duration_minutes: Math.ceil(durationSeconds / 60) };
}

// Batch same-authority school-to-school distance update (the "עדכון מרחקים בין בתי ספר"
// button). Deliberately separate from the per-candidate lookup above: it only ever pairs
// schools that belong to the same authority, and it skips any pair whose cache entry is
// still valid and address-matched. Instructor-home-to-school distances are unrelated and
// keep using the single-pair path.
const MAX_PAIRS_PER_RUN = 400;
const BATCH_CONCURRENCY = 4;

async function runBatchAuthorityUpdate(db: ReturnType<typeof createClient>, key: string) {
  const { data: schools, error: schoolsError } = await db.rpc('scheduling_authority_school_locations');
  if (schoolsError) return jsonResponse({ calculated: false, reason: 'authority_school_lookup_failed' }, 500);

  const groups = new Map<string, { school_id: number | null; school_name: string; address: string }[]>();
  let missingAddressCount = 0;
  for (const row of (schools || [])) {
    const address = String(row.address || '').trim();
    if (!address) { missingAddressCount += 1; continue; }
    const groupKey = row.authority_id != null ? `id:${row.authority_id}` : `name:${cacheKey(String(row.authority_name || ''))}`;
    if (!groupKey || groupKey === 'id:null' || groupKey === 'name:') continue;
    const list = groups.get(groupKey) || [];
    list.push({ school_id: row.school_id ?? null, school_name: row.school_name, address });
    groups.set(groupKey, list);
  }

  type Pair = { authorityId: number | null; originSchoolId: number | null; destinationSchoolId: number | null; origin: string; destination: string };
  const pairs: Pair[] = [];
  for (const [, list] of groups) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        pairs.push({
          authorityId: null,
          originSchoolId: list[i].school_id,
          destinationSchoolId: list[j].school_id,
          origin: list[i].address,
          destination: list[j].address
        });
      }
    }
  }
  // Recover authority_id per pair from the source rows (schools sharing a group share an authority_id or name).
  const authorityBySchoolId = new Map<number, number | null>();
  for (const row of (schools || [])) {
    if (row.school_id != null) authorityBySchoolId.set(row.school_id, row.authority_id ?? null);
  }
  for (const pair of pairs) {
    pair.authorityId = pair.originSchoolId != null ? (authorityBySchoolId.get(pair.originSchoolId) ?? null) : null;
  }

  let newCount = 0;
  let renewedCount = 0;
  let alreadyValidCount = 0;
  let failedCount = 0;
  const toCompute: Pair[] = [];

  for (const pair of pairs) {
    if (cacheKey(pair.origin) === cacheKey(pair.destination)) {
      await db.from('scheduling_travel_cache').upsert({
        origin_key: cacheKey(pair.origin), destination_key: cacheKey(pair.destination),
        distance_km: 0, duration_minutes: 0, provider: 'same_school',
        calculated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        authority_id: pair.authorityId, origin_school_id: pair.originSchoolId, destination_school_id: pair.destinationSchoolId,
        origin_address: pair.origin, destination_address: pair.destination
      });
      alreadyValidCount += 1;
      continue;
    }
    const { data: cached } = await db.from('scheduling_travel_cache').select('*')
      .eq('origin_key', cacheKey(pair.origin)).eq('destination_key', cacheKey(pair.destination)).maybeSingle();
    const isValid = cached
      && new Date(cached.expires_at).getTime() > Date.now()
      && String(cached.origin_address || '') === pair.origin
      && String(cached.destination_address || '') === pair.destination;
    if (isValid) { alreadyValidCount += 1; continue; }
    if (toCompute.length < MAX_PAIRS_PER_RUN) toCompute.push(pair);
    if (!cached) newCount += 1; else renewedCount += 1;
  }

  let active = 0;
  let cursor = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (cursor >= toCompute.length && active === 0) { resolve(); return; }
      while (active < BATCH_CONCURRENCY && cursor < toCompute.length) {
        const pair = toCompute[cursor]; cursor += 1; active += 1;
        computeRoute(pair.origin, pair.destination, key).then(async (route) => {
          if (route.ok) {
            await db.from('scheduling_travel_cache').upsert({
              origin_key: cacheKey(pair.origin), destination_key: cacheKey(pair.destination),
              distance_km: route.distance_km, duration_minutes: route.duration_minutes, provider: 'google',
              calculated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
              authority_id: pair.authorityId, origin_school_id: pair.originSchoolId, destination_school_id: pair.destinationSchoolId,
              origin_address: pair.origin, destination_address: pair.destination
            });
          } else {
            failedCount += 1;
          }
        }).catch(() => { failedCount += 1; }).finally(() => { active -= 1; pump(); });
      }
    };
    pump();
  });

  return jsonResponse({
    calculated: true,
    batch: true,
    new_count: newCount,
    renewed_count: renewedCount,
    already_valid_count: alreadyValidCount,
    missing_address_count: missingAddressCount,
    failed_count: failedCount,
    capped: pairs.length > MAX_PAIRS_PER_RUN
  });
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

  let payload: { origin?: unknown; destination?: unknown; batch?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!key) return jsonResponse({ calculated: false, reason: 'google_key_not_configured' });

  if (payload.batch === true) return runBatchAuthorityUpdate(db, key);

  const origin = String(payload.origin || '').trim();
  const destination = String(payload.destination || '').trim();
  if (!origin || !destination || origin.length > 500 || destination.length > 500) {
    return jsonResponse({ error: 'missing_or_invalid_locations' }, 400);
  }

  const originKey = cacheKey(origin);
  const destinationKey = cacheKey(destination);
  const { data: cached, error: cacheReadError } = await db
    .from('scheduling_travel_cache')
    .select('*')
    .eq('origin_key', originKey)
    .eq('destination_key', destinationKey)
    .maybeSingle();
  if (cacheReadError) return jsonResponse({ calculated: false, reason: 'cache_read_failed' }, 500);
  if (cached) return jsonResponse({ calculated: true, cached: true, ...cached });

  const route = await computeRoute(origin, destination, key);
  if (!route.ok) return jsonResponse({ calculated: false, reason: route.reason }, route.reason === 'route_not_found' ? 422 : 502);

  const { error: cacheWriteError } = await db.from('scheduling_travel_cache').upsert({
    origin_key: originKey,
    destination_key: destinationKey,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
    provider: 'google',
    calculated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
  });
  if (cacheWriteError) return jsonResponse({ calculated: false, reason: 'cache_write_failed' }, 500);

  return jsonResponse({
    calculated: true,
    cached: false,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes
  });
});
