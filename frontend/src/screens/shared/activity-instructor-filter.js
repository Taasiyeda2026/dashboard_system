export function activityMatchesInstructorStatusFilter(row = {}, filterValue = 'all') {
  if (String(filterValue || '').trim() !== 'unassigned') return true;
  return !String(row.emp_id || '').trim() && !String(row.instructor_name || '').trim();
}
