import { dsPageHeader, dsScreenStack } from '../shared/layout.js';
import { courseScheduleTableHtml, bindCourseScheduleDateToggles } from '../shared/instructor-course-schedule-view.js';
import { instructorScheduleRows, loadInstructorActivities } from './portal-data.js';
import { openCourseSchedulePrintWindow } from '../shared/instructor-course-schedule-print.js';
import { currentInstructorName } from '../instructor-utils.js';

const expandedDates = {};
export const instructorWorkScheduleScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = instructorScheduleRows(data?.rows, state);
    return dsScreenStack(`<section class="instructor-area instructor-area--table ds-ops-mgmt-screen"><div class="ds-ops-mgmt-panel" dir="rtl">${dsPageHeader('סידור עבודה')}<div class="ds-ops-mgmt-panel__toolbar no-print"><button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-instructor-schedule-print>הדפס סידור עבודה</button></div><div class="ds-ops-schedule-wrap"><section class="ds-card"><div class="ds-card__body">${courseScheduleTableHtml(rows, { expandedDates, showInstructorColumn: false })}</div></section></div></div></section>`);
  },
  bind({ root, data, state, rerender }) {
    bindCourseScheduleDateToggles(root, expandedDates, rerender);
    root.querySelector('[data-instructor-schedule-print]')?.addEventListener('click', () => {
      const rows = instructorScheduleRows(data?.rows, state);
      if (!rows.length) { alert('לא נמצאו פעילויות להדפסה.'); return; }
      if (!openCourseSchedulePrintWindow({ instructorName: currentInstructorName(state), rows })) alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.');
    });
  }
};
