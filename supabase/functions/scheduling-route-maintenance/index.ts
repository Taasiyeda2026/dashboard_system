import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseGoogleRouteMetrics } from './route-metrics.js';

// Dedicated maintenance worker. JWT checks on scheduling-route remain unchanged.
// Entry is protected by a vault-backed secret and an existing privileged run row.
const clean = (v) => String(v ?? '').trim();
const key = (v) => clean(v).toLowerCase().replace(/\s+/g, ' ');
const validId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const cacheId = (a, b) => key(a) + '=>' + key(b);
const json = (obj, code = 200) => new Response(JSON.stringify(obj), {
  status: code, headers: { 'Content-Type': 'application/json' }
});
const validKm = (r) => r && r.distance_km != null && r.duration_minutes != null
  && Number.isFinite(Number(r.distance_km)) && Number.isFinite(Number(r.duration_minutes))
  && Number(r.distance_km) >= 0 && Number(r.duration_minutes) >= 0;

function schoolQuery(row) {
  return [clean(row.school_name), clean(row.institution_address), clean(row.authority), 'ישראל']
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}
function homeEndpoint(row) {
  return { type: 'instructor', id: Number(row.emp_id), address: clean(row.address),
    query: clean(row.address) + ', ישראל', entity: 'instructor:' + Number(row.emp_id),
    schoolId: null, empId: Number(row.emp_id) };
}
function schoolEndpoint(row) {
  return { type: 'school', id: Number(row.id), address: clean(row.institution_address),
    query: schoolQuery(row), entity: 'school_id:' + Number(row.id),
    schoolId: Number(row.id), empId: null, authorityId: row.authority_id };
}
function travelPair(from, to, label) {
  return { from, to, label, cacheKey: cacheId(from.address, to.address) };
}
function isDifferentSchools(pair) {
  return pair.from.type === 'school' && pair.to.type === 'school'
    && pair.from.id !== pair.to.id;
}
function ambiguousSameAddress(pair) {
  return key(pair.from.address) === key(pair.to.address)
    && (pair.from.entity !== pair.to.entity);
}
function alreadyUsable(row, pair) {
  if (!validKm(row)) return false;
  if (clean(row.origin_address) && clean(row.origin_address) !== pair.from.address) return false;
  if (clean(row.destination_address) && clean(row.destination_address) !== pair.to.address) return false;
  // Zero routes from locality-only addresses never prove two distinct entities co-located.
  if ((Number(row.distance_km) === 0 || Number(row.duration_minutes) === 0)
       && pair.from.entity !== pair.to.entity) return false;
  return true;
}
async function loadCache(db, pairs) {
  const originKeys = [...new Set(pairs.map((p) => key(p.from.address)))];
  const destinationKeys = [...new Set(pairs.map((p) => key(p.to.address)))];
  const cached = new Map();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('scheduling_travel_cache')
      .select('origin_key,destination_key,origin_address,destination_address,distance_km,duration_minutes,provider')
      .in('origin_key', originKeys).in('destination_key', destinationKeys)
      .order('origin_key').order('destination_key').range(offset, offset + 999);
    if (error) throw new Error('cache_read_failed');
    for (const row of data || []) cached.set(clean(row.origin_key) + '=>' + clean(row.destination_key), row);
    if ((data || []).length < 1000) break;
  }
  return cached;
}
async function googleRoute(pair, apiKey) {
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation'
    },
    body: JSON.stringify({
      origin: { address: pair.from.query }, destination: { address: pair.to.query },
      travelMode: 'DRIVE'
    })
  });
  if (!response.ok) return { error: 'route_service_unavailable' };
  const metrics = parseGoogleRouteMetrics((await response.json())?.routes?.[0]);
  if (!metrics || !Number.isFinite(metrics.distance_km) || !Number.isFinite(metrics.duration_minutes)) {
    return { error: 'route_not_found' };
  }
  if ((metrics.distance_km === 0 || metrics.duration_minutes === 0)
      && pair.from.entity !== pair.to.entity) {
    return { error: 'unverified_zero_route' };
  }
  return { metrics };
}
async function mapConcurrent(items, workers, handler) {
  const results = Array(items.length);
  let at = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (at < items.length) {
      const index = at++;
      try { results[index] = await handler(items[index]); }
      catch { results[index] = { status: 'failed', reason: 'unexpected_error', label: items[index].label }; }
    }
  }));
  return results;
}
async function repairRoutes(db, apiKey, requests, includeReverse) {
  const instructorIds = [...new Set(requests.filter((r) => r.kind === 'home').map((r) => validId(r.instructor_id)).filter(Boolean))];
  const schoolIds = [...new Set(requests.flatMap((r) =>
    r.kind === 'home' ? [validId(r.school_id)] : [validId(r.origin_school_id), validId(r.destination_school_id)]
  ).filter(Boolean))];
  const [sr, ir] = await Promise.all([
    db.from('schools').select('id,school_name,institution_address,authority,authority_id').in('id', schoolIds),
    instructorIds.length
      ? db.from('contacts_instructors').select('emp_id,address').in('emp_id', instructorIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (sr.error || ir.error) throw new Error('source_lookup_failed');
  const schools = new Map((sr.data || []).map((row) => [Number(row.id), row]));
  const instructors = new Map((ir.data || []).map((row) => [Number(row.emp_id), row]));
  const pairs = [];
  const invalid = [];
  for (const request of requests) {
    let from, to;
    if (request.kind === 'home') {
      const instructor = instructors.get(validId(request.instructor_id));
      const school = schools.get(validId(request.school_id));
      if (instructor && school) {
        from = homeEndpoint(instructor); to = schoolEndpoint(school);
      }
    } else if (request.kind === 'school') {
      const first = schools.get(validId(request.origin_school_id));
      const second = schools.get(validId(request.destination_school_id));
      if (first && second && first.id !== second.id) {
        from = schoolEndpoint(first); to = schoolEndpoint(second);
      }
    }
    const label = request.kind === 'home'
      ? 'home:' + request.instructor_id + '->' + request.school_id
      : 'school:' + request.origin_school_id + '->' + request.destination_school_id;
    if (!from || !to || !from.address || !to.address) {
      invalid.push({ label, status: 'blocked', reason: 'missing_or_unresolved_location' });
      continue;
    }
    pairs.push(travelPair(from, to, label));
    if (includeReverse) pairs.push(travelPair(to, from, label + ':return'));
  }
  if (!pairs.length) return { entries: invalid, checked: invalid.length, cached: 0, created: 0, failed: 0, blocked: invalid.length };
  const cache = await loadCache(db, pairs);
  const unique = new Map();
  for (const pair of pairs) {
    const existing = unique.get(pair.cacheKey);
    if (!existing || (!isDifferentSchools(existing) && isDifferentSchools(pair))) unique.set(pair.cacheKey, pair);
  }
  const outcomes = await mapConcurrent([...unique.values()], 5, async (pair) => {
    if (ambiguousSameAddress(pair)) {
      return { label: pair.label, status: 'blocked', reason: 'ambiguous_same_address' };
    }
    const existing = cache.get(pair.cacheKey);
    if (alreadyUsable(existing, pair)) return { label: pair.label, status: 'cached' };
    if (!apiKey) return { label: pair.label, status: 'failed', reason: 'google_key_not_configured' };
    const computed = await googleRoute(pair, apiKey);
    if (computed.error) return { label: pair.label, status: 'failed', reason: computed.error };
    const row = {
      origin_key: key(pair.from.address), destination_key: key(pair.to.address),
      origin_address: pair.from.address, destination_address: pair.to.address,
      origin_type: pair.from.type, destination_type: pair.to.type === 'instructor' ? 'location' : pair.to.type,
      origin_school_id: pair.from.schoolId, destination_school_id: pair.to.schoolId,
      origin_instructor_emp_id: pair.from.empId,
      origin_entity_key: pair.from.entity, destination_entity_key: pair.to.entity,
      authority_id: pair.to.authorityId ?? pair.from.authorityId ?? null,
      query_origin_address: pair.from.query, query_destination_address: pair.to.query,
      distance_km: computed.metrics.distance_km,
      duration_minutes: computed.metrics.duration_minutes,
      provider: computed.metrics.provider || 'google',
      calculated_at: new Date().toISOString(), expires_at: '9999-12-31T23:59:59.999Z'
    };
    const { error } = await db.from('scheduling_travel_cache').upsert(row);
    if (error) return { label: pair.label, status: 'failed', reason: 'cache_write_failed' };
    return { label: pair.label, status: 'created', distance_km: row.distance_km, duration_minutes: row.duration_minutes };
  });
  const byKey = new Map([...unique.values()].map((pair, i) => [pair.cacheKey, outcomes[i]]));
  const entries = [...invalid, ...pairs.map((pair) => ({
    label: pair.label, status: byKey.get(pair.cacheKey)?.status || 'failed',
    reason: byKey.get(pair.cacheKey)?.reason || null,
    distance_km: byKey.get(pair.cacheKey)?.distance_km ?? null,
    duration_minutes: byKey.get(pair.cacheKey)?.duration_minutes ?? null
  }))];
  return {
    entries, checked: entries.length,
    cached: entries.filter((r) => r.status === 'cached').length,
    created: entries.filter((r) => r.status === 'created').length,
    failed: entries.filter((r) => r.status === 'failed').length,
    blocked: entries.filter((r) => r.status === 'blocked').length
  };
}

async function resolveMappedSchoolPlaces(apiKey, requests) {
  if (!apiKey) return { checked: requests.length, failed: requests.length, entries: requests.map((r)=>({school_id:r.school_id, status:'failed',reason:'google_key_not_configured'})), cached:0,created:0,blocked:0 };
  const entries = await mapConcurrent(requests, 4, async (request) => {
    const cid = clean(request.cid);
    const variants = (request.queries || []).map(clean).filter(Boolean).slice(0,4);
    const candidates = new Map();
    for (const query of variants) {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,
          'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri'},
        body:JSON.stringify({textQuery:query,languageCode:'he',regionCode:'IL',maxResultCount:10})
      });
      if (!response.ok) return {school_id:request.school_id, status:'failed',reason:'places_api_http_'+response.status};
      const payload = await response.json();
      for(const p of payload.places || []) {
        if(!p.id || !p.location) continue;
        candidates.set(p.id, {
          name:p.displayName?.text || '', address:p.formattedAddress || '', lat:p.location.latitude, lng:p.location.longitude,
          id:p.id, google_maps_uri:p.googleMapsUri || '',
          cid:(p.googleMapsUri || '').match(/[?&]cid=(\d+)/)?.[1] || null
        });
      }
      if([...candidates.values()].some((c)=>c.cid === cid)) break;
    }
    const matched = [...candidates.values()].find((c)=>c.cid === cid);
    return {school_id:request.school_id, requested_cid:cid, status:matched?'matched':'not_verified',
      matched:matched || null, candidates:[...candidates.values()].slice(0,12) };
  });
  return { entries, checked: entries.length, cached:0,created:0,
    failed:entries.filter((x)=>x.status==='failed').length,
    blocked:entries.filter((x)=>x.status==='not_verified').length };
}


function validIsraelCoordinate(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat > 29 && lat < 34 && lng > 34 && lng < 36;
}
async function estimateCoordinateSegments(apiKey, segments) {
  if (!apiKey) return { checked:segments.length, estimated:0, created:0, cached:0,
    failed:segments.length, blocked:0, entries:segments.map((s)=>({
      label:s.label,status:'failed',reason:'google_key_not_configured'
    })) };
  const entries = await mapConcurrent(segments, 4, async (s) => {
    const label = clean(s.label).slice(0,120);
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method:'POST', headers:{
        'Content-Type':'application/json','X-Goog-Api-Key':apiKey,
        'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation'
      }, body: JSON.stringify({
        origin: { location: { latLng: { latitude:s.from_lat, longitude:s.from_lng } } },
        destination: { location: { latLng: { latitude:s.to_lat, longitude:s.to_lng } } },
        travelMode:'DRIVE'
      })
    });
    if (!response.ok) return { label,status:'failed',reason:'route_http_'+response.status };
    const metrics = parseGoogleRouteMetrics((await response.json())?.routes?.[0]);
    if (!metrics || !Number.isFinite(metrics.distance_km) || !Number.isFinite(metrics.duration_minutes)) {
      return {label,status:'failed',reason:'route_not_found'};
    }
    if (metrics.distance_km === 0 || metrics.duration_minutes === 0) {
      return {label,status:'blocked',reason:'unverified_zero_route'};
    }
    return {label,status:'estimated',origin_id:clean(s.origin_id),destination_id:clean(s.destination_id),
      from_lat:s.from_lat,from_lng:s.from_lng,to_lat:s.to_lat,to_lng:s.to_lng,
      distance_km:metrics.distance_km,duration_minutes:metrics.duration_minutes,
      accuracy:'provisional',source:'user_supplied_or_google_maps_plus_code',
      not_authorized_for_payroll:true};
  });
  return {entries,checked:entries.length,cached:0,created:0,
    estimated:entries.filter((e)=>e.status==='estimated').length,
    failed:entries.filter((e)=>e.status==='failed').length,
    blocked:entries.filter((e)=>e.status==='blocked').length};
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'server_config_missing' }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const secret = clean(req.headers.get('x-route-maintenance-key'));
  if (!secret || secret.length < 60) return json({ error: 'forbidden' }, 403);
  const { data: authorized, error: authError } = await db.rpc('scheduling_route_maintenance_authorized', { p_secret: secret });
  if (authError || authorized !== true) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid_payload' }, 400); }
  const runId = clean(body?.run_id);
  const resolveMode = body?.mode === 'resolve_places';
  const estimateMode = body?.mode === 'estimate_coordinates';
  const requests = estimateMode ? (Array.isArray(body?.segments) ? body.segments : [])
    : resolveMode ? (Array.isArray(body?.places) ? body.places : []) : (Array.isArray(body?.pairs) ? body.pairs : []);
  if (!/^[0-9a-f-]{36}$/i.test(runId) || !requests.length || requests.length > 100
      || (estimateMode ? requests.some((s)=>!clean(s?.label) || !validIsraelCoordinate(s?.from_lat,s?.from_lng)
          || !validIsraelCoordinate(s?.to_lat,s?.to_lng))
        : resolveMode ? requests.some((r) => !validId(r?.school_id) || !/^\d{15,22}$/.test(clean(r?.cid)) || !Array.isArray(r?.queries))
        : requests.some((r) => !['home','school'].includes(r?.kind)))) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { data: claimed, error: claimError } = await db.from('scheduling_route_maintenance_runs')
    .update({ status: 'running', started_at: new Date().toISOString(), request_count: requests.length })
    .eq('id', runId).eq('status', 'queued').select('id');
  if (claimError || !claimed?.length) return json({ error: 'run_not_queued' }, 409);
  try {
    const result = estimateMode
      ? await estimateCoordinateSegments(Deno.env.get('GOOGLE_MAPS_API_KEY') || '', requests)
      : resolveMode ? await resolveMappedSchoolPlaces(Deno.env.get('GOOGLE_MAPS_API_KEY') || '', requests)
      : await repairRoutes(db, Deno.env.get('GOOGLE_MAPS_API_KEY') || '', requests, body?.include_reverse === true);
    const newStatus = result.failed || result.blocked ? 'completed_with_issues' : 'completed';
    const { error: saveError } = await db.from('scheduling_route_maintenance_runs')
      .update({ status: newStatus, finished_at: new Date().toISOString(),
        cached_count: result.cached, created_count: result.created,
        failed_count: result.failed, blocked_count: result.blocked, result })
      .eq('id', runId);
    if (saveError) return json({ error: 'run_status_update_failed' }, 500);
    return json({ run_id: runId, status: newStatus, checked: result.checked,
      cached: result.cached, created: result.created, failed: result.failed, blocked: result.blocked });
  } catch {
    await db.from('scheduling_route_maintenance_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), result: { error: 'maintenance_failed' } })
      .eq('id', runId);
    return json({ error: 'maintenance_failed' }, 500);
  }
});
