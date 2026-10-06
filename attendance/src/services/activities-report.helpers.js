/** Pure helpers for attendance new-report activity selection (no Supabase imports). */

export const ONLINE_REPORT_TYPE = 'זום';
export const LEGACY_ONLINE_REPORT_TYPE = 'מקוון';
export const TRAINING_REPORT_TYPE = 'הכשרה';
export const OPERATIONS_REPORT_TYPE = 'תפעול';
export const CANCELLATION_REPORT_TYPE = 'ביטול זמן';
export const TRAINING_DB_ACTIVITY_TYPES = Object.freeze(['course', 'tour']);

// Operational work is not linked to an activity and is described with free text.
export const NO_ACTIVITY_NAME_REPORT_TYPES = [];
export const OPEN_FIELD_REPORT_TYPES = [OPERATIONS_REPORT_TYPE];

// These report types may refer to any canonical activity type rather than one DB type.
// Training is intentionally excluded: its catalog is limited to course/tour names.
export const UNFILTERED_ACTIVITY_REPORT_TYPES = [
  CANCELLATION_REPORT_TYPE,
  ONLINE_REPORT_TYPE,
];

export const HEBREW_TO_DB_TYPE = {
  'סדנה':        'workshop',
  'סדנאות קיץ': 'workshop', // legacy label: treated exactly as סדנה
  'קורס':        'course',
  'חדר בריחה':  'escape_room',
  'סיור':        'tour',
  'צהרון':       'after_school',
};

const ACTIVITY_TYPE_MAP = {
  after_school: 'צהרון',
  course:       'קורס',
  escape_room:  'חדר בריחה',
  tour:         'סיור',
  workshop:     'סדנה',
};

const DB_TYPE_ALIASES = {
  course: 'course',
  workshop: 'workshop',
  tour: 'tour',
  escape_room: 'escape_room',
  after_school: 'after_school',
  'קורס': 'course',
  'סדנה': 'workshop',
  'סדנאות': 'workshop',
  'סדנאות קיץ': 'workshop',
  'סיור': 'tour',
  'חדר בריחה': 'escape_room',
  'חדרי בריחה': 'escape_room',
  'escape room': 'escape_room',
  'צהרון': 'after_school',
};

// זום הוא אופן ביצוע של הכשרה, לא סוג פעילות לבחירה בדיווח חדש.
export const HEBREW_ACTIVITY_TYPES = [
  'קורס',
  'סדנה',
  'סיור',
  'חדר בריחה',
  TRAINING_REPORT_TYPE,
  CANCELLATION_REPORT_TYPE,
  OPERATIONS_REPORT_TYPE,
];

export function normalizeAttendanceReportType(value) {
  const raw = String(value || '').trim();
  if (raw === 'סדנאות קיץ') return 'סדנה';
  if (raw === LEGACY_ONLINE_REPORT_TYPE) return ONLINE_REPORT_TYPE;
  return raw;
}

export function toHebrewType(dbType) {
  if (!dbType) return '';
  const key = String(dbType).trim();
  return ACTIVITY_TYPE_MAP[key] || ACTIVITY_TYPE_MAP[key.toLowerCase()] || normalizeAttendanceReportType(key);
}

export function normalizeDbActivityType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (DB_TYPE_ALIASES[lower]) return DB_TYPE_ALIASES[lower];
  if (DB_TYPE_ALIASES[raw]) return DB_TYPE_ALIASES[raw];
  return lower;
}

export function getDbTypesForReportType(reportType) {
  const normalizedReportType = normalizeAttendanceReportType(reportType);
  if (normalizedReportType === TRAINING_REPORT_TYPE) return [...TRAINING_DB_ACTIVITY_TYPES];
  if (!normalizedReportType || UNFILTERED_ACTIVITY_REPORT_TYPES.includes(normalizedReportType)) return null;
  if (NO_ACTIVITY_NAME_REPORT_TYPES.includes(normalizedReportType)) return [];
  if (OPEN_FIELD_REPORT_TYPES.includes(normalizedReportType)) return [];
  const db = HEBREW_TO_DB_TYPE[normalizedReportType];
  return db ? [db] : [];
}

function isTrainingSpecialActivity(activity) {
  return activity?.__attendanceTrainingSchedule === true
    || activity?.__attendanceSynthetic === 'base_training'
    || activity?.__attendanceTrainingCatalog === true;
}

export function activityMatchesReportType(activity, reportType) {
  const normalizedReportType = normalizeAttendanceReportType(reportType);
  if (normalizedReportType === TRAINING_REPORT_TYPE && isTrainingSpecialActivity(activity)) return true;
  const dbTypes = getDbTypesForReportType(normalizedReportType);
  if (dbTypes === null) return true;
  if (!dbTypes.length) return false;
  return dbTypes.includes(normalizeDbActivityType(activity?.activity_type));
}

export function filterActivitiesForReportType(activities = [], reportType = '') {
  const normalizedReportType = normalizeAttendanceReportType(reportType);
  if (normalizedReportType === TRAINING_REPORT_TYPE) {
    // The instructor-facing training picker must not expose assigned activity instances
    // with school/authority metadata. It receives only the global training catalog plus
    // explicit scheduled/base-training rows.
    return (Array.isArray(activities) ? activities : []).filter(isTrainingSpecialActivity);
  }

  const dbTypes = getDbTypesForReportType(normalizedReportType);
  if (dbTypes === null) return Array.isArray(activities) ? activities : [];
  if (!dbTypes.length) return [];
  return (Array.isArray(activities) ? activities : []).filter((row) =>
    dbTypes.includes(normalizeDbActivityType(row?.activity_type)),
  );
}

export function currentAttendanceActivitySeasons(referenceDateStr) {
  const date = referenceDateStr || new Date().toISOString().slice(0, 10);
  if (date >= '2026-08-20') return ['school_2027'];
  return ['regular', 'summer_2026'];
}

export function instructorActivityOptionLabel(activity) {
  return activity?.activity_name || toHebrewType(activity?.activity_type) || 'פעילות';
}

export function instructorActivityOptionMeta(activity) {
  const school = activity?.single_school_name
    || (activity?.school_link_status === 'multiple_schools' ? 'מספר בתי ספר' : '')
    || activity?.school
    || '';
  const authority = activity?.authority_name || activity?.authority || '';
  return [school, authority].filter(Boolean).join(' · ');
}

export function activitySearchHaystack(activity) {
  return [
    activity?.row_id,
    activity?.id,
    activity?.activity_name,
    activity?.activity_type,
    toHebrewType(activity?.activity_type),
    activity?.activity_no,
    activity?.program_name,
    activity?.authority_name,
    activity?.authority,
    activity?.single_school_name,
    activity?.school,
    activity?.single_semel_mosad,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function trainingActivitySearchText(activity) {
  return [
    instructorActivityOptionLabel(activity),
    activity?.program_name,
    toHebrewType(activity?.activity_type),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function instructorActivitySelectOptions(activities = [], { reportType = '' } = {}) {
  const seen = new Set();
  const normalizedReportType = normalizeAttendanceReportType(reportType);
  const trainingPicker = normalizedReportType === TRAINING_REPORT_TYPE;
  const list = filterActivitiesForReportType(activities, normalizedReportType);
  return list
    .map((activity) => {
      const value = String(activity?.row_id || activity?.id || '').trim();
      if (!value) return null;
      return {
        value,
        label: instructorActivityOptionLabel(activity),
        // Training is a content choice only. Never show school/authority beside the name.
        meta: trainingPicker ? '' : instructorActivityOptionMeta(activity),
        activity,
        searchText: trainingPicker ? trainingActivitySearchText(activity) : activitySearchHaystack(activity),
      };
    })
    .filter((option) => {
      if (!option) return false;
      const key = trainingPicker
        ? String(option.label || '').trim().toLocaleLowerCase('he-IL')
        : option.value;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function courseText(value) {
  return String(value ?? '').trim();
}

/** Business identity only; a dashboard row id is never a picker value. */
export function dashboardCourseChoiceKey(row = {}) {
  const schoolId = courseText(row.school_id) || courseText(row.single_school_id);
  return `dashboard-course:${JSON.stringify([
    courseText(row.activity_name || row.program_name),
    schoolId ? ['id', schoolId] : ['name', courseText(row.single_school_name || row.school_name || row.school)],
  ])}`;
}

export function buildDashboardCourseOptions(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeDbActivityType(row?.activity_type) !== 'course') continue;
    const name = courseText(row.activity_name || row.program_name);
    if (!name || !courseText(row.row_id || row.id)) continue;
    const value = dashboardCourseChoiceKey(row);
    if (!groups.has(value)) {
      const school = courseText(row.single_school_name || row.school_name || row.school);
      const authority = courseText(row.authority_name || row.authority);
      groups.set(value, {
        value,
        label: [name, school].filter(Boolean).join(' — '),
        meta: authority,
        searchText: [name, school, authority].filter(Boolean).join(' ').toLowerCase(),
        candidateRows: [],
      });
    }
    groups.get(value).candidateRows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

/** Paid work is calculated per distinct teaching session. Simultaneous classes
 * share instructional time; adjacent sessions retain their own 45-minute bonus.
 * Preparation intervals may overlap, but their earned minutes must not be lost.
 */
export function dashboardCourseWork(rows = []) {
  const intervals = rows.map(row => [parseClockMinutes(row.start_time), parseClockMinutes(row.end_time)])
    .filter(([start, end]) => start != null && end != null && end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (intervals.length !== rows.length || !intervals.length) return null;
  const sessions = [];
  for (const [start, end] of intervals) {
    const previous = sessions.at(-1);
    if (previous && start < previous[1]) previous[1] = Math.max(previous[1], end);
    else sessions.push([start, end]);
  }
  const paid = sessions.map(([start, end]) => {
    const blocks = Math.floor((end - start) / 45);
    return [Math.max(0, start - Math.ceil(blocks / 2) * 15), Math.min(1439, end + Math.floor(blocks / 2) * 15)];
  });
  const paidMinutes = paid.reduce((sum, [start, end]) => sum + end - start, 0);
  return { startTime: formatClockMinutes(Math.min(...paid.map(row => row[0]))),
    endTime: formatClockMinutes(Math.max(...paid.map(row => row[1]))),
    paidMinutes, totalHours: Math.round(paidMinutes / 60 * 100) / 100 };
}

/** Resolve a business activity to ALL sources in a fresh authorized date snapshot.
 * A legacy row hint locates the business choice; it never truncates its sources.
 */
export function resolveDashboardCourseChoice(choice, rows = [], hints = {}) {
  const candidates = (Array.isArray(rows) ? rows : []).filter(row =>
    normalizeDbActivityType(row?.activity_type) === 'course' && dashboardCourseChoiceKey(row) === choice?.value);
  const unique = [...new Map(candidates.map(row => [courseText(row.row_id || row.id), row])).values()]
    .sort((a, b) => courseText(a.row_id).localeCompare(courseText(b.row_id)));
  if (!unique.length || hints.activityRowId && !unique.some(row => courseText(row.row_id) === courseText(hints.activityRowId))) {
    return { status: 'unavailable', activity: null, candidateRows: [] };
  }
  const work = dashboardCourseWork(unique);
  if (!work) return { status: 'invalid_schedule', activity: null, candidateRows: unique };
  const common = key => unique.every(row => row[key] === unique[0][key]) ? unique[0][key] : null;
  const activity = Object.fromEntries(Object.keys(unique[0]).map(key => [key, common(key)]));
  if (unique.length > 1) {
    for (const key of ['id', 'row_id', 'activity_no', 'meeting_no', 'grade', 'class_group']) activity[key] = null;
  }
  const identity = JSON.parse(choice.value.slice('dashboard-course:'.length));
  activity.school_id = identity[1][0] === 'id' ? Number(identity[1][1]) : null;
  activity.single_school_id = activity.school_id;
  activity.single_school_name = unique.map(row => courseText(row.single_school_name || row.school_name || row.school)).sort()[0];
  activity.school_link_status = activity.school_id ? 'single_school' : 'no_school';
  activity.__dashboardCourseSources = unique;
  activity.__dashboardCourseIdentity = identity;
  activity.__dashboardCourseWork = work;
  return { status: 'resolved', activity, candidateRows: unique };
}

export function deriveAuthoritySchoolListFromActivities(activities = []) {
  const authorities = new Map();

  function ensureAuthority(id, name) {
    const key = id != null ? String(id) : `name:${name}`;
    if (!authorities.has(key)) {
      authorities.set(key, {
        authority_id: id ?? null,
        authority_name: name || '',
        schools: new Map(),
      });
    }
    return authorities.get(key);
  }

  for (const activity of activities) {
    const authId = activity?.authority_id ?? null;
    const authName = activity?.authority_name || activity?.authority || '';
    const bucket = ensureAuthority(authId, authName);

    if (activity?.school_link_status === 'multiple_schools') {
      const raw = activity?.linked_schools_json;
      let schools = [];
      if (Array.isArray(raw)) schools = raw;
      else if (typeof raw === 'string') {
        try { schools = JSON.parse(raw); } catch { schools = []; }
      }
      for (const s of schools) {
        const sid = Number(s?.id);
        if (!sid) continue;
        bucket.schools.set(sid, {
          id: sid,
          name: s?.name || String(sid),
          semel_mosad: s?.semel_mosad ?? null,
        });
      }
    } else if (activity?.single_school_id) {
      const sid = Number(activity.single_school_id);
      bucket.schools.set(sid, {
        id: sid,
        name: activity.single_school_name || String(sid),
        semel_mosad: activity.single_semel_mosad ?? null,
      });
    }
  }

  return Array.from(authorities.values())
    .map((entry) => ({
      authority_id: entry.authority_id,
      authority_name: entry.authority_name,
      schools: Array.from(entry.schools.values()).sort((a, b) => a.name.localeCompare(b.name, 'he')),
    }))
    .filter((entry) => entry.authority_name || entry.authority_id != null)
    .sort((a, b) => a.authority_name.localeCompare(b.authority_name, 'he'));
}

export function getSchoolOptions(activity) {
  if (activity.school_link_status === 'multiple_schools') {
    const raw = activity.linked_schools_json;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return [];
  }
  if (activity.school_link_status === 'single_school' && activity.single_school_id) {
    return [{
      id:          activity.single_school_id,
      name:        activity.single_school_name || '',
      semel_mosad: activity.single_semel_mosad || null,
    }];
  }
  return [];
}

export function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}


function parseClockMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function formatClockMinutes(totalMinutes) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Number(totalMinutes) || 0));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Attendance work window for dashboard-linked course/workshop activities.
 * Workshop: exact dashboard hours.
 * Course: add 15 minutes of paid work for every full 45 dashboard minutes.
 * Course extensions are balanced around the dashboard meeting in 15-minute blocks.
 */
export function attendanceTimesFromActivity(activity, reportType = '') {
  if (activity?.__dashboardCourseWork) return activity.__dashboardCourseWork;
  const startMinutes = parseClockMinutes(activity?.start_time);
  const endMinutes = parseClockMinutes(activity?.end_time);
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
    return { startTime: '', endTime: '' };
  }

  const normalizedType = normalizeAttendanceReportType(reportType);
  let extraMinutes = 0;

  let beforeMinutes = 0;
  let afterMinutes = 0;

  if (normalizedType === 'קורס') {
    const dashboardMinutes = endMinutes - startMinutes;
    const fortyFiveMinuteBlocks = Math.floor(dashboardMinutes / 45);
    beforeMinutes = Math.ceil(fortyFiveMinuteBlocks / 2) * 15;
    afterMinutes = Math.floor(fortyFiveMinuteBlocks / 2) * 15;
  }

  return {
    startTime: formatClockMinutes(startMinutes - beforeMinutes),
    endTime: formatClockMinutes(endMinutes + afterMinutes),
  };
}
