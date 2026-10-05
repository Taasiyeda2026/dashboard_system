import { activityWorkDrawerHtml } from '../shared/activity-detail-html.js';
import { escapeHtml } from '../shared/html.js';
import { currentInstructorIds, currentInstructorName } from '../instructor-utils.js';

export function instructorActivityId(row) {
  return String(row?.RowID || row?.row_id || row?.id || '');
}

export function instructorActivityName(row) {
  return String(row?.activity_name || row?.activity || 'פעילות').trim();
}

function substitutionEyebrow(row = {}) {
  if (row?.substitution_only || row?.has_single_meeting_substitution) {
    const dates = (Array.isArray(row?.resolved_meetings) ? row.resolved_meetings : [])
      .filter((meeting) => meeting?.is_single_meeting_substitution)
      .map((meeting) => String(meeting.meeting_date || meeting.date || '').slice(0, 10))
      .filter(Boolean);
    if (dates.length === 1) return `החלפה חד־פעמית · ${dates[0]}`;
    if (dates.length) return `החלפה חד־פעמית · ${dates.length} מפגשים`;
    return 'החלפה חד־פעמית';
  }
  return 'פרטי הפעילות שלי';
}

export function openInstructorActivityDrawer({ row, state, ui } = {}) {
  if (!row) return;
  ui?.openDrawer({
    title: instructorActivityName(row),
    content: `<div class="instructor-activity-drawer-shell"><p class="instructor-activity-drawer-shell__eyebrow">${escapeHtml(substitutionEyebrow(row))}</p>${activityWorkDrawerHtml(row, {
      settings: state?.clientSettings || {},
      instructorLimited: true,
      currentInstructorIds: currentInstructorIds(state),
      currentInstructorName: currentInstructorName(state),
      canEdit: false,
      canDirectEdit: false,
      canRequestEdit: false,
      canDeleteActivity: false,
      canSchedule: false,
      exportAction: false
    })}</div>`
  });
}
