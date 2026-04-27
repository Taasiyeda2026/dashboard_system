function text(value) {
  return String(value == null ? '' : value).trim();
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
      activity_no: text(row?.activity_no),
      activity_type: text(row?.activity_type || row?.parent_value),
      parent_value: text(row?.parent_value || row?.activity_type)
    }))
    .filter((row) => row.label)
    .filter((row) => {
      const sig = `${row.label}|${row.activity_no}|${row.parent_value}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
}

export function getActivityTypesByFamily(settings, family) {
  const oneDayTypes = uniqueSorted(settings?.one_day_activity_types || []);
  const programTypes = uniqueSorted(settings?.program_activity_types || []);
  if (family === 'short') return oneDayTypes;
  if (family === 'long') return programTypes;
  return uniqueSorted([...oneDayTypes, ...programTypes]);
}

export function getActivityNamesForType(settings, activityType) {
  const type = text(activityType);
  return getActivityCatalog(settings)
    .filter((row) => {
      const parent = text(row.parent_value || row.activity_type);
      return !type || !parent || parent === type;
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

export function getManagerUsers(settings) {
  const raw = Array.isArray(settings?.dropdown_options?.activities_manager_users)
    ? settings.dropdown_options.activities_manager_users
    : [];
  const names = raw.map((user) => text(user?.name));
  return uniqueSorted(names.length ? names : settings?.dropdown_options?.activity_manager);
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
