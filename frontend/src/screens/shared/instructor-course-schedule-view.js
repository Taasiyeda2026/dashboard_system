import { escapeHtml } from './html.js';
import { dsTableWrap, dsEmptyState } from './layout.js';
import { formatDateHeWithWeekday } from './format-date.js';
import { formatCourseScheduleRangeShort } from './instructor-course-schedule-2027.js';

function datesListHtml(dates = []) {
  return `<ul class="ds-ops-course-dates-list">${dates.map((date) => `<li>${escapeHtml(formatDateHeWithWeekday(date))}</li>`).join('')}</ul>`;
}

export function courseScheduleSummaryHtml(rows = []) {
  const unique = (values) => new Set(values.filter(Boolean)).size;
  const text = [
    `${rows.length} קורסים`,
    `${rows.reduce((sum, row) => sum + row.dates.length, 0)} מפגשים`,
    `${unique(rows.map((row) => row.school))} בתי ספר`,
    `${unique(rows.map((row) => row.authority))} רשויות`
  ].join(' · ');
  return `<div class="ds-ops-mgmt-summary-line" dir="rtl">${escapeHtml(text)}</div>`;
}

export function courseScheduleTableHtml(rows = [], { expandedDates = {} } = {}) {
  const tableRows = rows.map((row) => {
    const isExpanded = Boolean(expandedDates[row.key]);
    const instructorLabel = row.instructorNames.join(', ');
    const datesToggleLabel = row.dates.length === 1 ? 'תאריך אחד' : `${row.dates.length} תאריכים`;
    return `<tr>
      <td class="ds-ops-course-col--name" title="${escapeHtml(row.name)}"><strong>${escapeHtml(row.name)}</strong></td>
      <td class="ds-ops-course-col--authority" title="${escapeHtml(row.authority)}">${escapeHtml(row.authority)}</td>
      <td class="ds-ops-course-col--school" title="${escapeHtml(row.school)}">${escapeHtml(row.school)}</td>
      <td class="ds-ops-course-col--instructor" title="${escapeHtml(instructorLabel)}">${escapeHtml(instructorLabel)}</td>
      <td class="ds-ops-course-col--weekday">${row.weekday ? escapeHtml(row.weekday) : '<span class="ds-ops-mgmt-cell-muted">—</span>'}</td>
      <td class="ds-ops-course-col--time">${escapeHtml(row.timeRange || '—')}</td>
      <td class="ds-ops-course-col--period">${escapeHtml(formatCourseScheduleRangeShort(row.startDate, row.endDate) || '—')}</td>
      <td class="ds-ops-course-col--grade">${row.grade ? escapeHtml(row.grade) : '<span class="ds-ops-mgmt-cell-muted">—</span>'}</td>
      <td class="ds-ops-course-col--sessions">${row.sessionsCount}</td>
      <td class="ds-ops-course-col--dates"><button type="button" class="ds-ops-course-dates-toggle no-print" data-ops-course-dates-toggle="${escapeHtml(row.key)}" aria-expanded="${isExpanded ? 'true' : 'false'}">${escapeHtml(datesToggleLabel)}</button><span class="only-print">${escapeHtml(datesToggleLabel)}</span></td>
    </tr><tr class="ds-ops-course-dates-row" data-ops-course-dates-row="${escapeHtml(row.key)}"${isExpanded ? '' : ' hidden'}><td colspan="10">${datesListHtml(row.dates)}</td></tr>`;
  }).join('');
  return rows.length ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-course-schedule-table"><thead><tr><th class="ds-ops-course-col--name">שם הקורס</th><th class="ds-ops-course-col--authority">רשות</th><th class="ds-ops-course-col--school">בית ספר</th><th class="ds-ops-course-col--instructor">מדריך</th><th class="ds-ops-course-col--weekday">יום</th><th class="ds-ops-course-col--time">שעות</th><th class="ds-ops-course-col--period">תקופת הקורס</th><th class="ds-ops-course-col--grade">כיתה</th><th class="ds-ops-course-col--sessions">מס׳ מפגשים</th><th class="ds-ops-course-col--dates">תאריכי המפגשים</th></tr></thead><tbody>${tableRows}</tbody></table>`) : dsEmptyState('לא נמצאו קורסים מוכנים לסידור עבודה בטווח הנבחר');
}

export function bindCourseScheduleDateToggles(root, expandedDates = {}, rerender) {
  root.querySelectorAll('[data-ops-course-dates-toggle]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.opsCourseDatesToggle;
    if (!key) return;
    if (expandedDates[key]) delete expandedDates[key]; else expandedDates[key] = true;
    rerender?.();
  }));
}
