/** Display-only projection. Never use this snapshot as an engine/checkpoint input. */
export function compactPlanningRow(row = {}) {
  if (!row || typeof row !== 'object') return row;
  if (row._detailsDeferred && Array.isArray(row.dependencyInstructorIds) && Array.isArray(row.dependencySlots)) return row;
  const options = Array.isArray(row.options) ? row.options : [];
  const selected = options.find(option => String(option?.instructorEmpId || '') === String(row.instructorEmpId || '')
    && String(option?.startDate || '') === String(row.startDate || '')
    && String(option?.startTime || '') === String(row.startTime || ''));
  const retained = options.length ? [options[0]] : [];
  if (selected && selected !== options[0]) retained.push(selected);
  const dependencyInstructorIds = new Set(row.dependencyInstructorIds || []);
  const slots = new Map((row.dependencySlots || []).map(slot => [JSON.stringify(slot), slot]));
  for (const option of [...options, ...(row.packingOptions || [])]) {
    if (option.instructorEmpId) dependencyInstructorIds.add(String(option.instructorEmpId));
    for (const meeting of option.meetings || []) {
      if (meeting.substituteEmpId) dependencyInstructorIds.add(String(meeting.substituteEmpId));
      const slot = { date: meeting.date, start_time: meeting.start_time, end_time: meeting.end_time };
      slots.set(JSON.stringify(slot), slot);
    }
  }
  return { ...row, options: retained, scheduleOptions: [], packingOptions: [],
    dependencyInstructorIds: [...dependencyInstructorIds], dependencySlots: [...slots.values()],
    optionCount: row.optionCount ?? options.length,
    scheduleOptionCount: row.scheduleOptionCount ?? (row.scheduleOptions || []).length,
    _detailsDeferred: true };
}
export function compactPlanningWorkspace(shared) {
  if (!shared) return shared;
  return { ...shared, displayOnly: true, rows: (shared.rows || []).filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)).map(entry => ({ ...entry, row: compactPlanningRow(entry.row) })) };
}
export const COURSE_LIST_PAGE_SIZE = 25;
export function courseListWindow(rows, page = 0, size = COURSE_LIST_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const index = Math.max(0, Math.min(pages - 1, Math.trunc(Number(page) || 0)));
  return { rows: rows.slice(index * size, (index + 1) * size), page: index, pages, total: rows.length };
}
