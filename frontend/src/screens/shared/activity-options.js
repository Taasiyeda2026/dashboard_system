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
  const clean = text(value).replace(/\u00A0/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
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
  ['חוג אפטרסקול', 'after_school'],
  ['חוג_אפטרסקול', 'after_school'],
  ['חוגי אפטרסקול', 'after_school'],
  ['חוגי_אפטרסקול', 'after_school'],
  ['after_school', 'after_school'],
  ['afterschool', 'after_school']
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

export function humanDisplayText(value) {
  return text(value).replace(/\u00A0/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cleanActivityManagerName(value) {
  const clean = humanDisplayText(value);
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
      label: humanDisplayText(row?.label || row?.activity_name || row?.value),
      label_he: humanDisplayText(row?.label_he || row?.label || row?.activity_name || row?.value),
      value: humanDisplayText(row?.value || row?.activity_name || row?.label),
      activity_name: humanDisplayText(row?.activity_name || row?.value || row?.label),
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
    .map((user) => ({ name: humanDisplayText(user?.name), emp_id: text(user?.emp_id) }))
    .filter((user) => user.name)
    .filter((user) => {
      if (seen.has(user.name)) return false;
      seen.add(user.name);
      return true;
    });
}

function normalizeInstructorLookupName(value) {
  return humanDisplayText(value).toLowerCase();
}

export function buildInstructorNameToEmpMap(rosterUsers = []) {
  const map = new Map();
  const ambiguous = new Set();
  for (const user of rosterUsers) {
    const name = humanDisplayText(user?.name);
    const empId = text(user?.emp_id);
    if (!name) continue;
    const key = normalizeInstructorLookupName(name);
    if (map.has(key)) {
      const prev = map.get(key);
      if (prev !== empId) ambiguous.add(key);
    } else {
      map.set(key, empId);
    }
  }
  return { map, ambiguous };
}

export function resolveEmpIdForInstructorName(name, rosterUsers = []) {
  const cleanName = humanDisplayText(name);
  if (!cleanName) return { emp_id: null, error: null };
  const { map, ambiguous } = buildInstructorNameToEmpMap(rosterUsers);
  const key = normalizeInstructorLookupName(cleanName);
  if (ambiguous.has(key)) return { emp_id: null, error: 'instructor_name_ambiguous' };
  if (!map.has(key)) return { emp_id: null, error: 'instructor_name_not_in_roster' };
  const empId = text(map.get(key));
  if (!empId) return { emp_id: null, error: 'instructor_missing_emp_id' };
  return { emp_id: empId, error: null };
}

export function instructorSyncErrorMessage(error = {}) {
  const messages = {
    instructor_name_ambiguous: 'לא ניתן לשייך מדריך — יש יותר ממדריך אחד עם שם זה',
    instructor_name_not_in_roster: 'יש לבחור מדריך מתוך הרשימה',
    instructor_missing_emp_id: 'למדריך שנבחר אין מספר עובד — פנה למנהל המערכת',
    instructor_emp_mismatch: 'שם המדריך ומספר העובד אינם תואמים'
  };
  return messages[error.code] || 'שגיאה בשיוך המדריך';
}

const INSTRUCTOR_FIELD_PAIRS = [
  { nameKey: 'instructor_name', empKey: 'emp_id' },
  { nameKey: 'instructor_name_2', empKey: 'emp_id_2' }
];

export function syncInstructorEmpFields(changes = {}, rosterUsers = [], { strict = true } = {}) {
  const out = { ...(changes || {}) };
  const errors = [];
  for (const { nameKey, empKey } of INSTRUCTOR_FIELD_PAIRS) {
    if (!Object.prototype.hasOwnProperty.call(changes, nameKey)) continue;
    const nameValue = humanDisplayText(changes[nameKey]);
    if (!nameValue) {
      out[empKey] = null;
      continue;
    }
    const { emp_id, error } = resolveEmpIdForInstructorName(nameValue, rosterUsers);
    if (error && strict) {
      errors.push({ field: nameKey, code: error });
      continue;
    }
    out[empKey] = emp_id;
  }
  return { changes: out, errors };
}

export function buildContactsInstructorLookup(contacts = []) {
  const byName = new Map();
  const byEmpId = new Map();
  for (const contact of contacts) {
    const empId = text(contact?.emp_id || contact?.employee_id || contact?.id);
    const name = humanDisplayText(
      contact?.full_name || contact?.name || contact?.instructor_name || contact?.guide
    );
    if (empId) byEmpId.set(empId, { emp_id: empId, name });
    if (name) byName.set(normalizeInstructorLookupName(name), { emp_id: empId, name });
  }
  return { byName, byEmpId };
}

export function resolveCanonicalInstructorPair(name, empId, lookup = {}) {
  const cleanName = humanDisplayText(name);
  const cleanEmpId = text(empId);
  const byName = lookup?.byName instanceof Map ? lookup.byName : new Map();
  const byEmpId = lookup?.byEmpId instanceof Map ? lookup.byEmpId : new Map();
  if (!cleanName && !cleanEmpId) return null;

  if (cleanName) {
    const fromName = byName.get(normalizeInstructorLookupName(cleanName));
    if (fromName?.emp_id) {
      return { emp_id: fromName.emp_id, name: fromName.name || cleanName };
    }
    if (cleanEmpId) {
      const fromEmp = byEmpId.get(cleanEmpId);
      if (fromEmp?.name && normalizeInstructorLookupName(fromEmp.name) !== normalizeInstructorLookupName(cleanName)) {
        return { emp_id: '', name: cleanName };
      }
      if (fromEmp?.emp_id) {
        return { emp_id: fromEmp.emp_id, name: cleanName };
      }
    }
    return { emp_id: cleanEmpId, name: cleanName };
  }

  const fromEmp = byEmpId.get(cleanEmpId);
  return {
    emp_id: cleanEmpId,
    name: fromEmp?.name || cleanEmpId
  };
}

export function validateActivityInstructorPair(name, empId, lookup = {}) {
  const cleanName = humanDisplayText(name);
  const cleanEmpId = text(empId);
  if (!cleanName && !cleanEmpId) return { valid: true, emp_id: null, name: '' };
  if (!cleanName) return { valid: true, emp_id: cleanEmpId || null, name: '' };

  const byName = lookup?.byName instanceof Map ? lookup.byName : new Map();
  const byEmpId = lookup?.byEmpId instanceof Map ? lookup.byEmpId : new Map();
  const fromName = byName.get(normalizeInstructorLookupName(cleanName));

  if (fromName?.emp_id) {
    const valid = !cleanEmpId || cleanEmpId === fromName.emp_id;
    return {
      valid,
      emp_id: fromName.emp_id,
      name: fromName.name || cleanName,
      error: valid ? null : 'instructor_emp_mismatch'
    };
  }

  if (cleanEmpId) {
    const fromEmp = byEmpId.get(cleanEmpId);
    const valid = !fromEmp?.name || normalizeInstructorLookupName(fromEmp.name) === normalizeInstructorLookupName(cleanName);
    return {
      valid,
      emp_id: valid ? cleanEmpId : null,
      name: cleanName,
      error: valid ? null : 'instructor_emp_mismatch'
    };
  }

  return { valid: true, emp_id: null, name: cleanName, error: null };
}

export function validateActivityInstructors(row = {}, lookup = {}) {
  const pairs = [
    validateActivityInstructorPair(row.instructor_name, row.emp_id, lookup),
    validateActivityInstructorPair(row.instructor_name_2, row.emp_id_2, lookup)
  ];
  const invalid = pairs.filter((pair) => pair.error);
  return {
    valid: !invalid.length,
    errors: invalid.map((pair) => pair.error),
    pairs
  };
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

export const GRADE_OPTIONS = [
  'הכנה לכיתה א׳',
  'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳',
  'ז׳', 'ח׳', 'ט׳', 'י׳', 'י״א', 'י״ב'
];

export function resolveGradeOptions(settings) {
  const map = settings?.dropdown_options || {};
  const fromSettings = [];
  const seen = new Set();
  ['grade', 'grades', 'class'].forEach((k) => {
    const arr = Array.isArray(map[k]) ? map[k] : [];
    arr.forEach((v) => {
      const s = String(v || '').trim();
      if (s && !seen.has(s)) { seen.add(s); fromSettings.push(s); }
    });
  });
  const ordered = [...GRADE_OPTIONS];
  const seenOrdered = new Set(GRADE_OPTIONS);
  fromSettings.forEach((s) => { if (!seenOrdered.has(s)) { ordered.push(s); seenOrdered.add(s); } });
  return ordered;
}
