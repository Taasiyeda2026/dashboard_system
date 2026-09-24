import * as XLSX from 'xlsx';

const text = (value) => String(value ?? '').trim();

function formatIsoDate(value) {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function formatTimeRange(start, end) {
  const from = text(start).slice(0, 5);
  const to = text(end).slice(0, 5);
  if (!from && !to) return '';
  if (!to) return from;
  if (!from) return to;
  return `${from}–${to}`;
}

function sourceLabel(row = {}) {
  if (row.kind === 'live') return 'שיבוץ קיים';
  if (row.kind === 'draft') return 'טיוטה קיימת';
  if (row.kind === 'planning-locked') return 'נקבע בתכנון';
  if (row.kind === 'proposal' || row.kind === 'fixed-proposal') return 'הצעת מערכת';
  if (row.kind === 'recruitment') return 'נדרש גיוס';
  return 'נדרש טיפול';
}

function optionRowsForActivity(row = {}) {
  const options = Array.isArray(row.options) ? row.options.filter(Boolean) : [];
  if (options.length) return options;
  if (row.instructorEmpId || row.instructorName || row.startDate || row.startTime) {
    return [{
      instructorEmpId: row.instructorEmpId,
      instructorName: row.instructorName,
      startDate: row.startDate,
      endDate: row.endDate,
      startTime: row.startTime,
      endTime: row.endTime,
      meetings: row.meetings || [],
      reason: row.reason || ''
    }];
  }
  return [];
}

function additionalOptionsText(row = {}) {
  const options = optionRowsForActivity(row).slice(1);
  return options.map((option, index) => {
    const date = formatIsoDate(option.startDate);
    const time = formatTimeRange(option.startTime, option.endTime);
    const instructor = text(option.instructorName) || 'ללא מדריך';
    return `${index + 2}. ${date}${time ? ` ${time}` : ''} — ${instructor}`;
  }).join(' | ');
}

export function planningWorkbookRows(rows = []) {
  const activities = [];
  const options = [];
  const instructorMeetings = [];

  for (const row of rows || []) {
    const rowOptions = optionRowsForActivity(row);
    const primary = rowOptions[0] || row;
    const possibleInstructors = [...new Set(rowOptions.map((option) => text(option.instructorName)).filter(Boolean))];

    activities.push({
      'פעילות': text(row.courseName),
      'סוג': text(row.activityType) || 'קורס',
      'רשות': text(row.authority),
      'בית ספר': text(row.school),
      'סטטוס': text(row.status),
      'מפגשים': Number(row.sessions) || '',
      'תאריך התחלה מוצע': formatIsoDate(primary.startDate || row.startDate),
      'תאריך סיום': formatIsoDate(primary.endDate || row.endDate),
      'שעות': formatTimeRange(primary.startTime || row.startTime, primary.endTime || row.endTime),
      'מדריך מוצע': text(primary.instructorName || row.instructorName),
      'מספר עובד': text(primary.instructorEmpId || row.instructorEmpId),
      'מדריכים אפשריים': possibleInstructors.join(' | '),
      'חלופות נוספות': additionalOptionsText(row),
      'מקור': sourceLabel(row),
      'הערה': text(row.reason)
    });

    if (rowOptions.length) {
      rowOptions.forEach((option, index) => {
        options.push({
          'פעילות': text(row.courseName),
          'סוג': text(row.activityType) || 'קורס',
          'רשות': text(row.authority),
          'בית ספר': text(row.school),
          'עדיפות': index + 1,
          'בחירה': index === 0 ? (row.planningLocked ? 'נקבע בתכנון' : 'מומלץ') : 'חלופה',
          'תאריך התחלה': formatIsoDate(option.startDate),
          'תאריך סיום': formatIsoDate(option.endDate),
          'שעות': formatTimeRange(option.startTime, option.endTime),
          'מדריך אפשרי': text(option.instructorName),
          'מספר עובד': text(option.instructorEmpId),
          'סיבה': text(option.reason || row.reason)
        });
      });
    } else {
      options.push({
        'פעילות': text(row.courseName),
        'סוג': text(row.activityType) || 'קורס',
        'רשות': text(row.authority),
        'בית ספר': text(row.school),
        'עדיפות': '',
        'בחירה': sourceLabel(row),
        'תאריך התחלה': formatIsoDate(row.startDate),
        'תאריך סיום': formatIsoDate(row.endDate),
        'שעות': formatTimeRange(row.startTime, row.endTime),
        'מדריך אפשרי': text(row.instructorName),
        'מספר עובד': text(row.instructorEmpId),
        'סיבה': text(row.reason)
      });
    }

    const meetings = Array.isArray(row.meetings) ? row.meetings : [];
    for (const meeting of meetings) {
      const date = text(meeting?.date).slice(0, 10);
      if (!date || !row.instructorName) continue;
      instructorMeetings.push({
        'מדריך': text(row.instructorName),
        'מספר עובד': text(row.instructorEmpId),
        'תאריך': formatIsoDate(date),
        'שעות': formatTimeRange(meeting?.start_time || row.startTime, meeting?.end_time || row.endTime),
        'פעילות': text(row.courseName),
        'סוג': text(row.activityType) || 'קורס',
        'בית ספר': text(row.school),
        'רשות': text(row.authority),
        'מקור': sourceLabel(row)
      });
    }
  }

  instructorMeetings.sort((a, b) =>
    text(a['מדריך']).localeCompare(text(b['מדריך']), 'he')
    || text(a['תאריך']).split('/').reverse().join('-').localeCompare(text(b['תאריך']).split('/').reverse().join('-'))
    || text(a['שעות']).localeCompare(text(b['שעות']))
  );

  return { activities, options, instructorMeetings };
}

function worksheetFromRows(data, widths) {
  const safeRows = data.length ? data : [{ 'אין נתונים': '' }];
  const sheet = XLSX.utils.json_to_sheet(safeRows);
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(range.e.c)}${range.e.r + 1}` };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  sheet['!sheetViews'] = [{ rightToLeft: true }];
  return sheet;
}

export function buildPlanningWorkbook(rows = []) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('אין תוצאות תכנון לייצוא.');
  const { activities, options, instructorMeetings } = planningWorkbookRows(rows);
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };

  XLSX.utils.book_append_sheet(
    workbook,
    worksheetFromRows(activities, [26, 12, 18, 24, 20, 9, 16, 16, 14, 20, 12, 36, 54, 16, 52]),
    'סידור עבודה'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    worksheetFromRows(options, [26, 12, 18, 24, 9, 14, 16, 16, 14, 20, 12, 50]),
    'אפשרויות תכנון'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    worksheetFromRows(instructorMeetings, [20, 12, 14, 14, 26, 12, 24, 18, 16]),
    'מערכת לפי מדריך'
  );

  return workbook;
}

export function planningExportFilename(date = new Date()) {
  const stamp = date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `סידור_עבודה_תכנון_${stamp}.xlsx`;
}

export function exportPlanningWorkbook(rows = [], { filename = '' } = {}) {
  const out = filename || planningExportFilename();
  XLSX.writeFile(buildPlanningWorkbook(rows), out, { bookType: 'xlsx', compression: true });
  return out;
}
