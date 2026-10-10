import { activityMeetings } from '../instructor-scheduling-load.js';
import { isFullDaySchedulingActivity } from '../shared/activity-scheduling-eligibility.js';
import { normalizeCalendarSector } from '../shared/school-calendar-logic.js';
import { schedulingWeekendFailure } from '../shared/scheduling-weekend-policy.js';

export const ENGINE_VERSION = 'planning-v37-20261010-regional-scarcity-stages';
export const text = value => String(value ?? '').trim();
export const activityId = a => text(a?.row_id || a?.RowID || a?.id);
export const address = value => text(value).toLowerCase().replace(/\s+/g, ' ');
export function minute(value) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text(value));
  return m && +m[1] < 24 && +m[2] < 60 && +(m[3] || 0) < 60 ? +m[1] * 60 + +m[2] + +(m[3] || 0) / 60 : NaN;
}
export const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
export const addDays = (date, count) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export const meetingEmpId = (m, fallback) => text(m.substituteEmpId || m.emp_id || m.instructor_emp_id || fallback);
export const activeInstructor = i => i?.active === true || ['yes', 'כן', 'true'].includes(text(i?.active).toLowerCase());
const canonicalTime = value => { const t=text(value); return t.endsWith(':00') && t.length===8 ? t.slice(0,5) : t; };
export function officialMeetings(a) {
  return activityMeetings(a).map((m, i) => ({ ...m, ...(a.meeting_instructor_overrides?.find(h => text(h.meeting_date).slice(0,10) === text(m.date).slice(0,10)) ? { substituteEmpId: text(a.meeting_instructor_overrides.find(h => text(h.meeting_date).slice(0,10) === text(m.date).slice(0,10)).emp_id) } : {}), date: text(m.date).slice(0, 10), meeting_no: m.meeting_no || i + 1,
    start_time: canonicalTime(m.start_time || a.start_time), end_time: canonicalTime(m.end_time || a.end_time) }));
}
export function knownRoute(context, from, to) {
  if (!address(from) || !address(to)) return null;
  if (address(from) === address(to)) return { distance_km: 0, duration_minutes: 0 };
  const route = context.routeClient?.peek?.(from, to) || context.verifiedRoutes?.get(`${address(from)}→${address(to)}`);
  return route && route.distance_km != null && route.duration_minutes != null
    && Number.isFinite(+route.distance_km) && Number.isFinite(+route.duration_minutes)
    && +route.distance_km >= 0 && +route.duration_minutes >= 0 ? route : null;
}
export function compileConstraints(input) {
  const byActivity = new Map((input.activities || []).map(a => [activityId(a), a]));
  const byInstructor = new Map((input.instructors || []).map(i => [text(i.emp_id), i]));
  const profiles = input.profiles || {}, rules = new Map(), exceptions = new Map();
  for (const [id, rows] of Object.entries(input.rules || {})) {
    const days = new Map(); for (const r of rows) { const key = +r.weekday; if (!days.has(key)) days.set(key, []); days.get(key).push(r); }
    rules.set(id, days);
  }
  for (const [id, rows] of Object.entries(input.exceptions || {})) {
    const days = new Map(); for (const r of rows) { const key = text(r.exception_date).slice(0, 10); if (!days.has(key)) days.set(key, []); days.get(key).push(r); }
    exceptions.set(id, days);
  }
  return { byActivity, byInstructor, profiles, rules, exceptions, calendar: input.schoolCalendar || [], verifiedRoutes: new Map(), routeClient: input.routeClient };
}
// Cache only actual route responses; absence/failure never becomes a guessed route.
export async function ensureRoute(context, from, to) {
  const known = knownRoute(context, from, to); if (known) return known;
  if (!address(from) || !address(to)) return null;
  const route = await context.routeClient?.request?.(from, to);
  if (route && route.calculated !== false && route.distance_km != null && route.duration_minutes != null
    && Number.isFinite(+route.distance_km) && Number.isFinite(+route.duration_minutes)
    && +route.distance_km >= 0 && +route.duration_minutes >= 0) {
    context.verifiedRoutes ||= new Map(); context.verifiedRoutes.set(`${address(from)}→${address(to)}`, route);
  }
  return knownRoute(context, from, to);
}
export async function ensureCandidateRoutes(context, occupancy, activity, option) {
  await ensureRoute(context, context.byInstructor.get(text(option.instructorEmpId))?.address, activity.school_address);
  for (const meeting of option.meetings || []) {
    const empId = meetingEmpId(meeting, option.instructorEmpId);
    await ensureRoute(context, context.byInstructor.get(empId)?.address, activity.school_address);
    const list = (occupancy.days.get(`${empId}|${meeting.date}`) || []).filter(m => m.courseId !== activityId(activity));
    const before = list.filter(m => m.end <= minute(meeting.start_time)).at(-1), after = list.find(m => m.start >= minute(meeting.end_time));
    if (before && before.schoolId !== text(activity.school_id)) await ensureRoute(context, before.address, activity.school_address);
    if (after && after.schoolId !== text(activity.school_id)) await ensureRoute(context, activity.school_address, after.address);
  }
}
export async function validatePlanWithRoutes(input, checkpoint = async () => {}) {
  const context = input.constraintContext || compileConstraints(input), occupancy = createOccupancy(context, input.rows || []);
  for (const row of input.rows || []) { await checkpoint(); const a = context.byActivity.get(row.courseId);
    if (a && row.instructorEmpId) await ensureCandidateRoutes(context, occupancy, a, row);
  }
  await checkpoint(); return validatePlan({...input, constraintContext:context});
}
export function staticFailures(context, activity, empId) {
  const p = context.profiles[empId], i = context.byInstructor.get(empId), failures = [];
  if (!activeInstructor(i)) failures.push('inactive_instructor');
  if (!text(activity.school_id) || !address(activity.school_address) || !normalizeCalendarSector(activity.calendar_sector)) failures.push('missing_school_data');
  if (!p || !['male', 'female'].includes(p.gender) || !p.instruction_languages?.length) failures.push('missing_profile_data');
  if (!text(activity.instruction_language)) failures.push('missing_language');
  else if (p && !(p.instruction_languages || []).includes(activity.instruction_language)) failures.push('language');
  if (['male', 'female'].includes(activity.required_instructor_gender) && p?.gender !== activity.required_instructor_gender) failures.push('gender');
  const authority = address(activity.authority);
  if ((p?.blocked_authorities || []).some(a => address(a) === authority)) failures.push('blocked_authority');
  const route = knownRoute(context, i?.address, activity.school_address);
  if (!route) failures.push('home_route_unknown'); else if (+route.distance_km > 40) failures.push('home_distance_exceeded');
  return failures;
}
export function meetingFailures(context, activity, empId, meeting) {
  const day = weekday(meeting.date), p = context.profiles[empId], failures = [];
  const override = context.exceptions.get(empId)?.get(meeting.date);
  const rules = override || context.rules.get(empId)?.get(day) || [];
  const start = minute(meeting.start_time), end = minute(meeting.end_time);
  const parsed = new Date(`${meeting.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meeting.date) || !Number.isFinite(day) || (Number.isFinite(day) && parsed.toISOString().slice(0, 10) !== meeting.date)
    || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) failures.push('invalid_meeting');
  // Only explicit true is availability. Conflicting duplicate rules fail closed.
  if (!rules.length || rules.some(r => r.available !== true)
    || !rules.some(r => start >= minute(r.start_time) && end <= minute(r.end_time))) failures.push(override ? 'availability_exception' : 'availability');
  const weekend = schedulingWeekendFailure({ date: meeting.date, profile: p, activity, availability: rules.find(r => r.available === true) });
  if (weekend) failures.push(weekend);
  for (const c of context.calendar) {
    if (c.is_active === false || meeting.date < c.start_date || meeting.date > (c.end_date || c.start_date)) continue;
    const sector = normalizeCalendarSector(c.calendar_sector) || 'general';
    if (sector !== 'general' && sector !== normalizeCalendarSector(activity.calendar_sector)) continue;
    if (c.blocks_scheduling === true) failures.push('calendar_block');
    if (c.enforce_end_time === true && end > minute(c.school_day_end_time)) failures.push('calendar_end_time');
  }
  return [...new Set(failures)];
}
export function createOccupancy(context, rows = []) {
  const days = new Map(), byCourse = new Map();
  const remove = id => { for (const key of byCourse.get(id) || []) { const list = days.get(key).filter(m => m.courseId !== id); if (list.length) days.set(key, list); else days.delete(key); } byCourse.delete(id); };
  const add = row => {
    remove(row.courseId); const a = context.byActivity.get(row.courseId); if (!a || !row.instructorEmpId) return;
    const keys = new Set();
    for (const m of row.meetings || []) {
      const ids = new Set([meetingEmpId(m, row.instructorEmpId), ...(row.additionalInstructorEmpIds || []).map(text)]);
      for (const empId of ids) {
        const key = `${empId}|${m.date}`, item = { ...m, empId, courseId: row.courseId, schoolId: text(a.school_id), address: a.school_address,
          authority: a.authority, start: minute(m.start_time), end: minute(m.end_time), fullDay: isFullDaySchedulingActivity(a) };
        const list = days.get(key) || []; list.push(item); list.sort((a, b) => a.start - b.start || a.courseId.localeCompare(b.courseId)); days.set(key, list); keys.add(key);
      }
    }
    byCourse.set(row.courseId, keys);
  };
  rows.forEach(add); return { days, byCourse, add, remove };
}
export function transitionFailure(context, previous, next) {
  if (previous.schoolId && previous.schoolId === next.schoolId) return null;
  const route = knownRoute(context, previous.address, next.address);
  if (!route) return 'transition_unknown';
  if (+route.distance_km > 20) return 'transition_distance_exceeded';
  const required = +route.duration_minutes + (+route.distance_km <= 5 ? 5 : 15);
  return next.start - previous.end < required ? 'transition_time' : null;
}
export function candidateFailures(context, occupancy, activity, option) {
  const primary = text(option.instructorEmpId);
  const failures = staticFailures(context, activity, primary).map(reason => ({ reason, empId: primary })), id = activityId(activity), checkedIds = new Set([primary]);
  for (const m of option.meetings || []) {
    if ((activity.start_time && minute(m.start_time) !== minute(activity.start_time)) || (activity.end_time && minute(m.end_time) !== minute(activity.end_time))) failures.push({reason:'fixed_time_changed',date:m.date});
    const empId = meetingEmpId(m, option.instructorEmpId);
    if (!checkedIds.has(empId)) { checkedIds.add(empId); failures.push(...staticFailures(context, activity, empId).map(reason => ({ reason, empId }))); }
    failures.push(...meetingFailures(context, activity, empId, m).map(reason => ({ reason, empId, date: m.date })));
    const list = (occupancy.days.get(`${empId}|${m.date}`) || []).filter(x => x.courseId !== id);
    const item = { start: minute(m.start_time), end: minute(m.end_time), address: activity.school_address, schoolId: text(activity.school_id) };
    if (list.some(x => isFullDaySchedulingActivity(activity) || x.fullDay || (item.start < x.end && item.end > x.start))) { failures.push({ reason: 'overlap', empId, date: m.date }); continue; }
    const previous = list.filter(x => x.end <= item.start).at(-1), next = list.find(x => x.start >= item.end);
    for (const [first, second] of [[previous, item], [item, next]]) if (first && second) {
      const reason = transitionFailure(context, first, second); if (reason) failures.push({ reason, empId, date: m.date, otherCourseId: first.courseId || second.courseId });
    }
  }
  if (!option.meetings?.length) failures.push({ reason: 'missing_meetings' });
  const own = new Map(); for (const m of option.meetings || []) { const key = `${meetingEmpId(m, option.instructorEmpId)}|${m.date}`;
    for (const prior of own.get(key) || []) if (minute(m.start_time) < minute(prior.end_time) && minute(m.end_time) > minute(prior.start_time)) failures.push({ reason: 'self_overlap', date: m.date });
    (own.get(key) || own.set(key, []).get(key)).push(m);
  }
  return failures;
}
export function isProtectedActivity(a) { return !!text(a?.emp_id) || !!text(a?.emp_id_2) || a?.instructor_assignment_locked === true; }
export function sameSchedule(a = [], b = []) {
  const projection = rows => rows.map((m,i) => [text(m.date).slice(0, 10), canonicalTime(m.start_time), canonicalTime(m.end_time), +m.meeting_no || i+1]);
  return JSON.stringify(projection(a)) === JSON.stringify(projection(b));
}
export function validatePlan(input) {
  const context = input.constraintContext || compileConstraints(input), rows = input.rows || [], failures = [], warnings = [], seen = new Set();
  const present = new Set(rows.map(r => r.courseId));
  const externalAnchors = [...context.byActivity.values()].filter(a => !present.has(activityId(a))).flatMap(a => {
    if (isProtectedActivity(a)) return [{ courseId: activityId(a), instructorEmpId: text(a.emp_id || a.emp_id_2),
      additionalInstructorEmpIds: text(a.emp_id_2) && text(a.emp_id) ? [text(a.emp_id_2)] : [], meetings: officialMeetings(a) }];
    if (a.draft_emp_id && a.draft_proposed_meetings?.length) return [{ courseId: activityId(a), instructorEmpId: text(a.draft_emp_id), meetings: a.draft_proposed_meetings }];
    return [];
  });
  const occupancy = createOccupancy(context, [...externalAnchors, ...rows]), committed = new Map((input.committedRows || []).map(r => [r.courseId, r]));
  for (const row of rows) {
    const a = context.byActivity.get(row.courseId);
    if (!a || seen.has(row.courseId)) { failures.push({ courseId: row.courseId, reason: a ? 'duplicate_activity' : 'unknown_activity' }); continue; } seen.add(row.courseId);
    const protectedActivity = isProtectedActivity(a), lock = input.lockedOptions?.[row.courseId];
    if (!protectedActivity && row.additionalInstructorEmpIds?.length) failures.push({courseId:row.courseId,reason:'unexpected_secondary_instructor'});
    const official = officialMeetings(a);
    if (protectedActivity && JSON.stringify((row.additionalInstructorEmpIds || []).map(text).sort()) !== JSON.stringify((text(a.emp_id_2) && text(a.emp_id) ? [text(a.emp_id_2)] : []).sort())) failures.push({ courseId: row.courseId, reason: 'protected_coteacher_changed' });
    if (protectedActivity && (row.meetings || []).some((m,i) => meetingEmpId(m,row.instructorEmpId) !== meetingEmpId(official[i] || {},a.emp_id || a.emp_id_2))) failures.push({ courseId: row.courseId, reason: 'protected_meeting_instructor_changed' });
    if (protectedActivity && (text(row.instructorEmpId) !== text(a.emp_id || a.emp_id_2) || !sameSchedule(row.meetings, official))) failures.push({ courseId: row.courseId, reason: 'protected_assignment_changed' });
    if (lock && (!sameSchedule(row.meetings, lock.meetings) || text(row.instructorEmpId) !== text(lock.instructorEmpId))) failures.push({ courseId: row.courseId, reason: 'planning_lock_changed' });
    if (!protectedActivity && official.length && !sameSchedule(row.meetings, official)) failures.push({ courseId: row.courseId, reason: 'official_dates_changed' });
    if (!row.instructorEmpId) continue;
    const issues = candidateFailures(context, occupancy, a, row).map(f => ({ ...f, courseId: row.courseId }));
    // Historic approved assignments remain immutable and visible; they are not
    // newly certified. A stale/forged kind='live' cannot create this exemption.
    if (protectedActivity || (lock && committed.has(row.courseId) && text(row.instructorEmpId) === text(committed.get(row.courseId).instructorEmpId) && sameSchedule(row.meetings, committed.get(row.courseId).meetings) && (row.meetings || []).every((m,i)=>meetingEmpId(m,row.instructorEmpId)===meetingEmpId(committed.get(row.courseId).meetings[i] || {},committed.get(row.courseId).instructorEmpId)))) warnings.push(...issues.map(f => ({ ...f, protectedSource: true })));
    else failures.push(...issues);
  }
  for (const a of input.requiredActivities || []) if (!seen.has(activityId(a))) failures.push({ courseId: activityId(a), reason: 'missing_activity' });
  return { valid: failures.length === 0, failures, warnings, validatorVersion: ENGINE_VERSION, protectedSourceWarnings: warnings.length };
}
