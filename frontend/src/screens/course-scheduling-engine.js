import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import {
  calculateCourseSchedule as calculateCourseScheduleCore,
  preliminaryCourseCandidates as preliminaryCourseCandidatesCore
} from './course-scheduling-engine-core.js';

export * from './course-scheduling-engine-core.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

function withLegacyCalendarSectorDefaults(input = {}) {
  const activities = Array.isArray(input.activities)
    ? input.activities.map((activity) => (
      Object.prototype.hasOwnProperty.call(activity || {}, 'calendar_sector')
        ? activity
        : { ...activity, calendar_sector: 'general' }
    ))
    : input.activities;
  return activities === input.activities ? input : { ...input, activities };
}

/**
 * UI adapter for ordinary scheduling calculations.
 *
 * The pure engine receives the complete activities collection so conflict,
 * transition and continuity checks still see assignments outside the selected
 * district. Only the set of courses being planned is narrowed by `district`.
 *
 * Production course rows are enriched with a canonical `calendar_sector` from
 * their school. The fallback to `general` is only for legacy callers/fixtures
 * that do not provide the field at all; an explicit empty value remains empty
 * and is treated as missing school-sector data.
 */
export function resolveSchedulingInputScope(input = {}) {
  const sectorReadyInput = withLegacyCalendarSectorDefaults(input);
  const explicitDistrict = normalizeOperationalDistrict(sectorReadyInput.district || '');
  if (explicitDistrict) return { ...sectorReadyInput, district: explicitDistrict };
  if (text(sectorReadyInput.authority)) return sectorReadyInput;
  if (typeof document === 'undefined') return sectorReadyInput;

  const selectedDistrict = normalizeOperationalDistrict(
    document.querySelector?.('[data-district-filter]')?.value || ''
  );
  return selectedDistrict ? { ...sectorReadyInput, district: selectedDistrict } : sectorReadyInput;
}

function proposedMeetingsForDraft(candidate = {}) {
  const proposed = Array.isArray(candidate?.proposedMeetings) ? candidate.proposedMeetings : [];
  return proposed.length ? proposed.map((meeting) => ({ ...meeting })) : null;
}

/**
 * Mirror a proposal as an in-memory draft so the next course is evaluated
 * against the plan already produced in this same district simulation.
 *
 * When no date adjustment was proposed we intentionally keep
 * draft_proposed_meetings=null. That matches save_course_assignment_draft and
 * makes the core engine use the course's official meetings as blockers.
 */
function planningDraftActivity(result = {}) {
  const candidate = result?.recommended || result?.bestAvailable || null;
  const course = result?.course || null;
  const empId = text(candidate?.instructor?.emp_id);
  if (!course || !empId) return null;
  return {
    ...course,
    draft_emp_id: empId,
    draft_instructor_name: text(candidate?.instructor?.full_name),
    draft_proposed_meetings: proposedMeetingsForDraft(candidate)
  };
}

/**
 * A district simulation is a plan, not a collection of independent suggestions.
 * Re-evaluate each course in the deterministic order chosen by the core engine,
 * adding each accepted proposal as an in-memory draft before evaluating the next
 * course. This prevents the simulation from proposing two drafts that overlap or
 * do not have enough transition time and then discovering that only during save.
 */
function makeDistrictPlanConsistent(scopedInput, initialResults) {
  const district = normalizeOperationalDistrict(scopedInput?.district || '');
  const targetCourseId = text(scopedInput?.targetCourseId || scopedInput?.targetActivityId);
  if (!district || targetCourseId || !Array.isArray(initialResults) || initialResults.length < 2) {
    return initialResults;
  }

  const baseActivities = Array.isArray(scopedInput.activities) ? scopedInput.activities : [];
  const planningDrafts = [];
  const results = [];

  for (const initialResult of initialResults) {
    const courseId = idOf(initialResult?.course);
    if (!courseId || initialResult?.status === 'חסר מידע') {
      results.push(initialResult);
      continue;
    }

    const recalculated = calculateCourseScheduleCore({
      ...scopedInput,
      activities: [...baseActivities, ...planningDrafts],
      targetCourseId: courseId,
      targetActivityId: ''
    });
    const result = (recalculated || []).find((item) => idOf(item?.course) === courseId) || initialResult;
    results.push(result);

    const draft = planningDraftActivity(result);
    if (draft) planningDrafts.push(draft);
  }

  return results;
}

export function preliminaryCourseCandidates(input = {}) {
  return preliminaryCourseCandidatesCore(resolveSchedulingInputScope(input));
}

export function calculateCourseSchedule(input = {}) {
  const scopedInput = resolveSchedulingInputScope(input);
  const initialResults = calculateCourseScheduleCore(scopedInput);
  return makeDistrictPlanConsistent(scopedInput, initialResults);
}
