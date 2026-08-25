import { escapeHtml } from './html.js';
import { formatDateHe, formatActivityDateColumnsHe } from './format-date.js';
import { activityManagerDisplayName, humanDisplayText } from './activity-options.js';
import { supabase } from '../../supabase-client.js';

const ACTIVITY_EXPORT_DETAIL_COLUMNS = 'row_id,activity_manager,funding,price,notes';
const ACTIVITY_EXPORT_DETAIL_CHUNK_SIZE = 200;
const ACTIVITY_EXPORT_DETAIL_FIELDS = ['activity_manager', 'funding', 'price', 'notes'];

function activityStatusDisplay(status) {
  const clean = String(status || '').trim();
  if (clean === 'סגור' || clean.toLowerCase() === 'closed') return 'סגור';
  return 'פתוח';
}

function safeFilePart(value, fallback = 'export') {
  const clean = String(value || fallback).replace(/[\\/?%*:|"<>]/g, '_').trim();
  return (clean || fallback).slice(0, 48);
}

function activityExportIdentity(row = {}) {
  return String(row.RowID ?? row.row_id ?? '').trim();
}

function hasActivityExportDetailFields(row = {}) {
  return ACTIVITY_EXPORT_DETAIL_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(row, field));
}

export function mergeActivityExportDetails(rows = [], details = []) {
  const safeRows = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  const detailsByRowId = new Map(
    (Array.isArray(details) ? details : [])
      .filter(Boolean)
      .map((detail) => [activityExportIdentity(detail), detail])
      .filter(([rowId]) => Boolean(rowId))
  );

  return safeRows.map((row) => {
    const detail = detailsByRowId.get(activityExportIdentity(row));
    return detail ? { ...row, ...detail } : row;
  });
}

export async function enrichActivityExportRows(rows = []) {
  const safeRows = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!safeRows.length || safeRows.every(hasActivityExportDetailFields) || !supabase) return safeRows;

  const rowIds = [...new Set(safeRows.map(activityExportIdentity).filter(Boolean))];
  if (!rowIds.length) return safeRows;

  const details = [];
  for (let index = 0; index < rowIds.length; index += ACTIVITY_EXPORT_DETAIL_CHUNK_SIZE) {
    const chunk = rowIds.slice(index, index + ACTIVITY_EXPORT_DETAIL_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('activities')
      .select(ACTIVITY_EXPORT_DETAIL_COLUMNS)
      .in('row_id', chunk);
    if (error) throw new Error(error.message || 'activity_export_details_failed');
    if (Array.isArray(data)) details.push(...data);
  }

  return mergeActivityExportDetails(safeRows, details);
}

export function triggerExcelDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildHtmlExcelBlob(headers, rows) {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const htmlRows = safeRows.map((row) => `<tr>${safeHeaders.map((header) => `<td>${escapeHtml(String(row?.[header] ?? ''))}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html dir="rtl" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8"></head><body>
    <table border="1"><thead><tr>${safeHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${htmlRows}</tbody></table></body></html>`;
  return new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
}

export function activityExportRow(row = {}) {
  const meetingDates = Array.isArray(row.meeting_dates) && row.meeting_dates.length
    ? row.meeting_dates
    : Array.isArray(row.date_cols) && row.date_cols.length
      ? row.date_cols
      : Array.from({ length: 35 }, (_, idx) => row[`date_${idx + 1}`] || row[`Date${idx + 1}`]).filter(Boolean);
  return {
    'מספר שורה': row.RowID || row.row_id || '',
    'שם פעילות': humanDisplayText(row.activity_name),
    'סוג פעילות': row.activity_type || '',
    'סטטוס': activityStatusDisplay(row.status),
    'בית ספר': humanDisplayText(row.school),
    'רשות': humanDisplayText(row.authority),
    'שכבה': row.grade || '',
    'קבוצה / כיתה': row.class_group || '',
    'מנהל פעילות': activityManagerDisplayName(row.activity_manager),
    'מדריך 1': humanDisplayText(row.instructor_name) || row.emp_id || '',
    'מדריך 2': humanDisplayText(row.instructor_name_2) || row.emp_id_2 || '',
    'תאריך התחלה': formatDateHe(row.start_date) || row.start_date || '',
    'תאריך סיום': formatDateHe(row.end_date) || row.end_date || '',
    'תאריכי מפגשים': meetingDates.map((d) => formatDateHe(d) || d).join(', ') || formatActivityDateColumnsHe(row),
    'שעת התחלה': row.start_time || '',
    'שעת סיום': row.end_time || '',
    'מימון': row.funding || '',
    'מחיר': row.price || '',
    'הערות': row.notes || ''
  };
}

export const ACTIVITY_EXPORT_HEADERS = [
  'מספר שורה',
  'שם פעילות',
  'סוג פעילות',
  'סטטוס',
  'בית ספר',
  'רשות',
  'שכבה',
  'קבוצה / כיתה',
  'מנהל פעילות',
  'מדריך 1',
  'מדריך 2',
  'תאריך התחלה',
  'תאריך סיום',
  'תאריכי מפגשים',
  'שעת התחלה',
  'שעת סיום',
  'מימון',
  'מחיר',
  'הערות'
];

export function exportActivitiesToExcel(rows, filenameBase = 'פעילויות') {
  const sourceRows = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 10);

  void enrichActivityExportRows(sourceRows)
    .catch((error) => {
      console.error('[activity-export] Failed to enrich activity export rows', error);
      return sourceRows;
    })
    .then((completeRows) => {
      const normalizedRows = completeRows.map(activityExportRow);
      triggerExcelDownload(
        buildHtmlExcelBlob(ACTIVITY_EXPORT_HEADERS, normalizedRows),
        `${safeFilePart(filenameBase, 'פעילויות')}_${stamp}.xls`
      );
    });
}

export function exportSingleActivityToExcel(row) {
  exportActivitiesToExcel([row], row?.activity_name || 'פעילות');
}
