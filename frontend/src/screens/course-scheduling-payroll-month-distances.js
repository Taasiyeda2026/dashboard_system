import { activityMeetings } from './instructor-scheduling-load.js';
import {
  buildGoogleAddressQuery,
  findCachedRowForPair,
  instructorEntityKey,
  normalizePlaceKey,
  schoolEntityKey,
  travelCacheRouteState
} from './course-scheduling-distance-build.js';

const text = (value) => String(value ?? '').trim();

const PAYROLL_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SKIPPED_ACTIVITY_STATUSES = new Set([
  'בוטל', 'cancelled', 'canceled', 'מבוטל', 'נמחק', 'deleted'
]);

export function parsePayrollMonth(value) {
  const match = text(value).match(PAYROLL_MONTH_RE);
  if (!match) return '';
  return `${match[1]}-${match[2]}`;
}

export function payrollMonthRange(month) {
  const parsed = parsePayrollMonth(month);
  if (!parsed) return null;
  const [year, monthNum] = parsed.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return {
    month: parsed,
    fromDate: `${parsed}-01`,
    toDate: `${parsed}-${String(lastDay).padStart(2, '0')}`
  };
}

export function isRemotePayrollActivity(activity = {}) {
  const haystack = `${text(activity.school)} ${text(activity.activity_name || activity.program_name || activity.name)}`;
  return /zoom|זום/u.test(haystack.toLocaleLowerCase('he-IL'));
}

export function isSkippedPayrollActivityStatus(activity = {}) {
  const status = text(activity.status || activity.activity_status).toLocaleLowerCase('he-IL');
  return SKIPPED_ACTIVITY_STATUSES.has(status);
}

export function numericEmpId(value) {
  const id = Number(text(value));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function assignedPayrollEmpIds(activity = {}) {
  const ids = [numericEmpId(activity.emp_id), numericEmpId(activity.emp_id_2)].filter(Boolean);
  return [...new Set(ids)];
}

function isoDate(value) {
  const date = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function streetAddress(...candidates) {
  for (const candidate of candidates) {
    const address = text(candidate);
    if (address) return address;
  }
  return '';
}

function activityIdOf(activity = {}) {
  return text(activity.row_id || activity.RowID || activity.id);
}

export function buildPayrollSchoolCatalog(schools = [], contactSchools = []) {
  const bySchoolId = new Map();
  const byAuthorityAndName = new Map();

  const rememberName = (school) => {
    const key = `${normalizePlaceKey(school.authority_name || '')}|${normalizePlaceKey(school.school_name || '')}`;
    if (key === '|') return;
    const list = byAuthorityAndName.get(key) || [];
    if (!list.some((row) => row.school_id === school.school_id && row.entity_key === school.entity_key)) {
      list.push(school);
      byAuthorityAndName.set(key, list);
    }
  };

  for (const row of schools || []) {
    const school_id = row.school_id == null && row.id == null ? null : Number(row.school_id ?? row.id);
    const address = streetAddress(row.address, row.institution_address, row.mailing_address);
    const school = {
      authority_id: row.authority_id == null ? null : Number(row.authority_id),
      authority_name: text(row.authority_name || row.authority),
      school_id: Number.isFinite(school_id) ? school_id : null,
      school_name: text(row.school_name || row.school),
      address
    };
    school.entity_key = schoolEntityKey(school);
    if (school.school_id != null) {
      const current = bySchoolId.get(school.school_id);
      if (!current || text(school.address).length > text(current.address).length) {
        bySchoolId.set(school.school_id, school);
      }
    }
    rememberName(school);
  }

  for (const row of contactSchools || []) {
    const school_id = row.school_id == null ? null : Number(row.school_id);
    const address = streetAddress(row.address);
    if (school_id == null || !Number.isFinite(school_id) || !address) continue;
    const current = bySchoolId.get(school_id);
    if (current && !text(current.address)) {
      current.address = address;
      current.entity_key = schoolEntityKey(current);
    }
  }

  return { bySchoolId, byAuthorityAndName };
}

export function resolvePayrollActivitySchool(activity = {}, catalog) {
  const schoolId = activity.school_id == null ? null : Number(activity.school_id);
  if (schoolId != null && Number.isFinite(schoolId) && catalog?.bySchoolId?.has(schoolId)) {
    const school = catalog.bySchoolId.get(schoolId);
    if (!text(school.address)) {
      return { status: 'unresolved', reason: 'missing_school_address', school: null };
    }
    return { status: 'resolved', reason: '', school };
  }

  const key = `${normalizePlaceKey(activity.authority || activity.authority_name || '')}|${normalizePlaceKey(activity.school || '')}`;
  const matches = key === '|' ? [] : (catalog?.byAuthorityAndName?.get(key) || []);
  const unique = [];
  for (const school of matches) {
    const id = school.school_id ?? school.entity_key;
    if (!unique.some((row) => (row.school_id ?? row.entity_key) === id)) unique.push(school);
  }
  if (unique.length === 1) {
    if (!text(unique[0].address)) {
      return { status: 'unresolved', reason: 'missing_school_address', school: null };
    }
    return { status: 'resolved', reason: '', school: unique[0] };
  }
  if (unique.length > 1) return { status: 'ambiguous', reason: 'ambiguous', school: null };
  return { status: 'unresolved', reason: 'unresolved', school: null };
}

function instructorSchoolPair(instructor, school) {
  if (!instructor || !school) return null;
  const originAddress = text(instructor.address);
  const destinationAddress = text(school.address);
  if (!originAddress || !destinationAddress) return null;
  return {
    pair_kind: 'instructor_school',
    origin_type: 'instructor',
    destination_type: 'school',
    origin_instructor_emp_id: instructor.emp_id,
    origin_school_id: null,
    destination_school_id: school.school_id ?? null,
    authority_id: school.authority_id ?? null,
    origin_address: originAddress,
    destination_address: destinationAddress,
    query_origin_address: originAddress,
    query_destination_address: buildGoogleAddressQuery({
      schoolName: school.school_name,
      address: destinationAddress,
      authorityName: school.authority_name
    }),
    origin_key: normalizePlaceKey(originAddress),
    destination_key: normalizePlaceKey(destinationAddress),
    origin_entity_key: instructorEntityKey(instructor.emp_id),
    destination_entity_key: school.entity_key || schoolEntityKey(school)
  };
}

function schoolSchoolPair(origin, destination) {
  const originAddress = text(origin.address);
  const destinationAddress = text(destination.address);
  if (!originAddress || !destinationAddress) return null;
  const originEntity = origin.entity_key || schoolEntityKey(origin);
  const destinationEntity = destination.entity_key || schoolEntityKey(destination);
  if (originEntity === destinationEntity) return null;
  if (
    origin.school_id != null
    && destination.school_id != null
    && Number(origin.school_id) === Number(destination.school_id)
  ) return null;
  return {
    pair_kind: 'school_school',
    origin_type: 'school',
    destination_type: 'school',
    origin_instructor_emp_id: null,
    origin_school_id: origin.school_id ?? null,
    destination_school_id: destination.school_id ?? null,
    authority_id: origin.authority_id ?? null,
    origin_address: originAddress,
    destination_address: destinationAddress,
    query_origin_address: buildGoogleAddressQuery({
      schoolName: origin.school_name,
      address: originAddress,
      authorityName: origin.authority_name
    }),
    query_destination_address: buildGoogleAddressQuery({
      schoolName: destination.school_name,
      address: destinationAddress,
      authorityName: destination.authority_name
    }),
    origin_key: normalizePlaceKey(originAddress),
    destination_key: normalizePlaceKey(destinationAddress),
    origin_entity_key: originEntity,
    destination_entity_key: destinationEntity
  };
}

function exceptionRow(activity, meetingDate, reason) {
  return {
    activity_id: activityIdOf(activity),
    date: isoDate(meetingDate) || '',
    authority: text(activity.authority || activity.authority_name),
    school: text(activity.school),
    reason
  };
}

export function collectPayrollMonthMeetings(activities = [], month, cancelledByActivity = new Map()) {
  const range = payrollMonthRange(month);
  if (!range) return [];
  const meetings = [];
  for (const activity of activities || []) {
    if (isSkippedPayrollActivityStatus(activity)) continue;
    const empIds = assignedPayrollEmpIds(activity);
    if (!empIds.length) continue;
    const cancelled = cancelledByActivity.get(activityIdOf(activity)) || activity.cancelled_meeting_dates || [];
    const rows = activityMeetings({ ...activity, cancelled_meeting_dates: cancelled })
      .map((meeting) => ({ ...meeting, date: isoDate(meeting.date) }))
      .filter((meeting) => meeting.date && meeting.date >= range.fromDate && meeting.date <= range.toDate);
    for (const meeting of rows) {
      meetings.push({
        activity,
        meeting,
        empIds,
        date: meeting.date,
        start_time: text(meeting.start_time || activity.start_time)
      });
    }
  }
  return meetings;
}

export function buildPayrollMonthDistancePlan({
  activities = [],
  schools = [],
  contactSchools = [],
  instructors = [],
  cancelledByActivity = new Map(),
  month
} = {}) {
  const range = payrollMonthRange(month);
  const empty = {
    month: range?.month || '',
    meetings: [],
    pairs: [],
    relevant_meeting_count: 0,
    relevant_instructor_count: 0,
    relevant_location_count: 0,
    required_count: 0,
    missing_instructor_address_count: 0,
    unresolved_location_count: 0,
    ambiguous_location_count: 0,
    exceptions: []
  };
  if (!range) return empty;

  const catalog = buildPayrollSchoolCatalog(schools, contactSchools);
  const instructorByEmpId = new Map(
    (instructors || [])
      .map((row) => ({ emp_id: numericEmpId(row.emp_id), address: text(row.address) }))
      .filter((row) => row.emp_id)
      .map((row) => [row.emp_id, row])
  );

  const meetings = collectPayrollMonthMeetings(activities, month, cancelledByActivity);
  const exceptions = [];
  const missingInstructorIds = new Set();
  const unresolvedActivities = new Set();
  const ambiguousActivities = new Set();
  const locations = new Map();
  const dayStops = new Map();
  const instructorIds = new Set();

  for (const row of meetings) {
    const { activity, empIds, date, start_time } = row;
    for (const empId of empIds) instructorIds.add(empId);
    if (isRemotePayrollActivity(activity)) continue;

    const resolved = resolvePayrollActivitySchool(activity, catalog);
    if (resolved.status !== 'resolved') {
      const reason = resolved.reason || resolved.status;
      if (resolved.status === 'ambiguous') ambiguousActivities.add(activityIdOf(activity));
      else unresolvedActivities.add(activityIdOf(activity));
      exceptions.push(exceptionRow(activity, date, reason));
      continue;
    }

    const school = resolved.school;
    locations.set(school.entity_key || schoolEntityKey(school), school);
    for (const empId of empIds) {
      const instructor = instructorByEmpId.get(empId);
      if (!text(instructor?.address)) {
        missingInstructorIds.add(empId);
        exceptions.push({
          ...exceptionRow(activity, date, 'missing_instructor_address'),
          emp_id: empId
        });
      }
      const key = `${empId}|${date}`;
      const stops = dayStops.get(key) || [];
      stops.push({ empId, date, start_time, school, instructor, activity });
      dayStops.set(key, stops);
    }
  }

  const pairsByRoute = new Map();
  const addPair = (pair) => {
    if (!pair) return;
    const key = `${pair.origin_key}->${pair.destination_key}`;
    if (!pairsByRoute.has(key)) pairsByRoute.set(key, pair);
  };

  for (const stops of dayStops.values()) {
    stops.sort((a, b) => text(a.start_time).localeCompare(text(b.start_time)));
    const sequence = [];
    for (const stop of stops) {
      const last = sequence[sequence.length - 1];
      const key = stop.school.entity_key || schoolEntityKey(stop.school);
      if (last && (last.school.entity_key || schoolEntityKey(last.school)) === key) continue;
      sequence.push(stop);
    }
    if (!sequence.length) continue;
    const instructor = sequence[0].instructor;
    addPair(instructorSchoolPair(instructor, sequence[0].school));
    for (let index = 1; index < sequence.length; index += 1) {
      addPair(schoolSchoolPair(sequence[index - 1].school, sequence[index].school));
    }
    const lastSchool = sequence[sequence.length - 1].school;
    addPair(instructorSchoolPair(instructor, lastSchool));
  }

  const uniqueExceptions = [];
  const seenException = new Set();
  for (const row of exceptions) {
    const key = `${row.activity_id}|${row.date}|${row.reason}|${row.emp_id || ''}`;
    if (seenException.has(key)) continue;
    seenException.add(key);
    uniqueExceptions.push(row);
  }

  const pairs = [...pairsByRoute.values()];
  return {
    month: range.month,
    meetings,
    pairs,
    relevant_meeting_count: meetings.length,
    relevant_instructor_count: instructorIds.size,
    relevant_location_count: locations.size,
    required_count: pairs.length,
    missing_instructor_address_count: missingInstructorIds.size,
    unresolved_location_count: unresolvedActivities.size,
    ambiguous_location_count: ambiguousActivities.size,
    exceptions: uniqueExceptions.slice(0, 50)
  };
}

export function classifyPayrollMonthCoverage(plan = {}, cacheRows = [], now = Date.now()) {
  let existing_count = 0;
  let refresh_required_count = 0;
  for (const pair of plan.pairs || []) {
    const cached = findCachedRowForPair(cacheRows, pair);
    const state = travelCacheRouteState(cached, pair.origin_address, pair.destination_address, now);
    if (state !== 'missing') existing_count += 1;
    if (state === 'refresh_required') refresh_required_count += 1;
  }
  const required_count = (plan.pairs || []).length;
  return {
    month: plan.month || '',
    relevant_meeting_count: plan.relevant_meeting_count || 0,
    relevant_instructor_count: plan.relevant_instructor_count || 0,
    relevant_location_count: plan.relevant_location_count || 0,
    required_count,
    existing_count,
    missing_count: required_count - existing_count,
    refresh_required_count,
    missing_instructor_address_count: plan.missing_instructor_address_count || 0,
    unresolved_location_count: plan.unresolved_location_count || 0,
    ambiguous_location_count: plan.ambiguous_location_count || 0,
    exceptions: plan.exceptions || []
  };
}
