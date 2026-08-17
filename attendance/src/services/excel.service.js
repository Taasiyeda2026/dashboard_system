/**
 * excel.service.js
 * Export attendance records for a month to an xlsx file.
 * Uses SheetJS (window.XLSX) loaded from CDN in index.html.
 *
 * Two sheets:
 *   1. "רשומות" — all records with every field (matches old system Excel output)
 *   2. "סיכום"  — totals by activity_type + overall km + expenses
 */

/**
 * @param {object[]} records  From getMonthRecords()
 * @param {object}   instructor  { name, empId }
 * @param {number}   year
 * @param {number}   month  1-based
 */
export function exportMonthToExcel(records, instructor, year, month) {
  if (!window.XLSX) {
    alert('ספריית ה-Excel אינה זמינה. נסו לרענן את הדף.');
    return;
  }

  const XLSX = window.XLSX;
  const monthLabel = new Date(year, month - 1, 1)
    .toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

  // ── Sheet 1: Records ─────────────────────────────────────────────────────
  const DAY_NAMES = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

  const recordRows = records.map((r) => {
    const d = new Date(r.report_date);
    const dayName = DAY_NAMES[d.getDay()];
    const hours = Number(r.total_hours || 0).toFixed(2);
    return {
      'תאריך':          r.report_date,
      'יום':            dayName,
      'התחלה':          r.start_time || '',
      'סיום':           r.end_time || '',
      'שעות':           hours,
      'סוג פעילות':     r.activity_type || '',
      'שם פעילות':      r.activity_name_snapshot || '',
      'תוכנית':         r.program_name_snapshot || r.program_name || '',
      'מפגש מס\'':      r.meeting_no != null ? r.meeting_no : '',
      'רשות':           r.authority_name_snapshot || '',
      'בית ספר':        r.school_name_snapshot || '',
      'מס\' מוסד':      r.semel_mosad || '',
      'ק"מ':            Number(r.roundtrip_km || 0).toFixed(1),
      'הוצאות (₪)':    Number(r.expenses || 0).toFixed(2),
      'פירוט הוצאות':   r.expense_details || '',
      'הערות':          r.notes || '',
      'מספר עובד':      r.emp_id,
      'שם מדריך':       instructor.name || ''
    };
  });

  const ws1 = XLSX.utils.json_to_sheet(recordRows, { origin: 'A3' });

  // Title rows
  XLSX.utils.sheet_add_aoa(ws1, [
    [`דיווח נוכחות — ${monthLabel}`],
    [`מדריך: ${instructor.name}  |  מ.ע: ${instructor.empId}`]
  ], { origin: 'A1' });

  // Column widths (approximate)
  ws1['!cols'] = [
    { wch: 11 }, // תאריך
    { wch: 7 },  // יום
    { wch: 7 },  // התחלה
    { wch: 7 },  // סיום
    { wch: 6 },  // שעות
    { wch: 14 }, // סוג פעילות
    { wch: 22 }, // שם פעילות
    { wch: 16 }, // תוכנית
    { wch: 8 },  // מפגש
    { wch: 18 }, // רשות
    { wch: 20 }, // בית ספר
    { wch: 10 }, // מס' מוסד
    { wch: 7 },  // ק"מ
    { wch: 10 }, // הוצאות
    { wch: 20 }, // פירוט
    { wch: 20 }, // הערות
    { wch: 10 }, // מ.ע
    { wch: 16 }  // שם
  ];

  // ── Sheet 2: Summary ──────────────────────────────────────────────────────
  const byType = {};
  let totalHours = 0, totalKm = 0, totalExpenses = 0;

  for (const r of records) {
    const t = r.activity_type || 'לא ידוע';
    if (!byType[t]) byType[t] = { hours: 0, sessions: 0 };
    byType[t].hours += Number(r.total_hours || 0);
    byType[t].sessions += 1;
    totalHours += Number(r.total_hours || 0);
    totalKm += Number(r.roundtrip_km || 0);
    totalExpenses += Number(r.expenses || 0);
  }

  const summaryRows = Object.entries(byType).map(([type, agg]) => ({
    'סוג פעילות': type,
    'מפגשים':    agg.sessions,
    'שעות':      Number(agg.hours.toFixed(2))
  }));
  summaryRows.push({});
  summaryRows.push({ 'סוג פעילות': 'סה"כ שעות', 'מפגשים': '', 'שעות': Number(totalHours.toFixed(2)) });
  summaryRows.push({ 'סוג פעילות': 'סה"כ ק"מ',  'מפגשים': '', 'שעות': Number(totalKm.toFixed(1)) });
  summaryRows.push({ 'סוג פעילות': 'סה"כ הוצאות (₪)', 'מפגשים': '', 'שעות': Number(totalExpenses.toFixed(2)) });

  const ws2 = XLSX.utils.json_to_sheet(summaryRows, { origin: 'A3' });
  XLSX.utils.sheet_add_aoa(ws2, [
    [`סיכום חודשי — ${monthLabel}`],
    [`מדריך: ${instructor.name}  |  מ.ע: ${instructor.empId}`]
  ], { origin: 'A1' });
  ws2['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }];

  // ── Build workbook & trigger download ────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'רשומות');
  XLSX.utils.book_append_sheet(wb, ws2, 'סיכום');

  const pad = (n) => String(n).padStart(2, '0');
  const fileName = `נוכחות_${instructor.empId}_${year}-${pad(month)}.xlsx`;

  XLSX.writeFile(wb, fileName);
}
