const ACTIVE_SCHEDULING_VALUES = new Set(['yes', 'true', '1']);

export function isActiveSchedulingInstructor(row = {}) {
  return ACTIVE_SCHEDULING_VALUES.has(String(row?.active ?? '').trim().toLowerCase());
}

export function activeSchedulingInstructors(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isActiveSchedulingInstructor);
}
