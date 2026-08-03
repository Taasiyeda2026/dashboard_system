import { SCHEDULING_SEASON, BLOCKED_SCHEDULING_STATUSES, normalizeSchedulingStatus } from './shared/activity-scheduling-eligibility.js';

const text = (value) => String(value ?? '').trim();

export const MISSING_SCHEDULE_FILTER_STORAGE_KEY = 'dashboard:course-scheduling-missing-schedule-ids';

export const SCHEDULING_ROUTE_ERROR_HE = {
  authority_school_lookup_failed: 'לא ניתן לטעון את רשימת בתי הספר לחישוב מרחקים. נסו שוב; אם התקלה חוזרת, בדקו את הרשאות המסד.',
  cache_read_failed: 'קריאת מטמון המרחקים נכשלה. נסו שוב בעוד רגע.',
  cache_write_failed: 'שמירת מסלול במטמון המרחקים נכשלה. המנה לא הושלמה — ניתן להריץ שוב להמשך.',
  route_service_unavailable: 'שירות חישוב המסלולים אינו זמין כרגע. נסו שוב מאוחר יותר.',
  route_not_found: 'לא נמצא מסלול עבור אחת הכתובות. בדקו את הכתובת במקור הנתונים.',
  google_key_not_configured: 'מפתח Google Maps אינו מוגדר בשרת. לא ניתן לבנות את מאגר המרחקים עד להגדרתו.',
  scheduling_permission_denied: 'אין הרשאה לבניית מאגר המרחקים. נדרשת הרשאת מנהל או מנהל תפעול.',
  authentication_required: 'יש להתחבר מחדש כדי לבנות את מאגר המרחקים.',
  authorization_check_failed: 'בדיקת ההרשאות נכשלה. נסו להתחבר מחדש ואז להריץ שוב.',
  instructor_lookup_failed: 'לא ניתן לטעון את רשימת המדריכים לחישוב מרחקים. נסו שוב.',
  invalid_authentication: 'ההתחברות אינה תקפה. יש להתחבר מחדש.',
  server_configuration_missing: 'הגדרות השרת לחישוב מסלולים חסרות. פנו לתמיכה טכנית.',
  missing_or_invalid_locations: 'חסרות כתובות תקינות לחישוב המסלול.',
  missing_address: 'חסרה כתובת למדריך פעיל. המסלולים שלו דולגו עד להשלמת הכתובת במקור הנתונים.',
  school_address_lookup_failed: 'לא ניתן לטעון את כתובות בתי הספר לשיבוץ. חישוב המרחקים הופסק כדי לא להשתמש בשם בית ספר ככתובת.'
};

export function translateSchedulingRouteError(codeOrMessage, fallback = 'פעולת המרחקים נכשלה. נסו שוב.') {
  const raw = text(codeOrMessage);
  if (!raw) return fallback;
  if (/edge function returned a non-2xx status code/i.test(raw)) {
    return 'שירות חישוב המרחקים החזיר שגיאה. בדקו הרשאות, מפתח מפות וחיבור — ואז הריצו שוב.';
  }
  if (SCHEDULING_ROUTE_ERROR_HE[raw]) return SCHEDULING_ROUTE_ERROR_HE[raw];
  for (const [code, message] of Object.entries(SCHEDULING_ROUTE_ERROR_HE)) {
    if (raw.includes(code)) return message;
  }
  return raw || fallback;
}

export function emptyDistanceBuildStats() {
  return {
    total_count: 0,
    processed_count: 0,
    inserted_count: 0,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 0,
    skipped_instructors_missing_address_count: 0,
    failed_count: 0,
    remaining_count: 0,
    failures: []
  };
}

export function dedupeDistanceBuildFailures(failures = []) {
  const seen = new Set();
  const unique = [];
  for (const row of failures || []) {
    const key = `${text(row?.entity_type)}|${text(row?.entity_id)}|${text(row?.reason)}`;
    if (!key || key === '||' || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export function mergeDistanceBuildStats(acc, batch) {
  const next = { ...acc };
  next.total_count = Number(batch?.total_count) || next.total_count;
  next.processed_count += Number(batch?.processed_count) || 0;
  next.inserted_count += Number(batch?.inserted_count) || 0;
  next.renewed_count += Number(batch?.renewed_count) || 0;
  next.already_valid_count += Number(batch?.already_valid_count) || 0;
  // Skip counters are absolute per build, not per-batch deltas — keep a stable max.
  next.skipped_count = Math.max(next.skipped_count, Number(batch?.skipped_count) || 0);
  next.skipped_instructors_missing_address_count = Math.max(
    next.skipped_instructors_missing_address_count,
    Number(batch?.skipped_instructors_missing_address_count) || 0
  );
  next.failed_count += Number(batch?.failed_count) || 0;
  next.remaining_count = Number(batch?.remaining_count) || 0;
  const failures = Array.isArray(batch?.failures) ? batch.failures : [];
  next.failures = dedupeDistanceBuildFailures([...(next.failures || []), ...failures]).slice(0, 100);
  return next;
}

export function formatDistanceBuildProgress(stats = {}, { stopped = false, done = false } = {}) {
  const missingInstructors = Number(stats.skipped_instructors_missing_address_count) || 0;
  const skippedTotal = Number(stats.skipped_count) || 0;
  const skippedOther = Math.max(0, skippedTotal - missingInstructors);
  const failedCount = Number(stats.failed_count) || 0;
  const lines = [
    `סך מסלולים: ${Number(stats.total_count) || 0}`,
    `עובדו: ${Number(stats.processed_count) || 0}`,
    `נוספו: ${Number(stats.inserted_count) || 0}`,
    `חודשו: ${Number(stats.renewed_count) || 0}`,
    `כבר היו תקפים: ${Number(stats.already_valid_count) || 0}`,
    `מדריכים פעילים ללא כתובת: ${missingInstructors}`,
    `דולגו מסיבות אחרות: ${skippedOther}`,
    `נכשלו: ${failedCount}`,
    `נותרו: ${Number(stats.remaining_count) || 0}`
  ];
  let prefix = 'בונה את מאגר המרחקים…';
  if (stopped) {
    prefix = 'בניית מאגר המרחקים נעצרה וניתן להמשיך בהרצה נוספת.';
  } else if (done && failedCount > 0) {
    prefix = 'בניית מאגר המרחקים הושלמה עם כשלים.';
  } else if (done) {
    prefix = 'בניית מאגר המרחקים הושלמה בהצלחה.';
  }
  const failureNote = (stats.failures || []).length
    ? ` כשלים לדוגמה: ${(stats.failures || []).slice(0, 5).map((row) => `${row.entity_type} ${row.entity_id} (${translateSchedulingRouteError(row.reason, row.reason)})`).join(' · ')}.`
    : '';
  return `${prefix} ${lines.join(' · ')}.${failureNote}`;
}

export function isOpenSchool2027Course(activity = {}) {
  if (text(activity.activity_season) !== SCHEDULING_SEASON) return false;
  const type = text(activity.activity_type || activity.type).toLocaleLowerCase('he-IL');
  if (!['קורס', 'course', 'program'].includes(type)) return false;
  const status = normalizeSchedulingStatus(activity.status ?? activity.activity_status);
  if (BLOCKED_SCHEDULING_STATUSES.has(status)) return false;
  return ['פתוח', 'open'].includes(status);
}

export function isMissingScheduleCourse(activity = {}) {
  if (!isOpenSchool2027Course(activity)) return false;
  return !text(activity.start_date) || !text(activity.start_time);
}

export function collectMissingScheduleCourseIds(activities = []) {
  return (activities || [])
    .filter(isMissingScheduleCourse)
    .map((course) => text(course.row_id || course.RowID || course.id))
    .filter(Boolean);
}

export function readMissingScheduleIdSet(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem?.(MISSING_SCHEDULE_FILTER_STORAGE_KEY);
    const ids = JSON.parse(raw || '[]');
    return new Set((Array.isArray(ids) ? ids : []).map((value) => text(value)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function applyMissingScheduleFilter(rows, state = {}, storage = globalThis.sessionStorage) {
  if (!state?.activitiesMissingScheduleOnly) return rows;
  const idSet = readMissingScheduleIdSet(storage);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const id = text(row?.row_id || row?.RowID || row?.id);
    if (idSet.size && idSet.has(id)) return true;
    return isMissingScheduleCourse(row);
  });
}

export function courseSchedulingDataReadiness(activities = []) {
  const openCourses = (activities || []).filter(isOpenSchool2027Course);
  let missingStartDate = 0;
  let missingStartTime = 0;
  let missingScheduleCount = 0;
  let readyForInterface = 0;
  for (const course of openCourses) {
    const hasDate = !!text(course.start_date);
    const hasTime = !!text(course.start_time);
    if (hasDate && hasTime) readyForInterface += 1;
    if (!hasDate) missingStartDate += 1;
    if (!hasTime) missingStartTime += 1;
    if (!hasDate || !hasTime) missingScheduleCount += 1;
  }
  return {
    openCount: openCourses.length,
    readyForInterface,
    missingStartDate,
    missingStartTime,
    missingScheduleCount
  };
}

export function pickNearestActionableCourse(rowModels = [], todayStr = new Date().toISOString().slice(0, 10)) {
  const actionable = (rowModels || []).filter((row) => row?.bucket && row?.course);
  if (!actionable.length) return null;
  const scored = actionable.map((row) => {
    const start = text(row.course.start_date) || '9999-12-31';
    const days = Math.ceil((new Date(`${start}T00:00:00`) - new Date(`${todayStr}T00:00:00`)) / 86400000);
    return { row, start, days };
  });
  scored.sort((a, b) => {
    const aFuture = a.days >= 0 ? 0 : 1;
    const bFuture = b.days >= 0 ? 0 : 1;
    if (aFuture !== bFuture) return aFuture - bFuture;
    if (aFuture === 0) return a.days - b.days || a.start.localeCompare(b.start);
    return b.days - a.days || b.start.localeCompare(a.start);
  });
  return scored[0]?.row || null;
}

export function normalizePlaceKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

export function schoolEntityKey(school = {}) {
  if (school.school_id != null && Number.isFinite(Number(school.school_id))) {
    return `school_id:${Number(school.school_id)}`;
  }
  return [
    'school_ref',
    normalizePlaceKey(school.authority_name || ''),
    normalizePlaceKey(school.school_name || ''),
    normalizePlaceKey(school.address || '')
  ].join('|');
}

export function instructorEntityKey(empId) {
  return `instructor:${Number(empId)}`;
}

export function pairFailureId(originEntityKey, destinationEntityKey) {
  return `${originEntityKey}->${destinationEntityKey}`;
}

function addressScore(address) {
  return text(address).length;
}

export function preferSchoolRow(current, candidate) {
  if (!current) return candidate;
  const currentAuthority = current.authority_id != null ? 1 : 0;
  const candidateAuthority = candidate.authority_id != null ? 1 : 0;
  if (candidateAuthority !== currentAuthority) return candidateAuthority > currentAuthority ? candidate : current;
  if (addressScore(candidate.address) !== addressScore(current.address)) {
    return addressScore(candidate.address) > addressScore(current.address) ? candidate : current;
  }
  return current;
}

export function dedupeAuthoritySchools(schools = []) {
  const byKey = new Map();
  let duplicateCount = 0;
  for (const school of schools || []) {
    const address = text(school.address);
    if (!address) continue;
    const key = schoolEntityKey({ ...school, address });
    if (byKey.has(key)) {
      duplicateCount += 1;
      byKey.set(key, preferSchoolRow(byKey.get(key), { ...school, address }));
      continue;
    }
    byKey.set(key, { ...school, address });
  }
  return {
    schools: [...byKey.values()],
    duplicateCount,
    uniqueCount: byKey.size
  };
}

export function buildSchoolLocationLookup(schoolRows = []) {
  const { schools, duplicateCount, uniqueCount } = dedupeAuthoritySchools(schoolRows);
  const bySchoolId = new Map();
  const byAuthorityAndName = new Map();
  for (const school of schools) {
    if (school.school_id != null && Number.isFinite(Number(school.school_id))) {
      bySchoolId.set(Number(school.school_id), school);
    }
    const nameKey = `${normalizePlaceKey(school.authority_name || '')}|${normalizePlaceKey(school.school_name || '')}`;
    if (nameKey !== '|') byAuthorityAndName.set(nameKey, school);
  }
  return { schools, bySchoolId, byAuthorityAndName, duplicateCount, uniqueCount };
}

export function resolveCanonicalSchoolAddress(activity = {}, lookup) {
  const schoolId = activity.school_id == null ? null : Number(activity.school_id);
  if (schoolId != null && Number.isFinite(schoolId) && lookup?.bySchoolId?.has(schoolId)) {
    return text(lookup.bySchoolId.get(schoolId).address);
  }
  const nameKey = `${normalizePlaceKey(activity.authority || activity.authority_name || '')}|${normalizePlaceKey(activity.school || activity.school_name || '')}`;
  if (nameKey !== '|' && lookup?.byAuthorityAndName?.has(nameKey)) {
    return text(lookup.byAuthorityAndName.get(nameKey).address);
  }
  return '';
}

export function enrichActivitiesWithSchoolAddresses(activities = [], schoolRows = []) {
  const lookup = buildSchoolLocationLookup(schoolRows);
  let missingCount = 0;
  const enriched = (activities || []).map((activity) => {
    const school_address = resolveCanonicalSchoolAddress(activity, lookup);
    if (!school_address) missingCount += 1;
    return {
      ...activity,
      school_address,
      school_address_missing: !school_address
    };
  });
  return {
    activities: enriched,
    lookup,
    missingCount,
    uniqueSchoolCount: lookup.uniqueCount,
    duplicateSchoolCount: lookup.duplicateCount
  };
}

export function travelCacheKey(originAddress, destinationAddress) {
  return `${normalizePlaceKey(originAddress)}|${normalizePlaceKey(destinationAddress)}`;
}

function isFiniteMetric(value) {
  // Reject null/'' explicitly — Number(null) is 0 and must not count as a valid metric.
  if (value == null || value === '') return false;
  return Number.isFinite(Number(value));
}

export function isLookupTravelCacheValid(cached, originAddress, destinationAddress, now = Date.now()) {
  if (!cached) return false;
  const cachedOrigin = text(cached.origin_address);
  const cachedDestination = text(cached.destination_address);
  // Address fields are enforced only when present (legacy rows may omit them).
  if (cachedOrigin && cachedOrigin !== text(originAddress)) return false;
  if (cachedDestination && cachedDestination !== text(destinationAddress)) return false;
  const expiresAt = new Date(String(cached.expires_at || '')).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return isFiniteMetric(cached.distance_km) && isFiniteMetric(cached.duration_minutes);
}

// Pure single-pair cache resolver used by integration tests to prove the consumer
// hits the same address keys produced by the distance-build repository.
export function resolveSinglePairFromTravelCache(cacheRows = [], originAddress, destinationAddress, now = Date.now()) {
  const originKey = normalizePlaceKey(originAddress);
  const destinationKey = normalizePlaceKey(destinationAddress);
  if (!originKey || !destinationKey) {
    return { calculated: false, reason: 'missing_or_invalid_locations', mapsCall: false };
  }
  const cached = (cacheRows || []).find((row) => (
    normalizePlaceKey(row.origin_key || row.origin_address) === originKey
    && normalizePlaceKey(row.destination_key || row.destination_address) === destinationKey
  )) || null;

  if (isLookupTravelCacheValid(cached, originAddress, destinationAddress, now)) {
    return {
      calculated: true,
      cached: true,
      renewed: false,
      mapsCall: false,
      distance_km: Number(cached.distance_km),
      duration_minutes: Number(cached.duration_minutes)
    };
  }

  // Same normalized address never calls Google — persist/renew a zero same_school row.
  if (originKey === destinationKey) {
    return {
      calculated: true,
      cached: false,
      renewed: !!cached,
      mapsCall: false,
      distance_km: 0,
      duration_minutes: 0,
      provider: 'same_school'
    };
  }

  return {
    calculated: false,
    cached: false,
    reason: cached ? 'cache_expired_or_invalid' : 'route_not_found',
    mapsCall: true,
    renewed: !!cached
  };
}

export function buildGoogleAddressQuery({ schoolName = '', address = '', authorityName = '' } = {}) {
  const chunks = [schoolName, address, authorityName, 'ישראל'].map(text).filter(Boolean);
  const unique = [];
  for (const chunk of chunks) {
    if (!unique.some((existing) => normalizePlaceKey(existing) === normalizePlaceKey(chunk))) unique.push(chunk);
  }
  return unique.join(', ');
}

function enrichSchool(school) {
  const address = text(school.address);
  return {
    ...school,
    address,
    entity_key: schoolEntityKey({ ...school, address })
  };
}

export function buildInstructorSchoolPairs(instructors = [], schools = []) {
  const { schools: uniqueSchools } = dedupeAuthoritySchools(schools);
  const pairs = [];
  for (const instructor of instructors) {
    const originAddress = text(instructor.address);
    if (!originAddress) continue;
    const originEntityKey = instructorEntityKey(instructor.emp_id);
    for (const rawSchool of uniqueSchools) {
      const school = enrichSchool(rawSchool);
      if (!school.address) continue;
      pairs.push({
        pair_kind: 'instructor_school',
        origin_instructor_emp_id: instructor.emp_id ?? null,
        destination_school_id: school.school_id ?? null,
        origin_address: originAddress,
        destination_address: school.address,
        origin_entity_key: originEntityKey,
        destination_entity_key: school.entity_key,
        query_destination_address: buildGoogleAddressQuery({
          schoolName: school.school_name,
          address: school.address,
          authorityName: school.authority_name
        })
      });
    }
  }
  return pairs;
}

export function buildSchoolSchoolPairs(schools = []) {
  const { schools: uniqueSchools } = dedupeAuthoritySchools(schools);
  const groups = new Map();
  for (const raw of uniqueSchools) {
    const school = enrichSchool(raw);
    if (!school.address) continue;
    const groupKey = school.authority_id != null
      ? `id:${school.authority_id}`
      : `name:${normalizePlaceKey(school.authority_name || '')}`;
    if (!groupKey || groupKey === 'id:null' || groupKey === 'name:') continue;
    const list = groups.get(groupKey) || [];
    list.push(school);
    groups.set(groupKey, list);
  }
  const pairs = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const origin = list[i];
        const destination = list[j];
        if (origin.entity_key === destination.entity_key) continue;
        if (
          origin.school_id != null
          && destination.school_id != null
          && origin.school_id === destination.school_id
        ) continue;
        pairs.push({
          pair_kind: 'school_school',
          origin_school_id: origin.school_id ?? null,
          destination_school_id: destination.school_id ?? null,
          authority_id: origin.authority_id ?? null,
          origin_address: origin.address,
          destination_address: destination.address,
          origin_entity_key: origin.entity_key,
          destination_entity_key: destination.entity_key
        });
      }
    }
  }
  return pairs;
}

export function shouldSkipValidCacheEntry(cached, originAddress, destinationAddress, now = Date.now()) {
  if (!cached) return false;
  if (text(cached.origin_address) !== text(originAddress)) return false;
  if (text(cached.destination_address) !== text(destinationAddress)) return false;
  const expiresAt = new Date(String(cached.expires_at || '')).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return isFiniteMetric(cached.distance_km) && isFiniteMetric(cached.duration_minutes);
}

export function shouldRenewCacheForAddressChange(cached, originAddress, destinationAddress) {
  if (!cached) return false;
  return text(cached.origin_address) !== text(originAddress)
    || text(cached.destination_address) !== text(destinationAddress);
}

export function findCachedRowForPair(cacheRows = [], pair = {}) {
  const originEntityKey = text(pair.origin_entity_key);
  const destinationEntityKey = text(pair.destination_entity_key);
  if (originEntityKey && destinationEntityKey) {
    const byEntity = (cacheRows || []).find((row) => (
      text(row.origin_entity_key) === originEntityKey
      && text(row.destination_entity_key) === destinationEntityKey
    ));
    if (byEntity) return byEntity;
  }
  return (cacheRows || []).find((row) => (
    text(row.origin_key) === normalizePlaceKey(pair.origin_address)
    && text(row.destination_key) === normalizePlaceKey(pair.destination_address)
  )) || null;
}

// Pure classifier used by tests to verify insert → already_valid across two builds
// without calling Google Maps.
export function classifyTravelCachePair(cacheRows = [], pair = {}, now = Date.now()) {
  const existing = findCachedRowForPair(cacheRows, pair);
  if (shouldSkipValidCacheEntry(existing, pair.origin_address, pair.destination_address, now)) {
    return { action: 'already_valid', mapsCall: false, existing };
  }
  if (!existing) return { action: 'insert', mapsCall: true, existing: null };
  if (shouldRenewCacheForAddressChange(existing, pair.origin_address, pair.destination_address)) {
    return { action: 'renew', mapsCall: true, existing };
  }
  return { action: 'renew', mapsCall: true, existing };
}

export function simulateConsecutiveTravelBuilds(pairs = [], { now = Date.now(), routeFactory } = {}) {
  const cache = [];
  const runs = [];
  const makeRoute = routeFactory || (() => ({ distance_km: 1.5, duration_minutes: 8 }));
  for (let runIndex = 0; runIndex < 2; runIndex += 1) {
    const stats = emptyDistanceBuildStats();
    stats.total_count = pairs.length;
    let mapsCalls = 0;
    for (const pair of pairs) {
      const decision = classifyTravelCachePair(cache, pair, now);
      if (decision.action === 'already_valid') {
        stats.already_valid_count += 1;
        stats.processed_count += 1;
        continue;
      }
      mapsCalls += 1;
      const route = makeRoute(pair);
      const row = {
        origin_key: normalizePlaceKey(pair.origin_address),
        destination_key: normalizePlaceKey(pair.destination_address),
        origin_address: pair.origin_address,
        destination_address: pair.destination_address,
        origin_entity_key: pair.origin_entity_key,
        destination_entity_key: pair.destination_entity_key,
        destination_school_id: pair.destination_school_id ?? null,
        origin_school_id: pair.origin_school_id ?? null,
        distance_km: route.distance_km,
        duration_minutes: route.duration_minutes,
        expires_at: new Date(now + 30 * 86400000).toISOString()
      };
      if (decision.existing) {
        const index = cache.indexOf(decision.existing);
        if (index >= 0) cache.splice(index, 1, row);
        else cache.push(row);
        stats.renewed_count += 1;
      } else {
        cache.push(row);
        stats.inserted_count += 1;
      }
      stats.processed_count += 1;
    }
    runs.push({ stats, mapsCalls, cacheSize: cache.length });
  }
  return { runs, cache };
}

export async function invokeSchedulingRouteBuild(invoke, body) {
  const { data, error } = await invoke(body);
  const payload = data && typeof data === 'object' ? data : null;
  const code = payload?.error || payload?.reason || '';
  if (error) {
    const message = translateSchedulingRouteError(code || error.message);
    const err = new Error(message);
    err.code = code || 'route_service_unavailable';
    err.payload = payload;
    throw err;
  }
  if (payload?.error && !payload?.calculated && payload?.build !== true) {
    const err = new Error(translateSchedulingRouteError(payload.error));
    err.code = payload.error;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export async function runDistanceBuildLoop({
  invoke,
  scope = 'all',
  limit = 25,
  shouldStop = () => false,
  onProgress = async () => {}
} = {}) {
  let cursor = null;
  let done = false;
  let stats = emptyDistanceBuildStats();
  let stopped = false;

  while (!done) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    const batch = await invokeSchedulingRouteBuild(invoke, {
      mode: 'build_cache',
      scope,
      cursor,
      limit
    });
    stats = mergeDistanceBuildStats(stats, batch);
    done = !!batch?.done;
    cursor = batch?.next_cursor || null;
    await onProgress({ stats, done, stopped: false, batch });
    if (!done && !cursor) break;
  }

  return { stats, done, stopped };
}
