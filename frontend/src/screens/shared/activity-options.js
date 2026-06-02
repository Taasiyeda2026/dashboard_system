const UNASSIGNED_INSTRUCTOR_LABELS = new Set([
  '-',
  '—',
  'לא שובץ',
  'לא משובץ',
  'טרם שובץ',
  'לא נקבע',
  'אין',
  'none',
  'null',
  'undefined',
  'n/a',
  'unassigned'
]);

export function cleanInstructorName(value) {
  const clean = text(value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (UNASSIGNED_INSTRUCTOR_LABELS.has(clean.toLowerCase())) return '';
  return clean;
}

const INSTRUCTOR_NAME_FIELDS = [
  'instructor_name',
  'instructorName',
  'guide_name',
  'guideName',
  'teacher_name',
  'teacherName',
  'facilitator_name',
  'facilitatorName',
  'instructor',
  'guide',
  'teacher',
  'facilitator',
  'Instructor',
  'Guide',
  'Teacher',
  'Facilitator',
  'שם מדריך',
  'מדריך'
];

export function resolveActivityInstructorName(row = {}, { secondary = false } = {}) {
  if (!row || typeof row !== 'object') return '';
  const numberedFields = secondary
    ? [
        'instructor_name_2',
        'instructorName2',
        'guide_name_2',
        'guideName2',
        'teacher_name_2',
        'teacherName2',
        'facilitator_name_2',
        'facilitatorName2',
        'instructor2',
        'guide2',
        'teacher2',
        'facilitator2',
        'Instructor2',
        'Guide2',
        'Teacher2',
        'Facilitator2'
      ]
    : INSTRUCTOR_NAME_FIELDS;
  for (const field of numberedFields) {
    const clean = cleanInstructorName(row[field]);
    if (clean) return clean;
  }
  return '';
}

export const NO_ACTIVITY_MANAGER_LABEL = 'ללא';

export const ONE_DAY_ACTIVITY_TYPE_LABELS = {
  workshop: 'סדנה',
  tour: 'סיור',
  escape_room: 'חדר בריחה'
};

const ONE_DAY_ACTIVITY_TYPE_KEYS = new Set(Object.keys(ONE_DAY_ACTIVITY_TYPE_LABELS));

const ACTIVITY_TYPE_ALIASES = new Map([
  ['סדנה', 'workshop'],
  ['סדנאות', 'workshop'],
  ['workshop', 'workshop'],
  ['workshops', 'workshop'],
  ['חדר בריחה', 'escape_room'],
  ['חדר_בריחה', 'escape_room'],
  ['חדרי בריחה', 'escape_room'],
  ['חדרי_בריחה', 'escape_room'],
  ['escape_room', 'escape_room'],
  ['escaperoom', 'escape_room'],
  ['סיור', 'tour'],
  ['סיורים', 'tour'],
  ['tour', 'tour'],
  ['tours', 'tour'],
  ['קורס', 'course'],
  ['קורסים', 'course'],
  ['course', 'course'],
  ['courses', 'course'],
  ['אפטרסקול', 'after_school'],
  ['after_school', 'after_school'],
  ['afterschool', 'after_school']
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

export function cleanActivityManagerName(value) {
  const clean = text(value);
  const upper = clean.toUpperCase();
  if (!clean || clean === 'ללא' || clean === 'ללא מנהל' || upper === 'NULL' || upper === 'UNDEFINED' || upper === 'NONE' || upper === 'N/A' || upper === 'UNASSIGNED' || clean === '-') return '';
  return clean;
}

export function activityManagerDisplayName(value) {
  return cleanActivityManagerName(value) || NO_ACTIVITY_MANAGER_LABEL;
}

export function normalizeActivityTypeKey(value) {
  const clean = text(value).replace(/[\u2010-\u2015]/g, '_').replace(/[-\s]+/g, '_').toLowerCase();
  if (!clean) return '';
  return ACTIVITY_TYPE_ALIASES.get(clean) || clean;
}

export function normalizeOneDayActivityType(value) {
  const normalized = normalizeActivityTypeKey(value);
  return ONE_DAY_ACTIVITY_TYPE_KEYS.has(normalized) ? normalized : '';
}

export function isOneDayActivityType(value) {
  return Boolean(normalizeOneDayActivityType(value));
}

export function activityTypeDisplayLabel(value) {
  const oneDay = normalizeOneDayActivityType(value);
  if (oneDay) return ONE_DAY_ACTIVITY_TYPE_LABELS[oneDay];
  const normalized = normalizeActivityTypeKey(value);
  if (normalized === 'course') return 'קורס';
  if (normalized === 'after_school') return 'חוג אפטרסקול';
  return text(value);
}

export function activityTypeMatches(value, expected) {
  const left = normalizeActivityTypeKey(value);
  const right = normalizeActivityTypeKey(expected);
  if (!right) return true;
  return Boolean(left) && left === right;
}

function isExplicitlyInactive(value) {
  if (value === false || value === 0) return true;
  const clean = text(value).toLowerCase();
  return ['false', '0', 'no', 'n', 'inactive', 'לא', 'לא פעיל', 'כבוי'].includes(clean);
}

function isActiveManagerItem(item) {
  const row = item?._row && typeof item._row === 'object' ? item._row : item;
  if (!row || typeof row !== 'object') return true;
  if ('is_active' in row) return !isExplicitlyInactive(row.is_active);
  if ('active' in row) return !isExplicitlyInactive(row.active);
  return true;
}

function uniqueSorted(values) {
  const set = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const clean = text(value);
    if (!clean) return;
    if (clean === 'שם מלא') return;
    set.add(clean);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
}

export function getActivityCatalog(settings) {
  const rows = Array.isArray(settings?.dropdown_options?.activity_names)
    ? settings.dropdown_options.activity_names
    : [];
  const seen = new Set();
  return rows
    .map((row) => ({
      label: text(row?.label || row?.activity_name || row?.value),
      label_he: text(row?.label_he || row?.label || row?.activity_name || row?.value),
      value: text(row?.value || row?.activity_name || row?.label),
      activity_name: text(row?.activity_name || row?.value || row?.label),
      activity_no: text(row?.activity_no),
      activity_type: normalizeActivityTypeKey(row?.activity_type || row?.parent_value || row?.type),
      parent_value: normalizeActivityTypeKey(row?.parent_value || row?.activity_type || row?.type),
      type: normalizeActivityTypeKey(row?.type || row?.activity_type || row?.parent_value),
      active: row?.active,
      sort_order: row?.sort_order
    }))
    .filter((row) => row.label)
    .filter((row) => {
      const sig = `${row.label}|${row.activity_no}|${row.parent_value}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
}

export function getActivityTypes(settings) {
  const catalog = getActivityCatalog(settings);
  const fromCatalog = cleanUnique(
    catalog
      .map((item) => normalizeActivityTypeKey(item.activity_type || item.parent_value || item.type))
      .filter(Boolean)
  );
  if (fromCatalog.length) return fromCatalog;
  return getActivityTypesByFamily(settings);
}

export function getActivityTypesByFamily(settings, family) {
  const oneDayTypes = uniqueSorted((settings?.one_day_activity_types || []).map(normalizeActivityTypeKey));
  const programTypes = uniqueSorted((settings?.program_activity_types || []).map(normalizeActivityTypeKey));
  if (family === 'short') return oneDayTypes;
  if (family === 'long') return programTypes;
  return uniqueSorted([...oneDayTypes, ...programTypes]);
}

export function getActivityNamesForType(settings, activityType) {
  const type = normalizeActivityTypeKey(activityType);
  return getActivityCatalog(settings)
    .filter((row) => {
      const parent = row.activity_type || row.parent_value || row.type;
      return !type || activityTypeMatches(parent, type);
    });
}

export function getRosterUsers(settings) {
  const raw = Array.isArray(settings?.dropdown_options?.instructor_users)
    ? settings.dropdown_options.instructor_users
    : [];
  const seen = new Set();
  return raw
    .map((user) => ({ name: text(user?.name), emp_id: text(user?.emp_id) }))
    .filter((user) => user.name)
    .filter((user) => {
      if (seen.has(user.name)) return false;
      seen.add(user.name);
      return true;
    });
}

export function getManagerUsers(settings, { activeOnly = true } = {}) {
  const raw = Array.isArray(settings?.dropdown_options?.activities_manager_users)
    ? settings.dropdown_options.activities_manager_users
    : [];
  const managerRows = activeOnly ? raw.filter(isActiveManagerItem) : raw;
  const names = managerRows.map((user) => cleanActivityManagerName(user?.name));
  return uniqueSorted(raw.length ? names : settings?.dropdown_options?.activity_manager);
}

export function getFilterOptionOverrides(settings) {
  return {
    activity_name: uniqueSorted(getActivityCatalog(settings).map((item) => item.label)),
    instructor: uniqueSorted(getRosterUsers(settings).map((item) => item.name)),
    activity_manager: getManagerUsers(settings)
  };
}

export function cleanUnique(values) {
  return uniqueSorted(values);
}
