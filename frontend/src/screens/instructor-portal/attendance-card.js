import { escapeHtml } from '../shared/html.js';
import { formatDurationHours } from '../attendance-control.js';

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

function compactNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : text(value);
}

export function instructorAttendanceRecordsForDate(rows = [], date = '') {
  const target = text(date).slice(0, 10);
  return (Array.isArray(rows) ? rows : []).filter((row) => text(row?.report_date).slice(0, 10) === target);
}

export function instructorAttendanceDisplayName(row = {}) {
  const programName = text(row.program_name_snapshot);
  if (programName) return programName;

  const activityName = text(row.activity_name_snapshot);
  if (!activityName) return '';

  const trailingLocationParts = new Set([
    text(row.school_name_snapshot),
    text(row.authority_name_snapshot)
  ].filter(Boolean));
  const parts = activityName.split(/\s+[—–]\s+/).map((part) => part.trim()).filter(Boolean);
  while (parts.length > 1 && trailingLocationParts.has(parts.at(-1))) parts.pop();
  return parts.join(' — ') || activityName;
}

export function instructorAttendanceCardHtml(row = {}) {
  const title = instructorAttendanceDisplayName(row) || text(row.activity_type) || 'נוכחות';
  const activityType = text(row.activity_type);
  const start = time(row.start_time);
  const end = time(row.end_time);
  const hours = row.total_hours !== null && row.total_hours !== undefined && text(row.total_hours)
    ? formatDurationHours(row.total_hours)
    : '';
  const timeParts = [];
  if (start || end) timeParts.push(`${start || '—'}–${end || '—'}`);
  if (hours) timeParts.push(`${hours} שעות`);

  const locationParts = [text(row.school_name_snapshot), text(row.authority_name_snapshot)].filter(Boolean);
  const travelParts = [];
  const kilometers = positiveNumber(row.roundtrip_km);
  if (kilometers) travelParts.push(`${compactNumber(kilometers)} ק״מ`);
  const publicTransportCost = positiveNumber(row.public_transport_cost);
  if (row.public_transport === true || publicTransportCost) {
    travelParts.push(publicTransportCost ? `תחבורה ציבורית ₪${compactNumber(publicTransportCost)}` : 'תחבורה ציבורית');
  }
  const expenses = positiveNumber(row.expenses);
  if (expenses) travelParts.push(`הוצאות ₪${compactNumber(expenses)}`);

  const expenseDetails = text(row.expense_details);
  const notes = text(row.notes);
  const detailLines = [
    timeParts.length ? `<div class="instr-calendar-attendance-card__line instr-calendar-attendance-card__time">${escapeHtml(timeParts.join(' · '))}</div>` : '',
    locationParts.length ? `<div class="instr-calendar-attendance-card__line">${escapeHtml(locationParts.join(' · '))}</div>` : '',
    travelParts.length ? `<div class="instr-calendar-attendance-card__line instr-calendar-attendance-card__extras">${escapeHtml(travelParts.join(' · '))}</div>` : '',
    expenseDetails ? `<div class="instr-calendar-attendance-card__note">${escapeHtml(expenseDetails)}</div>` : '',
    notes ? `<div class="instr-calendar-attendance-card__note">${escapeHtml(notes)}</div>` : ''
  ].filter(Boolean).join('');

  const typeBadge = activityType && activityType !== title
    ? `<span class="instr-calendar-attendance-card__type">${escapeHtml(activityType)}</span>`
    : '';

  return `<article class="instr-calendar-attendance-card"><header class="instr-calendar-attendance-card__header"><strong>${escapeHtml(title)}</strong>${typeBadge}</header><div class="instr-calendar-attendance-card__body">${detailLines}</div></article>`;
}

export function instructorAttendanceCardsHtml(rows = [], date = '') {
  return instructorAttendanceRecordsForDate(rows, date).map(instructorAttendanceCardHtml).join('');
}
