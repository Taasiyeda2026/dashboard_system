import { dsPageHeader, dsScreenStack } from '../shared/layout.js';
import { courseScheduleSummaryHtml, courseScheduleTableHtml, bindCourseScheduleDateToggles } from '../shared/instructor-course-schedule-view.js';
import { instructorScheduleRows, loadInstructorActivities } from './portal-data.js';

const expandedDates = {};
export const instructorWorkScheduleScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = instructorScheduleRows(data?.rows, state);
    return dsScreenStack(`<section class="instructor-area instructor-area--table ds-ops-mgmt-screen"><div class="ds-ops-mgmt-panel" dir="rtl">${dsPageHeader('סידור עבודה', 'סידור הקורסים שלך')}${courseScheduleSummaryHtml(rows)}<div class="ds-ops-schedule-wrap"><section class="ds-card"><div class="ds-card__body">${courseScheduleTableHtml(rows, { expandedDates })}</div></section></div></div></section>`);
  },
  bind({ root, rerender }) { bindCourseScheduleDateToggles(root, expandedDates, rerender); }
};
