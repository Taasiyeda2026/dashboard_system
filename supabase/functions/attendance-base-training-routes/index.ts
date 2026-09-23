import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-av2-trigger-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const GREENWORK_ADDRESS = '6RVR+XM, יקום';
const GREENWORK_QUERY = 'Greenwork, 6RVR+XM, יקום, ישראל';
const CACHE_EXPIRES_AT = '9999-12-31T23:59:59.999Z';
const CONCURRENCY = 4;

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const text = (value: unknown) => String(value ?? '').trim();
const cacheKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

function constantTimeMatch(expected: string, provided: string) {
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(provided);
  let diff = a.length === b.length && a.length > 0 ? 0 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function cancellationMinutes(outbound: number, returning: number) {
  return Math.max(0, outbound - 45) + Math.max(0, returning - 45);
}

async function googleRoute(origin: string, destination: string, key: string) {
  const result = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
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
  if (!result.ok) throw new Error('route_service_unavailable');
  const route = (await result.json())?.routes?.[0];
  const distance = Number(route?.distanceMeters) / 1000;
  const seconds = Number.parseFloat(text(route?.duration).replace(/s$/i, ''));
  if (!Number.isFinite(distance) || !Number.isFinite(seconds)) throw new Error('route_not_found');
  return { distance_km: distance, duration_minutes: Math.ceil(seconds / 60) };
}

async function cachedRoute(db: any, origin: string, destination: string, key: string, queryOrigin?: string, queryDestination?: string) {
  const originKey = cacheKey(origin);
  const destinationKey = cacheKey(destination);
  const { data: cached, error } = await db.from('scheduling_travel_cache').select('*')
    .eq('origin_key', originKey)
    .eq('destination_key', destinationKey)
    .maybeSingle();
  if (error) throw new Error('cache_read_failed');

  const cachedDistance = Number(cached?.distance_km);
  const cachedDuration = Number(cached?.duration_minutes);
  if (
    cached
    && Number.isFinite(cachedDistance)
    && Number.isFinite(cachedDuration)
    && cachedDistance >= 0
    && cachedDuration >= 0
    && (!text(cached.origin_address) || text(cached.origin_address) === origin)
    && (!text(cached.destination_address) || text(cached.destination_address) === destination)
  ) {
    return { distance_km: cachedDistance, duration_minutes: cachedDuration, cached: true };
  }

  const calculated = originKey === destinationKey
    ? { distance_km: 0, duration_minutes: 0 }
    : await googleRoute(queryOrigin || origin, queryDestination || destination, key);

  const { error: writeError } = await db.from('scheduling_travel_cache').upsert({
    origin_key: originKey,
    destination_key: destinationKey,
    distance_km: calculated.distance_km,
    duration_minutes: calculated.duration_minutes,
    provider: originKey === destinationKey ? 'same_school' : 'google',
    calculated_at: new Date().toISOString(),
    expires_at: CACHE_EXPIRES_AT,
    origin_address: origin,
    destination_address: destination,
    query_origin_address: queryOrigin || origin,
    query_destination_address: queryDestination || destination
  });
  if (writeError) throw new Error('cache_write_failed');
  return { ...calculated, cached: false };
}

async function instructorRoute(db: any, address: string, key: string) {
  const addressQuery = address + ', ישראל';
  const [outbound, returning] = await Promise.all([
    cachedRoute(db, address, GREENWORK_ADDRESS, key, addressQuery, GREENWORK_QUERY),
    cachedRoute(db, GREENWORK_ADDRESS, address, key, GREENWORK_QUERY, addressQuery)
  ]);
  return {
    outbound_travel_minutes: outbound.duration_minutes,
    return_travel_minutes: returning.duration_minutes,
    outbound_distance_km: outbound.distance_km,
    return_distance_km: returning.distance_km,
    cancellation_minutes: cancellationMinutes(outbound.duration_minutes, returning.duration_minutes),
    cached: outbound.cached && returning.cached
  };
}


async function reconcilePendingBaseTraining(db: any, empId: number, route: any) {
  const { data, error } = await db.rpc('av2_reconcile_pending_base_training_routes', {
    p_emp_id: empId,
    p_outbound: route.outbound_travel_minutes,
    p_return: route.return_travel_minutes
  });
  if (error) throw new Error('pending_reconcile_failed');
  return {
    resolved: Number(data?.resolved || 0),
    failed: Number(data?.failed || 0)
  };
}

async function mapWithConcurrency(items: any[], limit: number, worker: (item: any) => Promise<any>) {
  const results: any[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
  if (!supabaseUrl || !serviceKey) return response({ error: 'server_configuration_missing' }, 500);
  if (!googleKey) return response({ error: 'google_key_not_configured' }, 503);

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return response({ error: 'invalid_json' }, 400); }
  const mode = text(payload.mode || 'preview').toLowerCase();

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const expectedSecret = Deno.env.get('AV2_TRIGGER_SECRET') || '';
  const providedSecret = req.headers.get('x-av2-trigger-secret') || '';
  const trustedTrigger = constantTimeMatch(expectedSecret, providedSecret);

  let appUser: any = null;
  if (!trustedTrigger) {
    const token = text(req.headers.get('Authorization')).replace(/^Bearer\s+/i, '');
    if (!token) return response({ error: 'authentication_required' }, 401);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth?.user?.id) return response({ error: 'invalid_authentication' }, 401);
    const { data, error } = await db.from('users')
      .select('role,is_active,permissions,emp_id')
      .eq('auth_user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data) return response({ error: 'authorization_check_failed' }, 403);
    appUser = data;
  }

  if (mode === 'build_all') {
    const permissions = appUser?.permissions && typeof appUser.permissions === 'object' ? appUser.permissions : {};
    const canBuild = trustedTrigger
      || appUser?.role === 'admin'
      || ['yes','true','1'].includes(text(permissions.view_attendance_control).toLowerCase());
    if (!canBuild) return response({ error: 'permission_denied' }, 403);

    const { data: instructors, error } = await db.from('contacts_instructors')
      .select('emp_id,address,active');
    if (error) return response({ error: 'instructor_lookup_failed' }, 500);

    const active = (instructors || []).filter((row: any) => {
      const status = text(row.active).toLowerCase();
      return !['false','0','no','לא','inactive','לא פעיל'].includes(status) && text(row.address);
    });

    let failed = 0;
    let cached = 0;
    let reconciledPending = 0;
    let reconcileFailed = 0;
    const results = await mapWithConcurrency(active, CONCURRENCY, async (row: any) => {
      try {
        const route = await instructorRoute(db, text(row.address), googleKey);
        if (route.cached) cached += 1;
        const reconciliation = await reconcilePendingBaseTraining(db, Number(row.emp_id), route);
        reconciledPending += reconciliation.resolved;
        reconcileFailed += reconciliation.failed;
        return { ok: true };
      } catch {
        failed += 1;
        return { ok: false };
      }
    });

    return response({
      ok: true,
      active_with_address: active.length,
      completed: results.filter((item) => item?.ok).length,
      cached,
      failed,
      reconciled_pending: reconciledPending,
      reconcile_failed: reconcileFailed
    });
  }

  if (mode !== 'preview' || !appUser) return response({ error: 'invalid_mode' }, 400);
  const empId = Number(appUser.emp_id);
  if (!Number.isFinite(empId)) return response({ error: 'instructor_identity_missing' }, 422);

  const { data: instructor, error } = await db.from('contacts_instructors')
    .select('emp_id,address,active')
    .eq('emp_id', empId)
    .maybeSingle();
  if (error) return response({ error: 'instructor_lookup_failed' }, 500);
  const address = text(instructor?.address);
  if (!instructor || !address) {
    return response({ ok: false, status: 'unavailable', reason: 'instructor_address_missing' }, 422);
  }

  try {
    const route = await instructorRoute(db, address, googleKey);
    const reconciliation = await reconcilePendingBaseTraining(db, empId, route);
    return response({
      ok: true,
      status: 'resolved',
      destination_label: 'Greenwork, יקום',
      reconciled_pending: reconciliation.resolved,
      reconcile_failed: reconciliation.failed,
      ...route
    });
  } catch (error) {
    return response({ ok: false, status: 'unavailable', reason: text((error as Error)?.message) || 'route_service_unavailable' }, 502);
  }
});
