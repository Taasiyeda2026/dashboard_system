import { escapeHtml } from '../shared/html.js';

function text(value) {
  return String(value ?? '').trim();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function time(value) {
  return text(value).slice(0, 5);
}

export function instructorAttendanceRecordsForDate(rows = [], date = '') {
  const target = text(date).slice(0, 10);
  return (Array.isArray(rows) ? rows : []).filter((row) => text(row?.report_date).slice(0, 10) === target);
}

export function instructorAttendanceCardHtml(row = {}) {
  const fields = [];
  const add = (label, value, wide = false) => {
    const display = text(value);
    if (display) fields.push({ label, value: display, wide });
  };

  add('סוג פעילות', row.activity_type);
  add('שם פעילות', row.activity_name_snapshot || row.program_name_snapshot, true);
  add('שעת התחלה', time(row.start_time));
  add('שעת סיום', time(row.end_time));
  if (row.total_hours !== null && row.total_hours !== undefined && text(row.total_hours)) add('סך שעות', row.total_hours);
  add('בית ספר', row.school_name_snapshot);
  add('רשות', row.authority_name_snapshot);
  const kilometers = positiveNumber(row.roundtrip_km);
  if (kilometers) add('ק״מ', kilometers);
  const publicTransportCost = positiveNumber(row.public_transport_cost);
  if (row.public_transport === true || publicTransportCost) add('תחבורה ציבורית', publicTransportCost ? `כן · ₪${publicTransportCost}` : 'כן');
  const expenses = positiveNumber(row.expenses);
  if (expenses) add('הוצאות', `₪${expenses}`);
  add('פירוט הוצאות', row.expense_details, true);
  add('הערות', row.notes, true);

  return `<article class="instr-calendar-attendance-card"><h4>דיווח נוכחות</h4><dl>${fields.map(({ label, value, wide }) => `<div${wide ? ' class="is-wide"' : ''}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></article>`;
}

export function instructorAttendanceCardsHtml(rows = [], date = '') {
  return instructorAttendanceRecordsForDate(rows, date).map(instructorAttendanceCardHtml).join('');
}
