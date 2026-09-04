function text(value) {
  return String(value ?? '').trim();
}

export function schoolsForAuthority(schoolRecords = [], authorityId = '') {
  const wanted = text(authorityId);
  if (!wanted) return [];
  return (Array.isArray(schoolRecords) ? schoolRecords : []).filter(
    (school) => text(school?.authority_id) === wanted,
  );
}

export function schoolBelongsToAuthority(schoolRecords = [], schoolId = '', authorityId = '') {
  const wantedSchool = text(schoolId);
  const wantedAuthority = text(authorityId);
  if (!wantedSchool || !wantedAuthority) return false;
  return schoolsForAuthority(schoolRecords, wantedAuthority).some(
    (school) => text(school?.school_id ?? school?.id) === wantedSchool,
  );
}

export function resolveAuthorityRecord(authorityRecords = [], value = '') {
  const wanted = text(value);
  return (Array.isArray(authorityRecords) ? authorityRecords : []).find(
    (record) => text(record?.id) === wanted || text(record?.name ?? record?.value) === wanted,
  ) || null;
}

export function resolveSchoolRecord(schoolRecords = [], value = '', authorityId = '') {
  const wanted = text(value);
  return schoolsForAuthority(schoolRecords, authorityId).find(
    (record) => text(record?.school_id ?? record?.id) === wanted || text(record?.name ?? record?.value) === wanted,
  ) || null;
}

export function deriveActivityMeetingRange(values = []) {
  const dates = (Array.isArray(values) ? values : [])
    .map((value) => text(value).slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return { startDate: dates[0] || null, endDate: dates.at(-1) || null };
}

export function isTamirWorkshop(activity = {}, catalog = []) {
  const type = text(activity.activity_type || activity.item_type).toLowerCase();
  if (!(type === 'workshop' || type === 'סדנה')) return false;
  const identities = [activity.activity_no, activity.gefen_number, activity.catalog_slug]
    .map(text).filter(Boolean);
  const catalogRow = (Array.isArray(catalog) ? catalog : []).find((row) => {
    const rowIdentities = [row?.activity_no, row?.gefen_number, row?.catalog_slug].map(text).filter(Boolean);
    return identities.some((identity) => rowIdentities.includes(identity));
  });
  const canonicalName = text(catalogRow?.activity_name || catalogRow?.label || catalogRow?.name);
  return Boolean(catalogRow && canonicalName.includes('תמיר'));
}

export function activityAllowsSecondInstructor(activity = {}, catalog = []) {
  return isTamirWorkshop(activity, catalog);
}
