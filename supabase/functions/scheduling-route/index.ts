import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const CACHE_TTL_MS = 30 * 86400000;
const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 40;
const BATCH_CONCURRENCY = 4;

type DbClient = ReturnType<typeof createClient>;
type BuildScope = 'instructor_school' | 'school_school' | 'all';
type OriginType = 'instructor' | 'school';

type SchoolRow = {
  authority_id: number | null;
  authority_name: string;
  school_id: number | null;
  school_name: string;
  address: string;
};

type InstructorRow = {
  emp_id: number;
  address: string;
};

type TravelPair = {
  pair_kind: 'instructor_school' | 'school_school';
  origin_type: OriginType;
  destination_type: 'school';
  origin_instructor_emp_id: number | null;
  origin_school_id: number | null;
  destination_school_id: number | null;
  authority_id: number | null;
  origin_address: string;
  destination_address: string;
  query_origin_address: string;
  query_destination_address: string;
  origin_key: string;
  destination_key: string;
};

type FailureRow = {
  entity_type: string;
  entity_id: string;
  reason: string;
};

type BuildCursor = {
  phase: 'instructor_school' | 'school_school';
  offset: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const cacheKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

function text(value: unknown) {
  return String(value ?? '').trim();
}

function isActiveInstructor(value: unknown) {
  if (value === true) return true;
  const normalized = text(value).toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}

function buildGoogleAddressQuery(parts: {
  schoolName?: string;
  address?: string;
  authorityName?: string;
}) {
  // Partial addresses without a house number are still sent to Google — do not reject them.
  const chunks = [parts.schoolName, parts.address, parts.authorityName, 'ישראל']
    .map((part) => text(part))
    .filter(Boolean);
  const unique: string[] = [];
  for (const chunk of chunks) {
    if (!unique.some((existing) => cacheKey(existing) === cacheKey(chunk))) unique.push(chunk);
  }
  return unique.join(', ');
}

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
  if (!Number.isFinite(distanceKm) || !Number.isFinite(durationSeconds)) {
    return { ok: false as const, reason: 'route_not_found' };
  }
  return {
    ok: true as const,
    distance_km: distanceKm,
    duration_minutes: Math.ceil(durationSeconds / 60)
  };
}

function emptyStats() {
  return {
    total_count: 0,
    processed_count: 0,
    inserted_count: 0,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 0,
    failed_count: 0,
    remaining_count: 0,
    done: false,
    failures: [] as FailureRow[],
    next_cursor: null as string | null,
    scope: 'all' as BuildScope,
    phase: null as BuildCursor['phase'] | null
  };
}

function encodeCursor(cursor: BuildCursor) {
  return `${cursor.phase}:${cursor.offset}`;
}

function decodeCursor(raw: unknown, fallbackPhase: BuildCursor['phase']): BuildCursor {
  const value = text(raw);
  if (!value) return { phase: fallbackPhase, offset: 0 };
  const match = /^(instructor_school|school_school):(\d+)$/.exec(value);
  if (!match) return { phase: fallbackPhase, offset: 0 };
  return { phase: match[1] as BuildCursor['phase'], offset: Number(match[2]) || 0 };
}

function pairSortKey(pair: TravelPair) {
  return [
    pair.pair_kind,
    pair.authority_id ?? '',
    pair.origin_instructor_emp_id ?? '',
    pair.origin_school_id ?? '',
    pair.destination_school_id ?? '',
    pair.origin_key,
    pair.destination_key
  ].join('|');
}

function buildInstructorSchoolPairs(instructors: InstructorRow[], schools: SchoolRow[]): TravelPair[] {
  const pairs: TravelPair[] = [];
  for (const instructor of instructors) {
    const originAddress = text(instructor.address);
    if (!originAddress) continue;
    for (const school of schools) {
      const destinationAddress = text(school.address);
      if (!destinationAddress) continue;
      const queryOrigin = originAddress;
      const queryDestination = buildGoogleAddressQuery({
        schoolName: school.school_name,
        address: destinationAddress,
        authorityName: school.authority_name
      });
      pairs.push({
        pair_kind: 'instructor_school',
        origin_type: 'instructor',
        destination_type: 'school',
        origin_instructor_emp_id: instructor.emp_id,
        origin_school_id: null,
        destination_school_id: school.school_id,
        authority_id: school.authority_id,
        origin_address: originAddress,
        destination_address: destinationAddress,
        query_origin_address: queryOrigin,
        query_destination_address: queryDestination,
        origin_key: cacheKey(originAddress),
        destination_key: cacheKey(destinationAddress)
      });
    }
  }
  return pairs.sort((a, b) => pairSortKey(a).localeCompare(pairSortKey(b)));
}

function buildSchoolSchoolPairs(schools: SchoolRow[]): TravelPair[] {
  const groups = new Map<string, SchoolRow[]>();
  for (const school of schools) {
    const address = text(school.address);
    if (!address) continue;
    const groupKey = school.authority_id != null
      ? `id:${school.authority_id}`
      : `name:${cacheKey(school.authority_name || '')}`;
    if (!groupKey || groupKey === 'id:null' || groupKey === 'name:') continue;
    const list = groups.get(groupKey) || [];
    list.push(school);
    groups.set(groupKey, list);
  }

  const pairs: TravelPair[] = [];
  for (const [, list] of groups) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const origin = list[i];
        const destination = list[j];
        // Never pair a school with itself, even if two rows somehow share an id.
        if (
          origin.school_id != null
          && destination.school_id != null
          && origin.school_id === destination.school_id
        ) continue;
        const originAddress = text(origin.address);
        const destinationAddress = text(destination.address);
        if (!originAddress || !destinationAddress) continue;
        pairs.push({
          pair_kind: 'school_school',
          origin_type: 'school',
          destination_type: 'school',
          origin_instructor_emp_id: null,
          origin_school_id: origin.school_id,
          destination_school_id: destination.school_id,
          authority_id: origin.authority_id,
          origin_address: originAddress,
          destination_address: destinationAddress,
          query_origin_address: buildGoogleAddressQuery({
            schoolName: origin.school_name,
            address: originAddress,
            authorityName: origin.authority_name
          }),
          query_destination_address: buildGoogleAddressQuery({
            schoolName: destination.school_name,
            address: destinationAddress,
            authorityName: destination.authority_name
          }),
          origin_key: cacheKey(originAddress),
          destination_key: cacheKey(destinationAddress)
        });
      }
    }
  }
  return pairs.sort((a, b) => pairSortKey(a).localeCompare(pairSortKey(b)));
}

function failureForPair(pair: TravelPair, reason: string): FailureRow {
  if (pair.pair_kind === 'instructor_school') {
    return {
      entity_type: 'instructor_school',
      entity_id: `${pair.origin_instructor_emp_id ?? 'unknown'}->${pair.destination_school_id ?? 'unknown'}`,
      reason
    };
  }
  return {
    entity_type: 'school_school',
    entity_id: `${pair.origin_school_id ?? 'unknown'}->${pair.destination_school_id ?? 'unknown'}`,
    reason
  };
}

function cacheRowPayload(pair: TravelPair, distanceKm: number, durationMinutes: number, provider: string) {
  const now = Date.now();
  return {
    origin_key: pair.origin_key,
    destination_key: pair.destination_key,
    distance_km: distanceKm,
    duration_minutes: durationMinutes,
    provider,
    calculated_at: new Date(now).toISOString(),
    expires_at: new Date(now + CACHE_TTL_MS).toISOString(),
    authority_id: pair.authority_id,
    origin_school_id: pair.origin_school_id,
    destination_school_id: pair.destination_school_id,
    origin_address: pair.origin_address,
    destination_address: pair.destination_address,
    origin_type: pair.origin_type,
    destination_type: pair.destination_type,
    origin_instructor_emp_id: pair.origin_instructor_emp_id,
    query_origin_address: pair.query_origin_address,
    query_destination_address: pair.query_destination_address
  };
}

function addressesMatch(cached: Record<string, unknown> | null | undefined, pair: TravelPair) {
  if (!cached) return false;
  return text(cached.origin_address) === pair.origin_address
    && text(cached.destination_address) === pair.destination_address;
}

function isCacheValid(cached: Record<string, unknown> | null | undefined, pair: TravelPair) {
  if (!cached) return false;
  if (!addressesMatch(cached, pair)) return false;
  const expiresAt = new Date(String(cached.expires_at || '')).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const distanceOk = Number.isFinite(Number(cached.distance_km));
  const durationOk = Number.isFinite(Number(cached.duration_minutes));
  return distanceOk && durationOk;
}

async function findCachedByEntities(db: DbClient, pair: TravelPair) {
  if (pair.pair_kind === 'instructor_school' && pair.origin_instructor_emp_id != null) {
    const { data, error } = await db
      .from('scheduling_travel_cache')
      .select('*')
      .eq('origin_type', 'instructor')
      .eq('origin_instructor_emp_id', pair.origin_instructor_emp_id)
      .eq('destination_school_id', pair.destination_school_id)
      .limit(5);
    if (error) return { error, rows: [] as Record<string, unknown>[] };
    return { error: null, rows: (data || []) as Record<string, unknown>[] };
  }

  if (pair.pair_kind === 'school_school') {
    let query = db
      .from('scheduling_travel_cache')
      .select('*')
      .eq('origin_type', 'school')
      .eq('destination_type', 'school');
    if (pair.origin_school_id != null) query = query.eq('origin_school_id', pair.origin_school_id);
    if (pair.destination_school_id != null) query = query.eq('destination_school_id', pair.destination_school_id);
    if (pair.origin_school_id == null || pair.destination_school_id == null) {
      query = query.eq('origin_key', pair.origin_key).eq('destination_key', pair.destination_key);
    }
    const { data, error } = await query.limit(5);
    if (error) return { error, rows: [] as Record<string, unknown>[] };
    return { error: null, rows: (data || []) as Record<string, unknown>[] };
  }

  const { data, error } = await db
    .from('scheduling_travel_cache')
    .select('*')
    .eq('origin_key', pair.origin_key)
    .eq('destination_key', pair.destination_key)
    .limit(5);
  if (error) return { error, rows: [] as Record<string, unknown>[] };
  return { error: null, rows: (data || []) as Record<string, unknown>[] };
}

async function replaceCacheRow(db: DbClient, pair: TravelPair, row: Record<string, unknown>) {
  const existing = await findCachedByEntities(db, pair);
  if (existing.error) return { error: existing.error, inserted: false, renewed: false };

  const stale = existing.rows.filter((cached) => (
    text(cached.origin_key) !== pair.origin_key
    || text(cached.destination_key) !== pair.destination_key
  ));
  for (const old of stale) {
    const { error: deleteError } = await db
      .from('scheduling_travel_cache')
      .delete()
      .eq('origin_key', text(old.origin_key))
      .eq('destination_key', text(old.destination_key));
    if (deleteError) return { error: deleteError, inserted: false, renewed: false };
  }

  const hadMatchingKey = existing.rows.some((cached) => (
    text(cached.origin_key) === pair.origin_key
    && text(cached.destination_key) === pair.destination_key
  ));
  const hadAny = existing.rows.length > 0;

  const { error: upsertError } = await db.from('scheduling_travel_cache').upsert(row);
  if (upsertError) return { error: upsertError, inserted: false, renewed: false };

  if (!hadAny) return { error: null, inserted: true, renewed: false };
  if (hadMatchingKey || stale.length) return { error: null, inserted: false, renewed: true };
  return { error: null, inserted: false, renewed: true };
}

async function loadAuthoritySchools(db: DbClient) {
  const { data, error } = await db.rpc('scheduling_authority_school_locations');
  if (error) return { error, schools: [] as SchoolRow[] };
  const schools: SchoolRow[] = [];
  for (const row of data || []) {
    schools.push({
      authority_id: row.authority_id == null ? null : Number(row.authority_id),
      authority_name: text(row.authority_name),
      school_id: row.school_id == null ? null : Number(row.school_id),
      school_name: text(row.school_name),
      address: text(row.address)
    });
  }
  return { error: null, schools };
}

async function loadActiveInstructorsWithAddress(db: DbClient) {
  const { data, error } = await db
    .from('contacts_instructors')
    .select('emp_id, address, active');
  if (error) return { error, instructors: [] as InstructorRow[], skippedEmptyAddress: 0 };

  let skippedEmptyAddress = 0;
  const instructors: InstructorRow[] = [];
  for (const row of data || []) {
    if (!isActiveInstructor(row.active)) continue;
    const address = text(row.address);
    if (!address) {
      skippedEmptyAddress += 1;
      continue;
    }
    const empId = Number(row.emp_id);
    if (!Number.isFinite(empId)) continue;
    instructors.push({ emp_id: empId, address });
  }
  instructors.sort((a, b) => a.emp_id - b.emp_id);
  return { error: null, instructors, skippedEmptyAddress };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (cursor >= items.length && active === 0) {
        resolve();
        return;
      }
      while (active < concurrency && cursor < items.length) {
        const index = cursor;
        const item = items[cursor];
        cursor += 1;
        active += 1;
        Promise.resolve()
          .then(() => worker(item))
          .then((value) => { results[index] = value; })
          .catch((error) => { results[index] = error; })
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    };
    pump();
  });
  return results;
}

type PairOutcome = {
  dbError: { message?: string } | null;
  inserted?: boolean;
  renewed?: boolean;
  alreadyValid?: boolean;
  failed?: boolean;
  failure?: FailureRow | null;
};

async function processPair(db: DbClient, pair: TravelPair, key: string): Promise<PairOutcome> {
  // Same normalized address stays local zero — no Maps API call.
  if (pair.origin_key === pair.destination_key) {
    const write = await replaceCacheRow(db, pair, cacheRowPayload(pair, 0, 0, 'same_school'));
    if (write.error) return { dbError: write.error };
    return {
      dbError: null,
      inserted: !!write.inserted,
      renewed: !!write.renewed,
      alreadyValid: !write.inserted && !write.renewed
    };
  }

  const existing = await findCachedByEntities(db, pair);
  if (existing.error) return { dbError: existing.error };

  const matching = existing.rows.find((row) => (
    text(row.origin_key) === pair.origin_key && text(row.destination_key) === pair.destination_key
  )) || existing.rows[0] || null;

  if (isCacheValid(matching, pair)) {
    return { dbError: null, alreadyValid: true };
  }

  const route = await computeRoute(pair.query_origin_address, pair.query_destination_address, key);
  if (!route.ok) {
    // Never persist a failure as a valid cache row.
    return { dbError: null, failed: true, failure: failureForPair(pair, route.reason) };
  }
  if (!Number.isFinite(route.distance_km) || !Number.isFinite(route.duration_minutes)) {
    return { dbError: null, failed: true, failure: failureForPair(pair, 'route_not_found') };
  }

  const write = await replaceCacheRow(
    db,
    pair,
    cacheRowPayload(pair, route.distance_km, route.duration_minutes, 'google')
  );
  if (write.error) return { dbError: write.error };
  // Count inserted/renewed only after a successful upsert.
  return { dbError: null, inserted: !!write.inserted, renewed: !write.inserted };
}

async function runBuildCache(db: DbClient, key: string, payload: Record<string, unknown>) {
  const scopeRaw = text(payload.scope || 'all').toLowerCase();
  const scope: BuildScope = ['instructor_school', 'school_school', 'all'].includes(scopeRaw)
    ? scopeRaw as BuildScope
    : 'all';
  const limit = Math.min(
    MAX_BATCH_LIMIT,
    Math.max(1, Number(payload.limit) || DEFAULT_BATCH_LIMIT)
  );

  const schoolsResult = await loadAuthoritySchools(db);
  if (schoolsResult.error) {
    return jsonResponse({ error: 'authority_school_lookup_failed' }, 500);
  }

  let instructors: InstructorRow[] = [];
  let skippedEmptyInstructorAddress = 0;
  if (scope === 'instructor_school' || scope === 'all') {
    const instructorsResult = await loadActiveInstructorsWithAddress(db);
    if (instructorsResult.error) {
      return jsonResponse({ error: 'instructor_lookup_failed' }, 500);
    }
    instructors = instructorsResult.instructors;
    skippedEmptyInstructorAddress = instructorsResult.skippedEmptyAddress;
  }

  const schoolsWithAddress = schoolsResult.schools.filter((school) => text(school.address));
  const skippedEmptySchoolAddress = schoolsResult.schools.length - schoolsWithAddress.length;

  const instructorPairs = (scope === 'instructor_school' || scope === 'all')
    ? buildInstructorSchoolPairs(instructors, schoolsWithAddress)
    : [];
  const schoolPairs = (scope === 'school_school' || scope === 'all')
    ? buildSchoolSchoolPairs(schoolsWithAddress)
    : [];

  const stats = emptyStats();
  stats.scope = scope;
  stats.skipped_count = skippedEmptyInstructorAddress + skippedEmptySchoolAddress;
  stats.total_count = instructorPairs.length + schoolPairs.length;

  const initialPhase: BuildCursor['phase'] = scope === 'school_school'
    ? 'school_school'
    : 'instructor_school';
  let cursor = decodeCursor(payload.cursor, initialPhase);
  if (scope === 'school_school') cursor.phase = 'school_school';
  if (scope === 'instructor_school') cursor.phase = 'instructor_school';
  if (scope === 'all' && cursor.phase === 'school_school' && instructorPairs.length === 0) {
    cursor.phase = 'school_school';
  }

  const phasePairs = cursor.phase === 'instructor_school' ? instructorPairs : schoolPairs;
  const slice = phasePairs.slice(cursor.offset, cursor.offset + limit);
  stats.phase = cursor.phase;

  const outcomes = await mapWithConcurrency(slice, BATCH_CONCURRENCY, (pair) => processPair(db, pair, key));
  const dbError = outcomes.find((outcome) => outcome && typeof outcome === 'object' && 'dbError' in outcome && outcome.dbError)?.dbError || null;

  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== 'object' || !('dbError' in outcome)) {
      stats.failed_count += 1;
      stats.processed_count += 1;
      continue;
    }
    if (outcome.dbError) continue;
    stats.processed_count += 1;
    if (outcome.inserted) stats.inserted_count += 1;
    else if (outcome.renewed) stats.renewed_count += 1;
    else if (outcome.alreadyValid) stats.already_valid_count += 1;
    else if (outcome.failed) {
      stats.failed_count += 1;
      if (outcome.failure) stats.failures.push(outcome.failure);
    }
  }

  if (dbError) {
    return jsonResponse({
      error: 'cache_write_failed',
      message: 'שמירת מסלול במטמון נכשלה',
      ...stats,
      // Do not expose provider/address details in error payloads.
      failures: stats.failures.slice(0, 50)
    }, 500);
  }

  const nextOffset = cursor.offset + slice.length;
  const phaseDone = nextOffset >= phasePairs.length;
  let nextCursor: string | null = null;
  let done = false;

  if (!phaseDone) {
    nextCursor = encodeCursor({ phase: cursor.phase, offset: nextOffset });
  } else if (scope === 'all' && cursor.phase === 'instructor_school') {
    nextCursor = encodeCursor({ phase: 'school_school', offset: 0 });
    done = schoolPairs.length === 0;
    if (done) nextCursor = null;
  } else {
    done = true;
  }

  const remainingInPhase = Math.max(0, phasePairs.length - nextOffset);
  const remainingOther = scope === 'all' && cursor.phase === 'instructor_school'
    ? schoolPairs.length
    : 0;
  stats.remaining_count = done ? 0 : remainingInPhase + remainingOther;
  stats.done = done;
  stats.next_cursor = nextCursor;
  // Keep failure payload compact and free of instructor/school street addresses.
  stats.failures = stats.failures.slice(0, 50);

  return jsonResponse({
    calculated: true,
    build: true,
    ...stats
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

  // Privileged DB client stays on the server only — never returned to the browser.
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

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!key) return jsonResponse({ error: 'google_key_not_configured', reason: 'google_key_not_configured' }, 503);

  const mode = text(payload.mode).toLowerCase();
  const wantsBuild = mode === 'build_cache' || payload.build_cache === true || payload.batch === true;
  if (wantsBuild) {
    if (payload.batch === true && !payload.scope) payload.scope = 'all';
    return runBuildCache(db, key, payload);
  }

  const origin = text(payload.origin);
  const destination = text(payload.destination);
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
  if (cacheReadError) return jsonResponse({ calculated: false, reason: 'cache_read_failed', error: 'cache_read_failed' }, 500);
  if (cached) return jsonResponse({ calculated: true, cached: true, ...cached });

  const route = await computeRoute(origin, destination, key);
  if (!route.ok) {
    return jsonResponse(
      { calculated: false, reason: route.reason, error: route.reason },
      route.reason === 'route_not_found' ? 422 : 502
    );
  }

  const { error: cacheWriteError } = await db.from('scheduling_travel_cache').upsert({
    origin_key: originKey,
    destination_key: destinationKey,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
    provider: 'google',
    calculated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    origin_address: origin,
    destination_address: destination,
    query_origin_address: origin,
    query_destination_address: destination
  });
  if (cacheWriteError) {
    return jsonResponse({ calculated: false, reason: 'cache_write_failed', error: 'cache_write_failed' }, 500);
  }

  return jsonResponse({
    calculated: true,
    cached: false,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes
  });
});
