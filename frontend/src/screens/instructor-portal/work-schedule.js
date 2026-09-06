import { escapeHtml } from '../shared/html.js';
import { formatDateHeWithWeekday } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsTableWrap, dsEmptyState } from '../shared/layout.js';
import { formatCourseScheduleRangeShort } from '../shared/instructor-course-schedule-2027.js';
import { instructorScheduleRows, loadInstructorActivities } from './portal-data.js';

export const instructorWorkScheduleScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = instructorScheduleRows(data?.rows, state);
    const body = rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.authority)}</td><td>${escapeHtml(row.school)}</td><td>${escapeHtml(row.grade || '—')}</td><td>${escapeHtml(row.weekday || 'משתנה')}</td><td>${escapeHtml(row.timeRange || '—')}</td><td>${escapeHtml(String(row.sessionsCount))}</td><td>${escapeHtml(formatCourseScheduleRangeShort(row.startDate, row.endDate))}</td><td>${escapeHtml(row.contactName || '—')}<br><span dir="ltr">${escapeHtml(row.contactPhone || '')}</span></td></tr>`).join('');
    const table = rows.length ? dsTableWrap(`<table class="ds-table"><thead><tr><th>פעילות</th><th>רשות</th><th>בית ספר</th><th>שכבה</th><th>יום</th><th>שעות</th><th>מפגשים</th><th>תקופה</th><th>איש קשר</th></tr></thead><tbody>${body}</tbody></table>`) : dsEmptyState('אין קורסים מוכנים בסידור העבודה');
    return dsScreenStack(`<section class="instructor-area instructor-area--table">${dsPageHeader('סידור עבודה', 'הסידור הקיים, מסונן לשיבוצים שלך בלבד')}${dsCard({ title: 'הקורסים שלי', badge: String(rows.length), body: table, padded: !rows.length })}</section>`);
  }
};
