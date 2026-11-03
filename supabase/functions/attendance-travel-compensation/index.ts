import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  cacheKey,
  createRouteMetrics,
  createRouteSingleflight,
  isSuspectBlocked,
  isUsableCachedRoute,
  noteCacheHit,
  noteCacheMiss,
  noteGoogleCall,
  routeFlightKey,
  text
} from '../_shared/travel-cache-contract.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const withRouteSingleflight = createRouteSingleflight();

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
  let payload;
  try { payload = await result.json(); } catch { throw new Error('route_data_invalid'); }
  const route = payload?.routes?.[0];
  if (!route) throw new Error('route_not_found');
  const distance = Number(route?.distanceMeters) / 1000;
  const seconds = Number.parseFloat(text(route?.duration).replace(/s$/i, ''));
  if (route.distanceMeters == null || !/^\d+(?:\.\d+)?s$/.test(text(route.duration))
    || !Number.isFinite(distance) || distance < 0 || !Number.isFinite(seconds)) throw new Error('route_data_invalid');
  return { distance_km: distance, duration_minutes: Math.ceil(seconds / 60) };
}

async function readCachedRoute(db: any, originKey: string, destinationKey: string) {
  const { data: cached, error } = await db.from('scheduling_travel_cache').select('*')
    .eq('origin_key', originKey).eq('destination_key', destinationKey).maybeSingle();
  if (error) throw new Error('cache_read_failed');
  return cached;
}

async function route(
  db: any,
  origin: string,
  destination: string,
  key: string,
  metrics: ReturnType<typeof createRouteMetrics>
) {
  const originKey = cacheKey(origin);
  const destinationKey = cacheKey(destination);
  const cached = await readCachedRoute(db, originKey, destinationKey);
  if (isSuspectBlocked(cached)) throw new Error('location_review_required'); // No automatic recalculation.
  if (isUsableCachedRoute(cached, origin, destination)) {
    noteCacheHit(metrics);
    return { distance_km: Number(cached.distance_km), duration_minutes: Number(cached.duration_minutes) };
  }
  noteCacheMiss(metrics);

  const calculated = await withRouteSingleflight(routeFlightKey(originKey, destinationKey), async () => {
    // Re-check after winning the lock so parallel callers share one Google call.
    const again = await readCachedRoute(db, originKey, destinationKey);
    if (isSuspectBlocked(again)) throw new Error('location_review_required');
    if (isUsableCachedRoute(again, origin, destination)) {
      noteCacheHit(metrics);
      return { distance_km: Number(again.distance_km), duration_minutes: Number(again.duration_minutes), fromCache: true };
    }
    if (originKey === destinationKey) {
      return { distance_km: 0, duration_minutes: 0, fromCache: false };
    }
    if (!key) throw new Error('google_key_not_configured');
    noteGoogleCall(metrics);
    const google = await googleRoute(origin, destination, key);
    return { ...google, fromCache: false };
  });

  if (!calculated.fromCache) {
    const { error: writeError } = await db.from('scheduling_travel_cache').upsert({
      origin_key: originKey, destination_key: destinationKey,
      distance_km: calculated.distance_km, duration_minutes: calculated.duration_minutes,
      provider: originKey === destinationKey ? 'same_school' : 'google',
      calculated_at: new Date().toISOString(), expires_at: '9999-12-31T23:59:59.999Z',
      origin_address: origin, destination_address: destination,
      query_origin_address: origin, query_destination_address: destination
    });
    if (writeError) throw new Error('cache_write_failed');
  }
  return { distance_km: calculated.distance_km, duration_minutes: calculated.duration_minutes };
}

async function readInstructorSchoolCachedPair(db: any, employeeId: number, schoolId: number, originAddress: string, destinationAddress: string) {
  if (!Number.isInteger(employeeId) || !Number.isInteger(schoolId)) return null;
  const { data: forwards, error } = await db.from('scheduling_travel_cache')
    .select('*').eq('origin_instructor_emp_id', employeeId)
    .eq('destination_school_id', schoolId).eq('location_suspect', false)
    .order('calculated_at', { ascending: false }).limit(5);
  if (error) throw new Error('cache_read_failed');
  for (const forward of forwards || []) {
    // The school ID alone is not sufficient: a verified school address can change.
    if (!isUsableCachedRoute(forward, originAddress, destinationAddress)) continue;
    const { data: reverse, error: reverseError } = await db.from('scheduling_travel_cache')
      .select('*').eq('origin_key', forward.destination_key)
      .eq('destination_key', forward.origin_key).maybeSingle();
    if (reverseError) throw new Error('cache_read_failed');
    if (isSuspectBlocked(reverse)) throw new Error('location_review_required');
    if (!isUsableCachedRoute(reverse, destinationAddress, originAddress)) continue;
    return { outbound: { distance_km: Number(forward.distance_km), duration_minutes: Number(forward.duration_minutes) },
      returning: { distance_km: Number(reverse.distance_km), duration_minutes: Number(reverse.duration_minutes) } };
  }
  return null;
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
  const metrics = createRouteMetrics('attendance_travel');
  const { data: context, error: contextError } = await db.rpc('av2_prepare_attendance_travel', {
    p_source_id: sourceId, p_actor_id: userId
  });
  if (contextError) return response({ error: text(contextError.message).includes('locked') ? 'attendance_month_locked' : 'attendance_context_invalid' }, 403);
  if (!context?.eligible) return response({ eligible: false, status: 'not_applicable', route_metrics: metrics });
  if (context.context_changed === false && context.calculation_status === 'resolved') {
    return response({
      eligible: true,
      status: 'resolved',
      review_status: context.review_status || null,
      approved_cancellation_minutes: context.approved_cancellation_minutes ?? null,
      show_travel_report_reminder: Number(context.system_distance_km || 0) > 40,
      route_metrics: metrics
    });
  }
  if (context.context_error) {
    await db.rpc('av2_reconcile_attendance_travel', {
      p_source_id: sourceId,
      p_fingerprint: context.fingerprint,
      p_outbound: null,
      p_return: null,
      p_failure_code: context.context_error,
      p_distance_km: null
    });
    return response({ eligible: true, status: 'unavailable', failure_code: context.context_error, route_metrics: metrics }, 422);
  }
  try {
    // Reuse both directed, verified Supabase routes by stable identities before any provider request.
    const { data: sourceRow, error: sourceError } = await db.from('attendance_records')
      .select('emp_id,school_id').eq('id', sourceId).single();
    if (sourceError) throw new Error('attendance_context_invalid');
    const cachedPair = await readInstructorSchoolCachedPair(
      db, Number(sourceRow?.emp_id), Number(sourceRow?.school_id),
      context.origin_address, context.destination_address
    );
    if (cachedPair) { noteCacheHit(metrics); noteCacheHit(metrics); }
    const [outbound, returning] = cachedPair
      ? [cachedPair.outbound, cachedPair.returning]
      : await Promise.all([
          route(db, context.origin_address, context.destination_address, googleKey, metrics),
          route(db, context.destination_address, context.origin_address, googleKey, metrics)
        ]);
    const oneWayKm = Math.max(
      Number(outbound.distance_km) || 0,
      Number(returning.distance_km) || 0
    );
    const { data, error } = await db.rpc('av2_reconcile_attendance_travel', {
      p_source_id: sourceId,
      p_fingerprint: context.fingerprint,
      p_outbound: outbound.duration_minutes,
      p_return: returning.duration_minutes,
      p_failure_code: null,
      p_distance_km: oneWayKm
    });
    if (error) {
      // Keep diagnostics bounded: database error text may contain private row data.
      console.error('[attendance-travel-compensation] reconcile failed', { code: error.code });
      throw new Error('reconcile_failed');
    }
    // Instructor-reachable response: never expose system travel minutes/distance.
    // Managers compare via payroll/control RPCs that read DB columns server-side.
    return response({
      eligible: true,
      status: 'resolved',
      review_status: data?.review_status || null,
      approved_cancellation_minutes: data?.approved_cancellation_minutes ?? null,
      show_travel_report_reminder: oneWayKm > 40,
      route_metrics: metrics
    });
  } catch (error) {
    const reason = ['reconcile_failed','location_review_required','route_not_found','route_data_invalid',
      'cache_read_failed','cache_write_failed'].includes(text((error as Error)?.message))
      ? text((error as Error).message) : 'route_service_unavailable';
    // Attendance travel remains unchanged. A failed route calculation additionally
    // records missing directed segments for MANUAL maintenance (deduplicated, no retry loop).
    // A queue failure must never prevent reconciliation/payroll error reporting.
    if (['route_service_unavailable', 'route_not_found', 'route_data_invalid'].includes(reason)
      && context.origin_address && context.destination_address) {
      await Promise.allSettled([
        db.rpc('scheduling_queue_missing_route', {
          p_origin: context.origin_address, p_destination: context.destination_address,
          p_source_kind: 'attendance', p_instructor_emp_id: context.emp_id || null,
          p_attendance_id: sourceId
        }),
        db.rpc('scheduling_queue_missing_route', {
          p_origin: context.destination_address, p_destination: context.origin_address,
          p_source_kind: 'attendance', p_instructor_emp_id: context.emp_id || null,
          p_attendance_id: sourceId
        })
      ]);
    }
    await db.rpc('av2_reconcile_attendance_travel', {
      p_source_id: sourceId,
      p_fingerprint: context.fingerprint,
      p_outbound: null,
      p_return: null,
      p_failure_code: reason,
      p_distance_km: null
    });
    return response({ eligible: true, status: 'unavailable', failure_code: reason, route_metrics: metrics },
      reason === 'reconcile_failed' || reason.startsWith('cache_') ? 500
        : reason === 'location_review_required' || reason === 'route_not_found' ? 422
        : reason === 'route_data_invalid' ? 502 : 503);
  }
});
