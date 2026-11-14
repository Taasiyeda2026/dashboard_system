const ACTIVE_SCHEDULING_VALUES = new Set(['yes', 'true', '1']);

export function isActiveSchedulingInstructor(row = {}) {
  return ACTIVE_SCHEDULING_VALUES.has(String(row?.active ?? '').trim().toLowerCase());
}

export function activeSchedulingInstructors(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isActiveSchedulingInstructor);
}

const MANAGEMENT_ROLES = new Set(['admin','operation_manager','activities_manager',
  'domain_manager','business_development_manager','instructor_manager']);

/** Managers are a manual picker option, never members of the automatic candidate pool. */
export function manualCourseInstructorOptions(instructorContacts = [], managementUsers = []) {
  const entries = new Map((Array.isArray(instructorContacts) ? instructorContacts : [])
    .filter(row => String(row?.emp_id ?? '').trim())
    .map(row => [String(row.emp_id), { ...row }]));
  for (const user of (Array.isArray(managementUsers) ? managementUsers : [])) {
    const id = String(user?.emp_id ?? '').trim();
    const name = String(user?.full_name ?? '').trim();
    if (!/^\d+$/.test(id) || !name || !MANAGEMENT_ROLES.has(String(user.role)) || user.is_active !== true) continue;
    entries.set(id, { ...(entries.get(id) || {}), emp_id: Number(id), full_name: name,
      active: 'yes', isManagementEmployee: true, managementRole: user.role });
  }
  return [...entries.values()].sort((a,b) => String(a.full_name).localeCompare(String(b.full_name), 'he'));
}
