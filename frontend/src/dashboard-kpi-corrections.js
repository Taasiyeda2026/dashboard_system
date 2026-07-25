import { api } from './api.js';
import './summer-feedback-admin-integration.js';
import './summer-feedback-instructor-card.js';

const TYPE_DEFINITIONS = [
  { key: 'course', id: 'active_courses', action: 'kpi|active_courses', subtitle: 'קורסים' },
  { key: 'workshop', id: 'active_workshops', action: 'kpi|active_workshops', subtitle: 'סדנאות' },
  { key: 'escape_room', id: 'active_escape_room', action: 'kpi|active_escape_room', subtitle: 'חדר בריחה' },
  { key: 'tour', id: 'active_tours', action: 'kpi|active_tours', subtitle: 'סיורים' },
  { key: 'after_school', id: 'active_after_school', action: 'kpi|active_after_school', subtitle: 'אפטרסקול' }
];

const EXCLUDED_MONTHLY_STATUSES = new Set([
  'נמחק',
  'בוטל',
  'deleted',
  'cancelled',
  'canceled'
]);

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(cleanText(value));
  return match ? match[1] : '';
}

function normalizeActivityType(row = {}) {
  const raw = cleanText(row.activity_type || row.type || row.kind);
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'course' || raw === 'קורס' || raw === 'קורסים') return 'course';
  if (compact === 'workshop' || raw === 'סדנה' || raw === 'סדנאות') return 'workshop';
  if (compact === 'escaperoom' || raw === 'חדר בריחה' || raw === 'חדרי בריחה') return 'escape_room';
  if (compact === 'tour' || raw === 'סיור' || raw === 'סיורים') return 'tour';
  if (compact === 'afterschool' || raw === 'אפטרסקול' || raw === 'חוג אפטרסקול') return 'after_school';
  return raw.toLowerCase();
}

function isExcludedMonthlyRow(row = {}) {
  return EXCLUDED_MONTHLY_STATUSES.has(cleanText(row.status).toLowerCase());
}

function rowHasDatePointInMonth(row = {}, month = '') {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  if (normalizeDate(row.start_date || row.date_start).startsWith(month)) return true;
  if (normalizeDate(row.end_date || row.date_end).startsWith(month)) return true;
  for (let index = 1; index <= 35; index += 1) {
    const value = row[`date_${index}`] ?? row[`Date${index}`];
    if (normalizeDate(value).startsWith(month)) return true;
  }
  return false;
}

function isProgramRow(row = {}, type = normalizeActivityType(row)) {
  const family = cleanText(row.activity_family).toLowerCase();
  return family === 'program' || type === 'course' || type === 'after_school';
}

function isOneDayRow(row = {}, type = normalizeActivityType(row)) {
  const family = cleanText(row.activity_family).toLowerCase();
  return family === 'one_day' || type === 'workshop' || type === 'escape_room' || type === 'tour';
}

function addInstructor(identitySet, nameSet, empId, name) {
  const normalizedName = cleanText(name);
  const normalizedId = cleanText(empId);
  const identity = normalizedName
    ? `name:${normalizedName.toLocaleLowerCase('he')}`
    : (normalizedId ? `id:${normalizedId}` : '');
  if (!identity) return;
  identitySet.add(identity);
  nameSet?.add(normalizedName || normalizedId);
}
