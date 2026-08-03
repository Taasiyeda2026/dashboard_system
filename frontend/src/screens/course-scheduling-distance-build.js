import { SCHEDULING_SEASON, BLOCKED_SCHEDULING_STATUSES, normalizeSchedulingStatus } from './shared/activity-scheduling-eligibility.js';

const text = (value) => String(value ?? '').trim();

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
  missing_or_invalid_locations: 'חסרות כתובות תקינות לחישוב המסלול.'
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
    failed_count: 0,
    remaining_count: 0,
    failures: []
  };
}

export function mergeDistanceBuildStats(acc, batch) {
  const next = { ...acc };
  next.total_count = Number(batch?.total_count) || next.total_count;
  next.processed_count += Number(batch?.processed_count) || 0;
  next.inserted_count += Number(batch?.inserted_count) || 0;
  next.renewed_count += Number(batch?.renewed_count) || 0;
  next.already_valid_count += Number(batch?.already_valid_count) || 0;
  next.skipped_count = Math.max(next.skipped_count, Number(batch?.skipped_count) || 0);
  next.failed_count += Number(batch?.failed_count) || 0;
  next.remaining_count = Number(batch?.remaining_count) || 0;
  const failures = Array.isArray(batch?.failures) ? batch.failures : [];
  next.failures = [...(next.failures || []), ...failures].slice(0, 100);
  return next;
}

export function formatDistanceBuildProgress(stats = {}, { stopped = false, done = false } = {}) {
  const lines = [
    `סך מסלולים: ${Number(stats.total_count) || 0}`,
    `עובדו: ${Number(stats.processed_count) || 0}`,
    `נוספו: ${Number(stats.inserted_count) || 0}`,
    `חודשו: ${Number(stats.renewed_count) || 0}`,
    `כבר היו תקפים: ${Number(stats.already_valid_count) || 0}`,
    `דולגו: ${Number(stats.skipped_count) || 0}`,
    `נכשלו: ${Number(stats.failed_count) || 0}`,
    `נותרו: ${Number(stats.remaining_count) || 0}`
  ];
  const prefix = stopped ? 'הבנייה נעצרה.' : done ? 'בניית מאגר המרחקים הושלמה.' : 'בונה את מאגר המרחקים…';
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

export function courseSchedulingDataReadiness(activities = []) {
  const openCourses = (activities || []).filter(isOpenSchool2027Course);
  let missingStartDate = 0;
  let missingStartTime = 0;
  let readyForInterface = 0;
  for (const course of openCourses) {
    const hasDate = !!text(course.start_date);
    const hasTime = !!text(course.start_time);
    if (hasDate && hasTime) readyForInterface += 1;
    if (!hasDate) missingStartDate += 1;
    else if (!hasTime) missingStartTime += 1;
  }
  return {
    openCount: openCourses.length,
    readyForInterface,
    missingStartDate,
    missingStartTime,
    missingScheduleCount: missingStartDate + missingStartTime
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

export function buildGoogleAddressQuery({ schoolName = '', address = '', authorityName = '' } = {}) {
  const chunks = [schoolName, address, authorityName, 'ישראל'].map(text).filter(Boolean);
  const unique = [];
  for (const chunk of chunks) {
    if (!unique.some((existing) => normalizePlaceKey(existing) === normalizePlaceKey(chunk))) unique.push(chunk);
  }
  return unique.join(', ');
}

export function buildInstructorSchoolPairs(instructors = [], schools = []) {
  const pairs = [];
  for (const instructor of instructors) {
    const originAddress = text(instructor.address);
    if (!originAddress) continue;
    for (const school of schools) {
      const destinationAddress = text(school.address);
      if (!destinationAddress) continue;
      pairs.push({
        pair_kind: 'instructor_school',
        origin_instructor_emp_id: instructor.emp_id ?? null,
        destination_school_id: school.school_id ?? null,
        origin_address: originAddress,
        destination_address: destinationAddress,
        query_destination_address: buildGoogleAddressQuery({
          schoolName: school.school_name,
          address: destinationAddress,
          authorityName: school.authority_name
        })
      });
    }
  }
  return pairs;
}

export function buildSchoolSchoolPairs(schools = []) {
  const groups = new Map();
  for (const school of schools) {
    const address = text(school.address);
    if (!address) continue;
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
          origin_address: text(origin.address),
          destination_address: text(destination.address)
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
  return Number.isFinite(Number(cached.distance_km)) && Number.isFinite(Number(cached.duration_minutes));
}

export function shouldRenewCacheForAddressChange(cached, originAddress, destinationAddress) {
  if (!cached) return false;
  return text(cached.origin_address) !== text(originAddress)
    || text(cached.destination_address) !== text(destinationAddress);
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
