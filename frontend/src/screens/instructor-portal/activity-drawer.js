import { activityWorkDrawerHtml } from '../shared/activity-detail-html.js';
import { currentInstructorIds, currentInstructorName } from '../instructor-utils.js';

export function instructorActivityId(row) {
  return String(row?.RowID || row?.row_id || row?.id || '');
}

export function instructorActivityName(row) {
  return String(row?.activity_name || row?.activity || 'פעילות').trim();
}

export function openInstructorActivityDrawer({ row, state, ui } = {}) {
  if (!row) return;
  ui?.openDrawer({
    title: instructorActivityName(row),
    content: `<div class="instructor-activity-drawer-shell"><p class="instructor-activity-drawer-shell__eyebrow">פרטי הפעילות שלי</p>${activityWorkDrawerHtml(row, {
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
