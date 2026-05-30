import { isEmptyValue, nonEmptyString } from '../../utils/empty-value.js';
import { resolveActivityInstructorName } from './activity-options.js';

function normalizedDate(value) {
  if (isEmptyValue(value)) return '';
  const text = nonEmptyString(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function activityGapTypes(row = {}) {
  const types = [];
  const instructorName = resolveActivityInstructorName(row);
  const emp1 = nonEmptyString(row?.emp_id ?? row?.EmployeeID);
  const emp2 = nonEmptyString(row?.emp_id_2 ?? row?.EmployeeID2);
  if (!instructorName && !emp1 && !emp2) types.push('missing_instructor');

  const start = normalizedDate(row?.start_date ?? row?.date_start);
  if (!start) types.push('missing_start_date');
  return types;
}

export function rowMatchesActivityGapFilter(row, gap) {
  const key = String(gap || '').trim();
  if (!key) return true;
  return activityGapTypes(row).includes(key);
}
