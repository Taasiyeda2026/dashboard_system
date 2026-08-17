import { looseContactMatchText, normalizeContactMatchText } from './shared/contact-responsible.js';

const txt = (value) => String(value ?? '').trim();

export function normalizePayrollEntityName(value) {
  return normalizeContactMatchText(value);
}

export function normalizePayrollEntityNameLoose(value) {
  return looseContactMatchText(value);
}

export function isZoomAuthorityOrPlace(...values) {
  return values.some((value) => /^(zoom|זום)$/iu.test(normalizePayrollEntityName(value)));
}

function catalogSchoolEntry(lookup, schoolId) {
  if (schoolId == null || !lookup?.byId) return null;
  return lookup.byId.get(String(schoolId)) || lookup.byId.get(Number(schoolId)) || null;
}

function catalogAuthorityEntry(lookup, authorityId) {
  if (authorityId == null || !lookup?.byId) return null;
  return lookup.byId.get(String(authorityId)) || lookup.byId.get(Number(authorityId)) || null;
}

function addNameVariant(set, value) {
  const norm = normalizePayrollEntityName(value);
  const loose = normalizePayrollEntityNameLoose(value);
  if (norm) set.add(norm);
  if (loose) set.add(loose);
}

function activityProgramNames(activity = {}) {
  return [activity.activity_name, activity.program_name, activity.name, activity.catalog_slug]
    .map(txt).filter(Boolean);
}

function normalizeActivityNo(value) {
  const digits = txt(value).replace(/\D/g, '');
  return digits || txt(value);
}

export function buildPayrollIdentityContext({
  schoolLookup = null,
  authorityLookup = null,
  activities = [],
  proposalGroupAliases = [],
  dashboardRows = []
} = {}) {
  const schoolById = new Map();
  const authorityNamesById = new Map();
  const schoolIdByAuthorityName = new Map();
  const schoolIdByAuthorityLooseName = new Map();
  const authorityIdByName = new Map();
  const programNamesByActivityNo = new Map();
  const programGroupKeyByName = new Map();
  const programGroupDisplayNames = new Map();

  (schoolLookup?.list || []).forEach((school) => {
    if (!school?.id) return;
    const names = new Set();
    addNameVariant(names, school.school_name);
    addNameVariant(names, school.city);
    schoolById.set(String(school.id), {
      id: String(school.id),
      authority_id: school.authority_id ? String(school.authority_id) : null,
      school_name: school.school_name || '',
      names
    });
    const authorityId = school.authority_id ? String(school.authority_id) : '';
    names.forEach((name) => {
      if (!name) return;
      const loose = normalizePayrollEntityNameLoose(name);
      if (authorityId) {
        schoolIdByAuthorityName.set(`${authorityId}|${name}`, String(school.id));
        if (loose) schoolIdByAuthorityLooseName.set(`${authorityId}|${loose}`, String(school.id));
      }
    });
  });

  (authorityLookup?.list || []).forEach((authority) => {
    if (!authority?.id) return;
    const names = new Set();
    addNameVariant(names, authority.authority_name);
    addNameVariant(names, authority.long_name);
    addNameVariant(names, authority.authority_code);
    authorityNamesById.set(String(authority.id), names);
    names.forEach((name) => {
      if (name) authorityIdByName.set(name, String(authority.id));
    });
  });

  schoolById.forEach((school) => {
    if (!school.authority_id) return;
    const bucket = authorityNamesById.get(school.authority_id) || new Set();
    school.names.forEach((name) => bucket.add(name));
    authorityNamesById.set(school.authority_id, bucket);
    school.names.forEach((name) => {
      if (name) authorityIdByName.set(name, school.authority_id);
    });
  });

  const registerProgramName = (activityNo, name) => {
    const key = normalizeActivityNo(activityNo);
    if (!key || !name) return;
    if (!programNamesByActivityNo.has(key)) programNamesByActivityNo.set(key, new Set());
    addNameVariant(programNamesByActivityNo.get(key), name);
    const norm = normalizePayrollEntityName(name);
    const loose = normalizePayrollEntityNameLoose(name);
    if (norm) programGroupKeyByName.set(norm, key);
    if (loose) programGroupKeyByName.set(loose, key);
  };

  (activities || []).forEach((activity) => {
    const activityNo = normalizeActivityNo(activity.activity_no || activity.gefen_number);
    activityProgramNames(activity).forEach((name) => registerProgramName(activityNo, name));
  });

  (dashboardRows || []).filter((row) => !row?.__profile).forEach((row) => {
    registerProgramName(row.activityNo, row.program);
    if (row.componentRows?.length) {
      row.componentRows.forEach((component) => registerProgramName(component.activityNo, component.program));
    }
  });

  (proposalGroupAliases || []).forEach((aliasRow) => {
    const alias = txt(aliasRow.alias_name || aliasRow.alias);
    const groupKey = txt(aliasRow.group_key || aliasRow.target_group_key);
    if (!alias || !groupKey) return;
    if (!programGroupDisplayNames.has(groupKey)) programGroupDisplayNames.set(groupKey, new Set());
    addNameVariant(programGroupDisplayNames.get(groupKey), alias);
    const norm = normalizePayrollEntityName(alias);
    const loose = normalizePayrollEntityNameLoose(alias);
    if (norm) programGroupKeyByName.set(norm, groupKey);
    if (loose) programGroupKeyByName.set(loose, groupKey);
  });

  return {
    schoolLookup,
    authorityLookup,
    schoolById,
    authorityNamesById,
    schoolIdByAuthorityName,
    schoolIdByAuthorityLooseName,
    authorityIdByName,
    programNamesByActivityNo,
    programGroupKeyByName,
    programGroupDisplayNames
  };
}

export function extractDashboardIdentity(dashboard) {
  const components = dashboard?.componentRows?.length ? dashboard.componentRows : (dashboard ? [dashboard] : []);
  const schoolIds = [...new Set(components.map((row) => row?.schoolId).filter(Number.isFinite))];
  const authorityIds = [...new Set(components.map((row) => row?.authorityId).filter(Number.isFinite))];
  const activityNos = [...new Set(components.map((row) => normalizeActivityNo(row?.activityNo)).filter(Boolean))];
  return { schoolIds, authorityIds, activityNos, components };
}

function resolveAuthorityIdByName(name, context) {
  const norm = normalizePayrollEntityName(name);
  if (!norm || !context?.authorityIdByName) return null;
  return context.authorityIdByName.get(norm) || null;
}

function resolveSchoolIdByName(name, authorityId, context) {
  if (!context) return null;
  const norm = normalizePayrollEntityName(name);
  const loose = normalizePayrollEntityNameLoose(name);
  if (!norm && !loose) return null;
  if (authorityId) {
    const scoped = context.schoolIdByAuthorityName.get(`${authorityId}|${norm}`)
      || (loose ? context.schoolIdByAuthorityLooseName.get(`${authorityId}|${loose}`) : null);
    if (scoped) return scoped;
  }
  return null;
}

function attendanceSchoolNameVariants(name) {
  const variants = new Set();
  const norm = normalizePayrollEntityName(name);
  const loose = normalizePayrollEntityNameLoose(name);
  if (norm) variants.add(norm);
  if (loose) variants.add(loose);
  const stripped = norm
    .replace(/\s+(ה)?יסודי$/u, '')
    .replace(/\s+היסודי$/u, '')
    .replace(/\s+ע"ש\s+.+$/u, '')
    .trim();
  if (stripped) {
    variants.add(stripped);
    variants.add(normalizePayrollEntityNameLoose(stripped));
  }
  return variants;
}

function nameMatchesSchoolEntry(name, schoolEntry) {
  if (!schoolEntry?.names?.size) return false;
  for (const variant of attendanceSchoolNameVariants(name)) {
    if (schoolEntry.names.has(variant)) return true;
    if (!variant || variant.length < 3) continue;
    for (const schoolVariant of schoolEntry.names) {
      if (!schoolVariant || schoolVariant.length < 3) continue;
      if (schoolVariant.endsWith(variant) || variant.endsWith(schoolVariant)) return true;
    }
  }
  return false;
}

function nameMatchesAuthorityId(name, authorityId, context) {
  const names = context?.authorityNamesById?.get(String(authorityId));
  if (!names?.size) return false;
  const norm = normalizePayrollEntityName(name);
  const loose = normalizePayrollEntityNameLoose(name);
  return (norm && names.has(norm)) || (loose && names.has(loose));
}

function namesEquivalentStrict(left, right) {
  const normLeft = normalizePayrollEntityName(left);
  const normRight = normalizePayrollEntityName(right);
  return Boolean(normLeft && normRight && normLeft === normRight);
}

function namesEquivalentLoose(left, right) {
  const looseLeft = normalizePayrollEntityNameLoose(left);
  const looseRight = normalizePayrollEntityNameLoose(right);
  return Boolean(looseLeft && looseRight && looseLeft === looseRight);
}

function preferredAuthorityId(dashboard, context) {
  const { schoolIds, authorityIds } = extractDashboardIdentity(dashboard);
  if (authorityIds.length === 1) return String(authorityIds[0]);
  if (schoolIds.length === 1) {
    const school = context?.schoolById?.get(String(schoolIds[0]));
    if (school?.authority_id) return String(school.authority_id);
  }
  return null;
}

export function schoolsEquivalent(attendance, dashboard, context) {
  const { schoolIds } = extractDashboardIdentity(dashboard);
  if (schoolIds.length === 1) {
    const schoolId = schoolIds[0];
    if (nameMatchesSchoolEntry(attendance?.school, context?.schoolById?.get(String(schoolId)))) return true;
    const authorityId = context?.schoolById?.get(String(schoolId))?.authority_id || preferredAuthorityId(dashboard, context);
    const attendanceSchoolId = resolveSchoolIdByName(attendance?.school, authorityId, context);
    if (attendanceSchoolId && String(attendanceSchoolId) === String(schoolId)) return true;
  }
  if (Number.isFinite(attendance?.schoolId) && schoolIds.length === 1 && Number(attendance.schoolId) === Number(schoolIds[0])) {
    return true;
  }
  const authorityId = preferredAuthorityId(dashboard, context);
  if (authorityId) {
    const leftId = resolveSchoolIdByName(attendance?.school, authorityId, context);
    const rightId = resolveSchoolIdByName(dashboard?.school, authorityId, context);
    if (leftId && rightId && leftId === rightId) return true;
  }
  return namesEquivalentStrict(attendance?.school, dashboard?.school)
    || namesEquivalentLoose(attendance?.school, dashboard?.school);
}

export function authoritiesEquivalent(attendance, dashboard, context) {
  if (isZoomAuthorityOrPlace(attendance?.authority, attendance?.school, dashboard?.school, dashboard?.program)) {
    return true;
  }
  const authorityId = preferredAuthorityId(dashboard, context);
  const { schoolIds } = extractDashboardIdentity(dashboard);
  if (schoolIds.length === 1 && schoolsEquivalent(attendance, dashboard, context)) {
    return true;
  }
  if (authorityId) {
    if (nameMatchesAuthorityId(attendance?.authority, authorityId, context)) return true;
    const attendanceAuthorityId = resolveAuthorityIdByName(attendance?.authority, context);
    if (attendanceAuthorityId && attendanceAuthorityId === authorityId) return true;
  }
  const leftId = resolveAuthorityIdByName(attendance?.authority, context);
  const rightId = resolveAuthorityIdByName(dashboard?.authority, context) || authorityId;
  if (leftId && rightId && leftId === rightId) return true;
  return namesEquivalentStrict(attendance?.authority, dashboard?.authority)
    || namesEquivalentLoose(attendance?.authority, dashboard?.authority);
}

function resolveProgramGroupKey(name, context) {
  const norm = normalizePayrollEntityName(name);
  const loose = normalizePayrollEntityNameLoose(name);
  return (norm && context?.programGroupKeyByName?.get(norm))
    || (loose && context?.programGroupKeyByName?.get(loose))
    || null;
}

function programNameMatchesActivityNo(name, activityNo, context) {
  const key = normalizeActivityNo(activityNo);
  const names = context?.programNamesByActivityNo?.get(key);
  if (!names?.size) return false;
  const norm = normalizePayrollEntityName(name);
  const loose = normalizePayrollEntityNameLoose(name);
  return (norm && names.has(norm)) || (loose && names.has(loose));
}

function isStemCategoryName(name) {
  const norm = normalizePayrollEntityName(name).replace(/\s+/g, ' ').trim();
  return norm === 'סדנאות stem' || norm === 'סדנה stem';
}

function isTamirCategoryName(name) {
  return normalizePayrollEntityName(name) === 'תמיר';
}

function programNamesSameActivityFamily(left, right) {
  const compact = (value) => normalizePayrollEntityName(value).replace(/\s+/g, '');
  const trimVariant = (value) => compact(value).replace(/(ות|ים|ה)$/u, '');
  const leftStem = trimVariant(left);
  const rightStem = trimVariant(right);
  return Boolean(leftStem && rightStem && leftStem === rightStem && leftStem.length >= 8);
}

export function programsEquivalent(attendance, dashboard, context, { matchUnambiguous = false } = {}) {
  const { activityNos } = extractDashboardIdentity(dashboard);
  if (activityNos.length === 1) {
    const activityNo = activityNos[0];
    const attendanceActivityNo = resolveProgramGroupKey(attendance?.program, context);
    if (attendanceActivityNo && normalizeActivityNo(attendanceActivityNo) === activityNo) return true;
    if (programNameMatchesActivityNo(attendance?.program, activityNo, context)) return true;
    if (programNamesSameActivityFamily(attendance?.program, dashboard?.program)) return true;
  }
  const attendanceGroup = resolveProgramGroupKey(attendance?.program, context);
  const dashboardGroup = resolveProgramGroupKey(dashboard?.program, context);
  if (attendanceGroup && dashboardGroup && attendanceGroup === dashboardGroup) return true;
  if (matchUnambiguous) {
    if (isStemCategoryName(attendance?.program)) return true;
    if (isTamirCategoryName(attendance?.program) && normalizePayrollEntityName(dashboard?.program).startsWith('תמיר')) return true;
  }
  return namesEquivalentStrict(attendance?.program, dashboard?.program)
    || namesEquivalentLoose(attendance?.program, dashboard?.program);
}

export function payrollEntityFieldsEquivalent(key, attendance, dashboard, context, options = {}) {
  if (key === 'school') return schoolsEquivalent(attendance, dashboard, context);
  if (key === 'authority') return authoritiesEquivalent(attendance, dashboard, context);
  if (key === 'program') return programsEquivalent(attendance, dashboard, context, options);
  return false;
}

export function payrollBundleHasContext(attendance, dashboard, context, key) {
  if (key === 'school') return schoolsEquivalent(attendance, dashboard, context);
  if (key === 'authority') return authoritiesEquivalent(attendance, dashboard, context);
  if (key === 'program') return programsEquivalent(attendance, dashboard, context);
  return false;
}

export function resolveSchoolIdForAuthority(name, authorityId, context) {
  return resolveSchoolIdByName(name, authorityId, context);
}
