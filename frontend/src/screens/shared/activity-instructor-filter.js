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

function planningHasRelevantProposal(planningRow = null) {
  if (!planningRow) return false;
  const kind = text(planningRow.kind);
  if (!['proposal', 'fixed-proposal', 'recruitment'].includes(kind)) return false;
  return !!(text(planningRow.instructorEmpId) || text(planningRow.instructorName) || text(planningRow.startDate));
}

/** Compact scheduling status for the activity drawer (UX only — no engine). */
export function activitySchedulingStatusSummary(row = {}, planningRow = null) {
  const assignment = activityInstructorAssignmentState(row);
  const assignedName = text(row.instructor_name || row.instructor || row.emp_id);
  const draftName = text(row.draft_instructor_name || row.draft_emp_id);
  const startDate = text(row.start_date || row.date_1);
  const startTime = text(row.start_time);
  const endTime = text(row.end_time);
  const scheduleParts = [];
  if (startDate) scheduleParts.push(startDate);
  if (startTime && endTime) scheduleParts.push(`${startTime}–${endTime}`);
  else if (startTime) scheduleParts.push(startTime);

  let statusLabel = 'טרם שובץ';
  if (assignment === 'assigned') {
    statusLabel = assignedName ? `משובץ · ${assignedName}` : 'משובץ';
  } else if (assignment === 'draft') {
    statusLabel = draftName ? `ממתין לאישור · ${draftName}` : 'ממתין לאישור';
  }

  const hasProposal = assignment === 'unassigned' && planningHasRelevantProposal(planningRow);
  return {
    assignment,
    statusLabel,
    scheduleLabel: scheduleParts.join(' · '),
    hasProposal,
    proposalLabel: hasProposal ? 'קיימת הצעה' : ''
  };
}
