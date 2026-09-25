const text = (value) => String(value ?? '').trim();

export function activityInstructorAssignmentState(row = {}) {
  const assigned = [
    row?.emp_id,
    row?.instructor_name,
    row?.emp_id_2,
    row?.instructor_name_2
  ].some((value) => !!text(value));
  if (assigned) return 'assigned';

  const draft = [row?.draft_emp_id, row?.draft_instructor_name]
    .some((value) => !!text(value));
  if (draft) return 'draft';

  return 'unassigned';
}

export function activityMatchesInstructorStatusFilter(row = {}, filterValue = 'all') {
  const filter = text(filterValue) || 'all';
  if (!['unassigned', 'draft', 'assigned'].includes(filter)) return true;
  return activityInstructorAssignmentState(row) === filter;
}
