/**
 * Shared Database-First contract for scheduling/attendance travel routes.
 * Safe for Node tests and Deno edge functions. No Google I/O here.
 */

export function text(value) {
  return String(value ?? '').trim();
}

export function cacheKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Same canonicalization as scheduling_locations_same_place in PostgreSQL.
export function sameTravelLocation(origin, destination) {
  const normalize = value => {
    const key = cacheKey(value).replace(/[-־‐‑‒–—]+/g, ' ').replace(/\s+/g, ' ').trim();
    return key === 'דלית אל כרמל' ? 'דאלית אל כרמל' : key;
  };
  const a = normalize(origin), b = normalize(destination);
  return !!a && !!b && a === b;
}

export function routeFlightKey(originKey, destinationKey) {
  return `${cacheKey(originKey)}=>${cacheKey(destinationKey)}`;
}

export function isSuspectBlocked(cached) {
  return !!(cached && cached.location_suspect === true);
}

export function isFiniteMetric(value) {
  if (value == null || value === '') return false;
  return Number.isFinite(Number(value));
}

export function createRouteMetrics(initiator = 'unknown') {
  return {
    initiator: text(initiator) || 'unknown',
    cache_hits: 0,
    cache_misses: 0,
    google_calls: 0
  };
}

export function noteCacheHit(metrics) {
  if (metrics) metrics.cache_hits += 1;
}

export function noteCacheMiss(metrics) {
  if (metrics) metrics.cache_misses += 1;
}

export function noteGoogleCall(metrics) {
  if (metrics) metrics.google_calls += 1;
}

/**
 * Usable cached route for a directed origin→destination request.
 * Never treats location_suspect rows as usable.
 */
export function isUsableCachedRoute(cached, origin = '', destination = '', options = {}) {
  if (!cached || isSuspectBlocked(cached)) return false;
  if (!isFiniteMetric(cached.distance_km) || !isFiniteMetric(cached.duration_minutes)) return false;
  const distance = Number(cached.distance_km);
  const duration = Number(cached.duration_minutes);
  if (distance < 0 || duration < 0) return false;

  const cachedOrigin = text(cached.origin_address);
  const cachedDestination = text(cached.destination_address);
  const wantOrigin = text(origin);
  const wantDestination = text(destination);
  if (wantOrigin && cachedOrigin && cachedOrigin !== wantOrigin) return false;
  if (wantDestination && cachedDestination && cachedDestination !== wantDestination) return false;

  const sameLocation = options.sameLocation === true
    || sameTravelLocation(wantOrigin, wantDestination)
    || (!wantOrigin && !wantDestination && sameTravelLocation(cachedOrigin, cachedDestination));

  const sharedCampusZero = distance === 0 && duration === 0
    && cached.provider === 'manager_verified_shared_campus'
    && cached.origin_type === 'school' && cached.destination_type === 'school'
    && Number(cached.origin_school_id) > 0
    && Number(cached.destination_school_id) > 0
    && Number(cached.origin_school_id) !== Number(cached.destination_school_id);

  if ((distance === 0 || duration === 0) && !sameLocation
    && !sharedCampusZero) {
    return false;
  }
  if (sameLocation && cached.origin_school_id != null && cached.destination_school_id != null
    && Number(cached.origin_school_id) !== Number(cached.destination_school_id) && !sharedCampusZero) return false;
  return true;
}

/**
 * In-isolate singleflight: concurrent callers for the same key share one worker.
 * Re-check cache inside the worker after winning the lock.
 */
export function createRouteSingleflight() {
  const inflight = new Map();
  return function withRouteSingleflight(key, worker) {
    const flightKey = text(key);
    if (!flightKey) return Promise.resolve().then(worker);
    const existing = inflight.get(flightKey);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(worker)
      .finally(() => {
        if (inflight.get(flightKey) === promise) inflight.delete(flightKey);
      });
    inflight.set(flightKey, promise);
    return promise;
  };
}

/** Default process-wide singleflight map for edge isolates. */
export const withRouteSingleflight = createRouteSingleflight();

/**
 * Filter instructor×school cartesian down to activity-demand links only.
 * demandLinks: Array<{ emp_id: number, school_id: number }>
 */
export function filterPairsByDemandLinks(pairs, demandLinks) {
  if (!Array.isArray(pairs)) return [];
  if (!Array.isArray(demandLinks) || !demandLinks.length) return [];
  const allowed = new Set(
    demandLinks
      .map((link) => `${Number(link.emp_id)}->${Number(link.school_id)}`)
      .filter((key) => !key.includes('NaN'))
  );
  return pairs.filter((pair) => {
    const empId = Number(pair?.origin_instructor_emp_id);
    const schoolId = Number(pair?.destination_school_id);
    if (!Number.isFinite(empId) || !Number.isFinite(schoolId)) return false;
    return allowed.has(`${empId}->${schoolId}`);
  });
}

export function demandSchoolIdSet(demandLinks) {
  const ids = new Set();
  for (const link of demandLinks || []) {
    const schoolId = Number(link?.school_id);
    if (Number.isFinite(schoolId) && schoolId > 0) ids.add(schoolId);
  }
  return ids;
}

export function filterSchoolPairsByDemandSchools(pairs, demandSchoolIds) {
  if (!Array.isArray(pairs)) return [];
  if (!(demandSchoolIds instanceof Set) || demandSchoolIds.size === 0) return [];
  return pairs.filter((pair) => {
    const originId = Number(pair?.origin_school_id);
    const destinationId = Number(pair?.destination_school_id);
    return demandSchoolIds.has(originId) && demandSchoolIds.has(destinationId);
  });
}
