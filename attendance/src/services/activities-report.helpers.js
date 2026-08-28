/** Pure helpers for attendance new-report activity selection (no Supabase imports). */

export const ONLINE_REPORT_TYPE = 'זום';
export const LEGACY_ONLINE_REPORT_TYPE = 'מקוון';
export const TRAINING_REPORT_TYPE = 'הכשרה';
export const OPERATIONS_REPORT_TYPE = 'תפעול';
export const CANCELLATION_REPORT_TYPE = 'ביטול זמן';

// Operational work is not linked to an activity and is described with free text.
export const NO_ACTIVITY_NAME_REPORT_TYPES = [];
export const OPEN_FIELD_REPORT_TYPES = [OPERATIONS_REPORT_TYPE];

// These report types may refer to any canonical activity type rather than one DB type.
export const UNFILTERED_ACTIVITY_REPORT_TYPES = [
  CANCELLATION_REPORT_TYPE,
  TRAINING_REPORT_TYPE,
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

export const HEBREW_ACTIVITY_TYPES = [
  CANCELLATION_REPORT_TYPE,
  TRAINING_REPORT_TYPE,
  'חדר בריחה',
  ONLINE_REPORT_TYPE,
  'סדנה',
  'סיור',
  'קורס',
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
  if (!normalizedReportType || UNFILTERED_ACTIVITY_REPORT_TYPES.includes(normalizedReportType)) return null;
  if (NO_ACTIVITY_NAME_REPORT_TYPES.includes(normalizedReportType)) return [];
  if (OPEN_FIELD_REPORT_TYPES.includes(normalizedReportType)) return [];
  const db = HEBREW_TO_DB_TYPE[normalizedReportType];
  return db ? [db] : [];
}

export function activityMatchesReportType(activity, reportType) {
  const dbTypes = getDbTypesForReportType(reportType);
  if (dbTypes === null) return true;
  if (!dbTypes.length) return false;
  return dbTypes.includes(normalizeDbActivityType(activity?.activity_type));
}

export function filterActivitiesForReportType(activities = [], reportType = '') {
  const dbTypes = getDbTypesForReportType(reportType);
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
  const name = activity?.activity_name || toHebrewType(activity?.activity_type) || 'פעילות';
  const school = activity?.single_school_name
    || (activity?.school_link_status === 'multiple_schools' ? 'מספר בתי ספר' : '')
    || activity?.school
    || '';
  const authority = activity?.authority_name || activity?.authority || '';
  return [name, school, authority].filter(Boolean).join(' — ');
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

export function instructorActivitySelectOptions(activities = [], { reportType = '' } = {}) {
  const seen = new Set();
  const list = filterActivitiesForReportType(activities, reportType);
  return list
    .map((activity) => {
      const value = String(activity?.row_id || activity?.id || '').trim();
      if (!value) return null;
      return {
        value,
        label: instructorActivityOptionLabel(activity),
        activity,
        searchText: activitySearchHaystack(activity),
      };
    })
    .filter((option) => {
      if (!option || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
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
