import { evaluateInstructor } from './instructor-matching-engine.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { isActivitySchedulingEligible } from './shared/activity-scheduling-eligibility.js';

const text = (value) => String(value ?? '').trim();
const minutes = (value) => { const [hours, mins] = text(value).split(':').map(Number); return hours * 60 + mins; };
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (row) => text(row?.emp_id);

export function schedulingCourses(rows = []) {
  return rows.filter(isActivitySchedulingEligible);
}

export function missingCourseInformation(activity) {
  const missing = [];
  if (!text(activity?.school)) missing.push('בית ספר');
  if (!text(activity?.school_address)) missing.push('כתובת בית הספר');
  const meetings = activityMeetings(activity);
  if (!meetings.length) missing.push('תאריכי מפגשים');
  if (!meetings.length || meetings.some((m) => !text(m.start_time || activity?.start_time) || !text(m.end_time || activity?.end_time))) missing.push('שעות');
  if (!text(activity?.instruction_language)) missing.push('שפת הדרכה');
  if (!text(activity?.education_level) && !text(activity?.grade)) missing.push('שכבת גיל');
  return [...new Set(missing)];
}

function teachingHours(rows = []) {
  return rows.reduce((total, row) => total + activityMeetings(row).reduce((sum, meeting) => {
    const start = minutes(meeting.start_time || row.start_time);
    const end = minutes(meeting.end_time || row.end_time);
    return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60 : 0);
  }, 0), 0);
}

export function availabilityHours(profile = {}, rules = []) {
  const availableRules = rules.filter((rule) => rule.available && Number(rule.weekday) !== 6);
  if (!availableRules.length) return 0;
  return availableRules.reduce((sum, rule) => sum + Math.max(0, minutes(rule.end_time) - minutes(rule.start_time)) / 60, 0);
}

export function instructorLoad(assignments = [], profile = {}, rules = []) {
  const meetings = assignments.flatMap(activityMeetings);
  const workDays = new Set(meetings.map((m) => text(m.date))).size;
  const hours = teachingHours(assignments);
  const capacity = availabilityHours(profile, rules);
  return { hours, meetings: meetings.length, workDays, availabilityHours: capacity, ratio: capacity > 0 ? hours / capacity : Number.POSITIVE_INFINITY };
}

function meetingAssignments(rows) {
  return rows.flatMap((activity) => activityMeetings(activity).map((meeting) => ({ ...meeting, school: activity.school, authority: activity.authority, school_address: activity.school_address, activity_name: activity.activity_name })));
}

function candidateMap({ courses, instructors, profiles = {}, rules = {}, exceptions = {}, assigned = {} }) {
  const output = new Map();
  courses.forEach((course) => {
    const candidates = instructors.map((instructor) => {
      const empId = empOf(instructor);
      const load = instructorLoad(assigned[empId] || [], profiles[empId], rules[empId] || []);
      const result = evaluateInstructor({ instructor, profile: profiles[empId], rules: rules[empId] || [], exceptions: exceptions[empId] || [], activity: course, existingActivities: meetingAssignments(assigned[empId] || []), weeklyLoad: load.ratio * 10, averageWeeklyLoad: 0 });
      if (result.eligible) {
        result.score = Math.max(0, Math.round(result.score - Math.min(30, load.ratio * 30)));
        result.explanation = `${result.explanation}, עומס ביחס לזמינות ${Math.round(load.ratio * 100)}%`;
      }
      return { ...result, instructor, load };
    });
    output.set(idOf(course), candidates);
  });
  return output;
}

export function calculateCourseSchedule(input = {}) {
  const courses = schedulingCourses(input.activities || []);
  const assignedRows = (input.activities || []).filter((row) => !isActivitySchedulingEligible(row) && (text(row.emp_id) || text(row.instructor_name)));
  const assigned = { ...(input.assignments || {}) };
  assignedRows.forEach((row) => { const emp = text(row.emp_id); if (emp) (assigned[emp] ||= []).push(row); });
  const incomplete = new Map(courses.map((course) => [idOf(course), missingCourseInformation(course)]));
  const ready = courses.filter((course) => !incomplete.get(idOf(course)).length);
  const maps = candidateMap({ ...input, courses: ready, assigned });
  const ordered = [...ready].sort((a, b) => maps.get(idOf(a)).filter((c) => c.eligible).length - maps.get(idOf(b)).filter((c) => c.eligible).length);
  // A bounded beam keeps the all-course calculation responsive while preserving
  // the primary objective (assigned count) ahead of aggregate ranking score.
  let states = [{ draft: new Map(), score: 0 }];
  for (const course of ordered) {
    const expanded = [];
    for (const state of states) {
      expanded.push(state);
      const candidates = maps.get(idOf(course)).filter((candidate) => candidate.eligible).sort((a, b) => b.score - a.score);
      for (const candidate of candidates) {
        const emp = empOf(candidate.instructor);
        const draftRows = [...state.draft.entries()].filter(([, c]) => empOf(c.instructor) === emp).map(([courseId]) => ordered.find((row) => idOf(row) === courseId));
        const check = evaluateInstructor({ instructor: candidate.instructor, profile: input.profiles?.[emp], rules: input.rules?.[emp] || [], exceptions: input.exceptions?.[emp] || [], activity: course, existingActivities: meetingAssignments([...(assigned[emp] || []), ...draftRows]) });
        if (!check.eligible) continue;
        const draft = new Map(state.draft); draft.set(idOf(course), candidate);
        expanded.push({ draft, score: state.score + candidate.score });
      }
    }
    states = expanded.sort((a, b) => b.draft.size - a.draft.size || b.score - a.score).slice(0, 200);
  }
  const best = states[0]?.draft || new Map();
  return courses.map((course) => {
    const id = idOf(course), missing = incomplete.get(id);
    if (missing.length) return { course, status: 'חסר מידע', missing, recommended: null, alternatives: [], checked: [] };
    const checked = maps.get(id) || [], eligible = checked.filter((c) => c.eligible).sort((a, b) => b.score - a.score);
    const recommended = best.get(id) || null;
    return { course, status: recommended ? (recommended.warnings.length ? 'נדרש טיפול' : 'הצעה מוכנה') : 'נדרש גיוס', recommended, alternatives: eligible.filter((c) => empOf(c.instructor) !== empOf(recommended?.instructor)).slice(0, 3), checked };
  });
}
