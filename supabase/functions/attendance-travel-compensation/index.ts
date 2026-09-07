import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const text = (value: unknown) => String(value ?? '').trim();
const cacheKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

export function cancellationMinutes(outbound: number, returning: number) {
  return Math.max(0, outbound - 45) + Math.max(0, returning - 45);
}

async function googleRoute(origin: string, destination: string, key: string) {
  const result = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
    body: JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: 'DRIVE' })
  });
  if (!result.ok) throw new Error('route_service_unavailable');
  const route = (await result.json())?.routes?.[0];
  const distance = Number(route?.distanceMeters) / 1000;
  const seconds = Number.parseFloat(text(route?.duration).replace(/s$/i, ''));
  if (!Number.isFinite(distance) || !Number.isFinite(seconds)) throw new Error('route_not_found');
  return { distance_km: distance, duration_minutes: Math.ceil(seconds / 60) };
}

async function route(db: any, origin: string, destination: string, key: string) {
  const originKey = cacheKey(origin);
  const destinationKey = cacheKey(destination);
  const { data: cached, error } = await db.from('scheduling_travel_cache').select('*')
    .eq('origin_key', originKey).eq('destination_key', destinationKey).maybeSingle();
  if (error) throw new Error('cache_read_failed');
  if (cached && Number.isFinite(Number(cached.duration_minutes))
    && (!text(cached.origin_address) || text(cached.origin_address) === origin)
    && (!text(cached.destination_address) || text(cached.destination_address) === destination)) {
    return { distance_km: Number(cached.distance_km), duration_minutes: Number(cached.duration_minutes) };
  }
  const calculated = originKey === destinationKey
    ? { distance_km: 0, duration_minutes: 0 }
    : await googleRoute(origin, destination, key);
  const { error: writeError } = await db.from('scheduling_travel_cache').upsert({
    origin_key: originKey, destination_key: destinationKey, ...calculated,
    provider: originKey === destinationKey ? 'same_school' : 'google',
    calculated_at: new Date().toISOString(), expires_at: '9999-12-31T23:59:59.999Z',
    origin_address: origin, destination_address: destination,
    query_origin_address: origin, query_destination_address: destination
  });
  if (writeError) throw new Error('cache_write_failed');
  return calculated;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
  if (!supabaseUrl || !serviceKey) return response({ error: 'server_configuration_missing' }, 500);
  const token = text(req.headers.get('Authorization')).replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'authentication_required' }, 401);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  const userId = auth?.user?.id;
  if (authError || !userId) return response({ error: 'invalid_authentication' }, 401);
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return response({ error: 'invalid_json' }, 400); }
  const sourceId = text(payload.source_attendance_record_id);
  if (!/^[0-9a-f-]{36}$/i.test(sourceId) || Object.keys(payload).some((key) => ['origin','destination','outbound','return_minutes','emp_id'].includes(key))) {
    return response({ error: 'invalid_source_request' }, 400);
  }
  const { data: context, error: contextError } = await db.rpc('av2_prepare_attendance_travel', {
    p_source_id: sourceId, p_actor_id: userId
  });
  if (contextError) return response({ error: text(contextError.message).includes('locked') ? 'attendance_month_locked' : 'attendance_context_invalid' }, 403);
  if (!context?.eligible) return response({ eligible: false, status: 'not_applicable' });
  if (context.context_changed === false && context.calculation_status === 'resolved') {
    return response({ eligible: true, status: 'resolved', outbound_travel_minutes: context.outbound_travel_minutes,
      return_travel_minutes: context.return_travel_minutes,
      calculated_cancellation_minutes: context.calculated_cancellation_minutes,
      final_cancellation_minutes: context.final_cancellation_minutes,
      manually_overridden: context.manually_overridden === true });
  }
  if (context.context_error) {
    await db.rpc('av2_reconcile_attendance_travel', { p_source_id: sourceId, p_fingerprint: context.fingerprint,
      p_outbound: null, p_return: null, p_failure_code: context.context_error });
    return response({ eligible: true, status: 'unavailable', failure_code: context.context_error }, 422);
  }
  if (!googleKey) {
    await db.rpc('av2_reconcile_attendance_travel', { p_source_id: sourceId, p_fingerprint: context.fingerprint,
      p_outbound: null, p_return: null, p_failure_code: 'google_key_not_configured' });
    return response({ eligible: true, status: 'unavailable', failure_code: 'google_key_not_configured' }, 503);
  }
  try {
    const [outbound, returning] = await Promise.all([
      route(db, context.origin_address, context.destination_address, googleKey),
      route(db, context.destination_address, context.origin_address, googleKey)
    ]);
    const { data, error } = await db.rpc('av2_reconcile_attendance_travel', {
      p_source_id: sourceId, p_fingerprint: context.fingerprint,
      p_outbound: outbound.duration_minutes, p_return: returning.duration_minutes, p_failure_code: null
    });
    if (error) throw new Error('reconcile_failed');
    return response({ eligible: true, status: 'resolved', outbound_travel_minutes: outbound.duration_minutes,
      return_travel_minutes: returning.duration_minutes,
      calculated_cancellation_minutes: cancellationMinutes(outbound.duration_minutes, returning.duration_minutes),
      final_cancellation_minutes: data?.final_cancellation_minutes,
      manually_overridden: data?.manually_overridden === true });
  } catch (error) {
    const reason = ['route_not_found','cache_read_failed','cache_write_failed'].includes(text((error as Error)?.message))
      ? text((error as Error).message) : 'route_service_unavailable';
    await db.rpc('av2_reconcile_attendance_travel', { p_source_id: sourceId, p_fingerprint: context.fingerprint,
      p_outbound: null, p_return: null, p_failure_code: reason });
    return response({ eligible: true, status: 'unavailable', failure_code: reason }, 503);
  }
});
