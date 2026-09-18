import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { schedulingQualityBand } from './instructor-matching-engine.js';
import {
  calculateCourseSchedule as calculateCourseScheduleCore
} from './course-scheduling-engine-core.js';
import {
  compareCandidatesStable,
  computeSchedulingScore
} from './course-scheduling-score.js';

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
 * Missing activity details must remain visible as "חסר מידע". Therefore the
 * rolling workspace includes courses with start date + start time even when no
 * period meetings were generated yet.
 */
export function resolveSchedulingInputScope(input = {}) {
  const sectorReadyInput = withLegacyCalendarSectorDefaults({
    ...input,
    includeIncompleteWithoutPeriodMeetings: input.includeIncompleteWithoutPeriodMeetings ?? true
  });
  const explicitDistrict = normalizeOperationalDistrict(sectorReadyInput.district || '');
  if (explicitDistrict) return { ...sectorReadyInput, district: explicitDistrict };
  if (text(sectorReadyInput.authority)) return sectorReadyInput;
  if (typeof document === 'undefined') return sectorReadyInput;

  const selectedDistrict = normalizeOperationalDistrict(
    document.querySelector?.('[data-district-filter]')?.value || ''
  );
  return selectedDistrict ? { ...sectorReadyInput, district: selectedDistrict } : sectorReadyInput;
}

function scoreCandidate(candidate, peerProjectedHours = [], peerProjectedUtilizationRatios = []) {
  if (!candidate?.eligible) return candidate;
  const activity = candidate.periodCourse || candidate.course || {};
  const scored = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activityMeetings(activity),
    existingActivities: candidate.plannerMeetings || candidate.existingMeetings || [],
    travel: candidate.travel,
    workDates: candidate.baselineWorkDates || new Set(),
    dateAdjustment: candidate.dateAdjustment,
    currentHalfHours: candidate.currentHalfHours,
    projectedHalfHours: candidate.projectedHalfHours,
    peerProjectedHours,
    currentCourseCount: candidate.currentCourseCount,
    availabilityHours: candidate.availabilityHours,
    currentUtilizationRatio: candidate.currentUtilizationRatio,
    projectedUtilizationRatio: candidate.projectedUtilizationRatio ?? candidate.utilizationRatio,
    peerProjectedUtilizationRatios,
    activeWorkDays: candidate.activeWorkDays
  });
  return {
    ...candidate,
    ...scored,
    ...schedulingQualityBand(scored.score, true)
  };
}

/**
 * The core engine owns hard gates and planning context. This adapter owns the
 * approved 100-point business rubric and quality bands, so every UI/simulation
 * caller sees the same score after all hard eligibility checks have passed.
 */
function applySchedulingScoreContract(result = {}) {
  if (!result?.course || result.status === 'חסר מידע') return result;
  const checkedRaw = Array.isArray(result.checked) ? result.checked : [];
  const eligiblePeers = checkedRaw.filter((candidate) => candidate?.eligible);
  const peerProjectedHours = eligiblePeers
    .map((candidate) => Number(candidate.projectedHalfHours))
    .filter(Number.isFinite);
  const peerProjectedUtilizationRatios = eligiblePeers
    .map((candidate) => Number(candidate.projectedUtilizationRatio ?? candidate.utilizationRatio))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const checked = checkedRaw.map((candidate) => scoreCandidate(
    candidate,
    peerProjectedHours,
    peerProjectedUtilizationRatios
  ));
  const eligibleSorted = checked
    .filter((candidate) => candidate.eligible)
    .sort((first, second) => compareCandidatesStable(first, second));

  const primary = eligibleSorted[0] || null;
  const recommended = primary && Number(primary.score) >= 60
    ? { ...primary, recommended: true, bestAvailable: false }
    : null;
  const bestAvailable = primary && !recommended
    ? { ...primary, recommended: false, bestAvailable: true }
    : null;
  const selectedId = text((recommended || bestAvailable)?.instructor?.emp_id);
  const alternatives = eligibleSorted
    .filter((candidate) => text(candidate.instructor?.emp_id) !== selectedId)
    .slice(0, 3)
    .map((candidate) => ({ ...candidate, recommended: false, bestAvailable: false }));
  const incompleteProfiles = checked.filter((candidate) =>
    !(candidate.failures || []).length && (candidate.missingProfileData || []).length);

  const selected = recommended || bestAvailable;
  const status = recommended
    ? ((recommended.warnings || []).length ? 'נדרש טיפול' : 'הצעה מוכנה')
    : bestAvailable || incompleteProfiles.length ? 'נדרש טיפול' : 'נדרש גיוס';
  const treatmentReason = bestAvailable
    ? 'נמצאו מדריכים שעומדים בתנאי הסף, אך הציון שלהם נמוך מסף ההמלצה.'
    : !recommended && incompleteProfiles.length
      ? 'לא ניתן להשלים את בדיקת השיבוץ משום שחסרים נתונים בפרופילי מדריכים.'
      : result.treatmentReason || '';

  return {
    ...result,
    status,
    recommended,
    bestAvailable,
    alternatives,
    checked,
    incompleteProfiles,
    eligibleCandidateCount: eligibleSorted.length,
    treatmentReason,
    selectedQualityBand: selected?.qualityBand || null
  };
}

function applySchedulingScoreContractToResults(results = []) {
  return results.map(applySchedulingScoreContract);
}

function proposedMeetingsForDraft(candidate = {}) {
  const proposed = Array.isArray(candidate?.proposedMeetings) ? candidate.proposedMeetings : [];
  return proposed.length ? proposed.map((meeting) => ({ ...meeting })) : null;
}

/**
 * Mirror a proposal as an in-memory draft so the next course is evaluated
 * against the plan already produced in this same district simulation.
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
 * Any multi-course calculation is just repeated single-course scheduling with
 * one shared ranking policy. Each accepted proposal becomes an in-memory draft
 * before the next course is evaluated, so batch, district and authority runs
 * use exactly the same decision logic as a single scheduling calculation.
 */
function makeBatchPlanConsistent(scopedInput, initialResults) {
  const targetCourseId = text(scopedInput?.targetCourseId || scopedInput?.targetActivityId);
  if (targetCourseId || !Array.isArray(initialResults) || initialResults.length < 2) {
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

    const recalculatedRaw = calculateCourseScheduleCore({
      ...scopedInput,
      activities: [...baseActivities, ...planningDrafts],
      targetCourseId: courseId,
      targetActivityId: ''
    });
    const recalculated = applySchedulingScoreContractToResults(recalculatedRaw || []);
    const result = recalculated.find((item) => idOf(item?.course) === courseId) || initialResult;
    results.push(result);

    const draft = planningDraftActivity(result);
    if (draft) planningDrafts.push(draft);
  }

  return results;
}

export function preliminaryCourseCandidates(input = {}) {
  const scopedInput = resolveSchedulingInputScope({
    ...input,
    preliminary: true,
    travel: {},
    routeMatrix: {}
  });
  const results = applySchedulingScoreContractToResults(calculateCourseScheduleCore(scopedInput));
  return results.flatMap((result) => (result.checked || [])
    .filter((candidate) => candidate.eligible)
    .map((candidate) => ({ course: result.course, candidate })));
}

export function calculateCourseSchedule(input = {}) {
  const scopedInput = resolveSchedulingInputScope(input);
  const initialResults = applySchedulingScoreContractToResults(calculateCourseScheduleCore(scopedInput));
  return makeBatchPlanConsistent(scopedInput, initialResults);
}
