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
  entity_key: string;
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
  origin_entity_key: string;
  destination_entity_key: string;
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

function schoolEntityKey(school: { school_id?: number | null; authority_name?: string; school_name?: string; address?: string }) {
  if (school.school_id != null && Number.isFinite(Number(school.school_id))) {
    return `school_id:${Number(school.school_id)}`;
  }
  return [
    'school_ref',
    cacheKey(school.authority_name || ''),
    cacheKey(school.school_name || ''),
    cacheKey(school.address || '')
  ].join('|');
}

function instructorEntityKey(empId: number) {
  return `instructor:${empId}`;
}

function preferSchoolRow(current: SchoolRow, candidate: SchoolRow) {
  const currentAuthority = current.authority_id != null ? 1 : 0;
  const candidateAuthority = candidate.authority_id != null ? 1 : 0;
  if (candidateAuthority !== currentAuthority) return candidateAuthority > currentAuthority ? candidate : current;
  if (text(candidate.address).length !== text(current.address).length) {
    return text(candidate.address).length > text(current.address).length ? candidate : current;
  }
  return current;
}

function dedupeAuthoritySchools(schools: SchoolRow[]) {
  const byKey = new Map<string, SchoolRow>();
  let duplicateCount = 0;
  for (const school of schools) {
    if (!text(school.address)) continue;
    const key = school.entity_key || schoolEntityKey(school);
    if (byKey.has(key)) {
      duplicateCount += 1;
      byKey.set(key, preferSchoolRow(byKey.get(key)!, school));
      continue;
    }
    byKey.set(key, school);
  }
  return { schools: [...byKey.values()], duplicateCount };
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
    required_count: 0,
    existing_count: 0,
    missing_count: 0,
    refresh_required_count: 0,
    total_count: 0,
    processed_count: 0,
    inserted_count: 0,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 0,
    skipped_instructors_missing_address_count: 0,
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

function dedupeTravelPairs(pairs: TravelPair[]) {
  const byRoute = new Map<string, TravelPair>();
  for (const pair of pairs) {
    const key = `${pair.origin_key}->${pair.destination_key}`;
    if (!byRoute.has(key)) byRoute.set(key, pair);
  }
  return [...byRoute.values()].sort((a, b) => pairSortKey(a).localeCompare(pairSortKey(b)));
}

function buildInstructorSchoolPairs(instructors: InstructorRow[], schools: SchoolRow[]): TravelPair[] {
  const { schools: uniqueSchools } = dedupeAuthoritySchools(schools);
  const pairs: TravelPair[] = [];
  for (const instructor of instructors) {
    const originAddress = text(instructor.address);
    if (!originAddress) continue;
    const originEntityKey = instructorEntityKey(instructor.emp_id);
    for (const school of uniqueSchools) {
      const destinationAddress = text(school.address);
      if (!destinationAddress) continue;
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
        query_origin_address: originAddress,
        query_destination_address: buildGoogleAddressQuery({
          schoolName: school.school_name,
          address: destinationAddress,
          authorityName: school.authority_name
        }),
        origin_key: cacheKey(originAddress),
        destination_key: cacheKey(destinationAddress),
        origin_entity_key: originEntityKey,
        destination_entity_key: school.entity_key || schoolEntityKey(school)
      });
    }
  }
  return pairs.sort((a, b) => pairSortKey(a).localeCompare(pairSortKey(b)));
}

function buildSchoolSchoolPairs(schools: SchoolRow[]): TravelPair[] {
  const { schools: uniqueSchools } = dedupeAuthoritySchools(schools);
  const groups = new Map<string, SchoolRow[]>();
  for (const school of uniqueSchools) {
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
        const originEntity = origin.entity_key || schoolEntityKey(origin);
        const destinationEntity = destination.entity_key || schoolEntityKey(destination);
        // Never pair a school with itself by id or by stable entity key.
        if (originEntity === destinationEntity) continue;
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
          destination_key: cacheKey(destinationAddress),
          origin_entity_key: originEntity,
          destination_entity_key: destinationEntity
        });
      }
    }
  }
  return pairs.sort((a, b) => pairSortKey(a).localeCompare(pairSortKey(b)));
}

function failureForPair(pair: TravelPair, reason: string): FailureRow {
  return {
    entity_type: pair.pair_kind,
    entity_id: `${pair.origin_entity_key}->${pair.destination_entity_key}`,
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
    query_destination_address: pair.query_destination_address,
    origin_entity_key: pair.origin_entity_key,
    destination_entity_key: pair.destination_entity_key
  };
}

function addressesMatch(cached: Record<string, unknown> | null | undefined, pair: TravelPair) {
  if (!cached) return false;
  return text(cached.origin_address) === pair.origin_address
    && text(cached.destination_address) === pair.destination_address;
}

function isFiniteMetric(value: unknown) {
  // Reject null/'' explicitly — Number(null) is 0 and must not count as a valid metric.
  if (value == null || value === '') return false;
  return Number.isFinite(Number(value));
}

function hasUsableMetrics(cached: Record<string, unknown> | null | undefined, pair?: TravelPair) {
  if (!cached) return false;
  if (!isFiniteMetric(cached.distance_km) || !isFiniteMetric(cached.duration_minutes)) return false;
  const distance = Number(cached.distance_km);
  const duration = Number(cached.duration_minutes);
  if (distance < 0 || duration < 0) return false;
  const sameLocation = pair
    ? pair.origin_key === pair.destination_key
    : text(cached.origin_key) === text(cached.destination_key);
  if ((distance === 0 || duration === 0) && !sameLocation) return false;
  return true;
}

function needsRefresh(cached: Record<string, unknown> | null | undefined, now = Date.now()) {
  const expiresAt = new Date(String(cached?.expires_at || '')).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function isUsableForPair(cached: Record<string, unknown> | null | undefined, pair: TravelPair) {
  return !!cached && addressesMatch(cached, pair) && hasUsableMetrics(cached, pair);
}

function isCacheValid(cached: Record<string, unknown> | null | undefined, pair: TravelPair) {
  return isUsableForPair(cached, pair) && !needsRefresh(cached);
}

// Single-pair lookup: only treat a row as a hit when it is unexpired, numeric, and
// (when address fields are present) matches the requested origin/destination.
function isLookupCacheValid(
  cached: Record<string, unknown> | null | undefined,
  origin: string,
  destination: string,
  now = Date.now()
) {
  if (!cached) return false;
  const cachedOrigin = text(cached.origin_address);
  const cachedDestination = text(cached.destination_address);
  if (cachedOrigin && cachedOrigin !== origin) return false;
  if (cachedDestination && cachedDestination !== destination) return false;
  return hasUsableMetrics(cached) && !needsRefresh(cached, now);
}

async function findCachedByEntities(db: DbClient, pair: TravelPair) {
  // Stable identity uses entity keys so schools without school_id still match on rerun.
  // Never call .eq('*_school_id', null) — Supabase requires .is(..., null) for NULL, and
  // entity keys already cover that case.
  if (pair.origin_entity_key && pair.destination_entity_key) {
    const { data, error } = await db
      .from('scheduling_travel_cache')
      .select('*')
      .eq('origin_entity_key', pair.origin_entity_key)
      .eq('destination_entity_key', pair.destination_entity_key)
      .limit(5);
    if (error) return { error, rows: [] as Record<string, unknown>[] };
    if ((data || []).length) return { error: null, rows: (data || []) as Record<string, unknown>[] };
  }

  if (
    pair.pair_kind === 'instructor_school'
    && pair.origin_instructor_emp_id != null
    && pair.destination_school_id != null
  ) {
    const { data, error } = await db
      .from('scheduling_travel_cache')
      .select('*')
      .eq('origin_type', 'instructor')
      .eq('origin_instructor_emp_id', pair.origin_instructor_emp_id)
      .eq('destination_school_id', pair.destination_school_id)
      .limit(5);
    if (error) return { error, rows: [] as Record<string, unknown>[] };
    if ((data || []).length) return { error: null, rows: (data || []) as Record<string, unknown>[] };
  }

  if (
    pair.pair_kind === 'school_school'
    && pair.origin_school_id != null
    && pair.destination_school_id != null
  ) {
    const { data, error } = await db
      .from('scheduling_travel_cache')
      .select('*')
      .eq('origin_type', 'school')
      .eq('destination_type', 'school')
      .eq('origin_school_id', pair.origin_school_id)
      .eq('destination_school_id', pair.destination_school_id)
      .limit(5);
    if (error) return { error, rows: [] as Record<string, unknown>[] };
    if ((data || []).length) return { error: null, rows: (data || []) as Record<string, unknown>[] };
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
  const hadMatchingKey = existing.rows.some((cached) => (
    text(cached.origin_key) === pair.origin_key
    && text(cached.destination_key) === pair.destination_key
  ));
  const hadAny = existing.rows.length > 0;

  const { error: upsertError } = await db.from('scheduling_travel_cache').upsert(row);
  if (upsertError) return { error: upsertError, inserted: false, renewed: false };

  // Address changes are fail-safe: the new route is persisted before an obsolete key is
  // retired. A failed Google call or failed upsert therefore cannot erase the last value.
  for (const old of stale) {
    await db
      .from('scheduling_travel_cache')
      .delete()
      .eq('origin_key', text(old.origin_key))
      .eq('destination_key', text(old.destination_key));
  }

  if (!hadAny) return { error: null, inserted: true, renewed: false };
  if (hadMatchingKey || stale.length) return { error: null, inserted: false, renewed: true };
  return { error: null, inserted: false, renewed: true };
}

async function loadAuthoritySchools(db: DbClient) {
  const { data, error } = await db.rpc('scheduling_authority_school_locations');
  if (error) return { error, schools: [] as SchoolRow[] };
  const schools: SchoolRow[] = [];
  for (const row of data || []) {
    const school_id = row.school_id == null ? null : Number(row.school_id);
    const address = text(row.address);
    const authority_name = text(row.authority_name);
    const school_name = text(row.school_name);
    schools.push({
      authority_id: row.authority_id == null ? null : Number(row.authority_id),
      authority_name,
      school_id: Number.isFinite(school_id as number) ? school_id : null,
      school_name,
      address,
      entity_key: schoolEntityKey({ school_id, authority_name, school_name, address })
    });
  }
  return { error: null, schools };
}

async function loadActiveInstructorsWithAddress(db: DbClient) {
  // Narrow SECURITY DEFINER RPC — never SELECT contacts_instructors directly.
  // RPC returns all active instructors; address may be null/empty.
  const { data, error } = await db.rpc('scheduling_active_instructor_locations');
  if (error) {
    return {
      error,
      instructors: [] as InstructorRow[],
      skippedEmptyAddress: 0,
      skippedFailures: [] as FailureRow[]
    };
  }

  const instructors: InstructorRow[] = [];
  const skippedFailures: FailureRow[] = [];
  for (const row of data || []) {
    const empId = Number(row.emp_id);
    if (!Number.isFinite(empId)) continue;
    const address = text(row.address);
    if (!address) {
      skippedFailures.push({
        entity_type: 'instructor',
        entity_id: instructorEntityKey(empId),
        reason: 'missing_address'
      });
      continue;
    }
    instructors.push({ emp_id: empId, address });
  }
  instructors.sort((a, b) => a.emp_id - b.emp_id);
  return {
    error: null,
    instructors,
    skippedEmptyAddress: skippedFailures.length,
    skippedFailures
  };
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

async function inspectPair(db: DbClient, pair: TravelPair) {
  const existing = await findCachedByEntities(db, pair);
  if (existing.error) return { error: existing.error, pair, cached: null, state: 'missing' as const };
  const cached = existing.rows.find((row) => (
    text(row.origin_key) === pair.origin_key && text(row.destination_key) === pair.destination_key
  )) || null;
  if (!isUsableForPair(cached, pair)) return { error: null, pair, cached, state: 'missing' as const };
  return {
    error: null,
    pair,
    cached,
    state: needsRefresh(cached) ? 'refresh_required' as const : 'existing' as const
  };
}

async function processPair(db: DbClient, pair: TravelPair, key: string): Promise<PairOutcome> {
  const existing = await findCachedByEntities(db, pair);
  if (existing.error) return { dbError: existing.error };

  const matching = existing.rows.find((row) => (
    text(row.origin_entity_key) === pair.origin_entity_key
    && text(row.destination_entity_key) === pair.destination_entity_key
  )) || existing.rows.find((row) => (
    text(row.origin_key) === pair.origin_key && text(row.destination_key) === pair.destination_key
  )) || existing.rows[0] || null;
  const wasUsableCurrentRoute = isUsableForPair(matching, pair);

  if (isCacheValid(matching, pair)) {
    return { dbError: null, alreadyValid: true };
  }

  // Same normalized address stays local zero — no Maps API call. Still skip upsert
  // when a valid same-address row already exists (checked above).
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
  return {
    dbError: null,
    inserted: !wasUsableCurrentRoute,
    renewed: wasUsableCurrentRoute
  };
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
  let skippedInstructorFailures: FailureRow[] = [];
  if (scope === 'instructor_school' || scope === 'all') {
    const instructorsResult = await loadActiveInstructorsWithAddress(db);
    if (instructorsResult.error) {
      return jsonResponse({ error: 'instructor_lookup_failed' }, 500);
    }
    instructors = instructorsResult.instructors;
    skippedEmptyInstructorAddress = instructorsResult.skippedEmptyAddress;
    skippedInstructorFailures = instructorsResult.skippedFailures || [];
  }

  const schoolsWithAddress = schoolsResult.schools.filter((school) => text(school.address));
  const skippedEmptySchoolAddress = schoolsResult.schools.length - schoolsWithAddress.length;
  const deduped = dedupeAuthoritySchools(schoolsWithAddress);

  const instructorPairs = (scope === 'instructor_school' || scope === 'all')
    ? dedupeTravelPairs(buildInstructorSchoolPairs(instructors, deduped.schools))
    : [];
  let schoolPairs = (scope === 'school_school' || scope === 'all')
    ? dedupeTravelPairs(buildSchoolSchoolPairs(deduped.schools))
    : [];
  if (scope === 'all' && instructorPairs.length) {
    const instructorRouteKeys = new Set(instructorPairs.map((pair) => `${pair.origin_key}->${pair.destination_key}`));
    schoolPairs = schoolPairs.filter((pair) => !instructorRouteKeys.has(`${pair.origin_key}->${pair.destination_key}`));
  }

  const stats = emptyStats();
  stats.scope = scope;
  stats.skipped_instructors_missing_address_count = skippedEmptyInstructorAddress;
  stats.skipped_count = skippedEmptyInstructorAddress + skippedEmptySchoolAddress + deduped.duplicateCount;
  stats.failures.push(...skippedInstructorFailures.slice(0, 50));
  stats.total_count = instructorPairs.length + schoolPairs.length;
  stats.required_count = stats.total_count;

  const allPairs = [...instructorPairs, ...schoolPairs];
  const inspections = await mapWithConcurrency(allPairs, BATCH_CONCURRENCY, (pair) => inspectPair(db, pair));
  const inspectionError = inspections.find((item) => item?.error)?.error || null;
  if (inspectionError) return jsonResponse({ error: 'cache_read_failed' }, 500);
  stats.existing_count = inspections.filter((item) => item.state !== 'missing').length;
  stats.missing_count = stats.required_count - stats.existing_count;
  stats.refresh_required_count = inspections.filter((item) => item.state === 'refresh_required').length;

  if (payload.coverage_only === true || text(payload.mode).toLowerCase() === 'coverage') {
    return jsonResponse({ calculated: true, coverage: true, ...stats, done: true });
  }

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

  const successfulInserts = stats.inserted_count;
  const successfulRefreshes = stats.renewed_count;
  stats.existing_count = Math.min(stats.required_count, stats.existing_count + successfulInserts);
  stats.missing_count = Math.max(0, stats.missing_count - successfulInserts);
  stats.refresh_required_count = Math.max(0, stats.refresh_required_count - successfulRefreshes);

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

  const mode = text(payload.mode).toLowerCase();
  const wantsBuild = mode === 'build_cache' || payload.build_cache === true || payload.batch === true;
  const key = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
  if (mode === 'coverage') {
    payload.coverage_only = true;
    return runBuildCache(db, key, payload);
  }
  if (!key) return jsonResponse({ error: 'google_key_not_configured', reason: 'google_key_not_configured' }, 503);
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

  const hadPrevious = !!cached;
  if (cached && hasUsableMetrics(cached) && (!text(cached.origin_address) || text(cached.origin_address) === origin)
    && (!text(cached.destination_address) || text(cached.destination_address) === destination)) {
    return jsonResponse({
      calculated: true,
      cached: true,
      renewed: false,
      needs_refresh: needsRefresh(cached),
      distance_km: Number(cached.distance_km),
      duration_minutes: Number(cached.duration_minutes)
    });
  }

  // Same normalized address: zero local route, never call Google Maps.
  if (originKey === destinationKey) {
    const { error: cacheWriteError } = await db.from('scheduling_travel_cache').upsert({
      origin_key: originKey,
      destination_key: destinationKey,
      distance_km: 0,
      duration_minutes: 0,
      provider: 'same_school',
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
      renewed: hadPrevious,
      distance_km: 0,
      duration_minutes: 0
    });
  }

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
    renewed: hadPrevious,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes
  });
});
