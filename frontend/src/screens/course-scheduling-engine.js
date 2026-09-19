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
  if (sectorReadyInput.allDistricts === true) {
    return { ...sectorReadyInput, district: '', authority: '' };
  }
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

const OPERATIONAL_BLOCK_MAX_GAP_MINUTES = 30;

function timeMinutes(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(mins) || mins < 0 || mins > 59) return null;
  return (hours * 60) + mins;
}

function courseDateSignature(course = {}) {
  return activityMeetings(course)
    .map((meeting) => text(meeting?.date).slice(0, 10))
    .filter(Boolean)
    .sort()
    .join(',');
}

function courseSlot(course = {}) {
  const meetings = activityMeetings(course);
  const meeting = meetings[0] || {};
  return {
    start: timeMinutes(meeting.start_time || course.start_time),
    end: timeMinutes(meeting.end_time || course.end_time)
  };
}

function operationalBlockKey(course = {}) {
  const schoolId = text(course.school_id);
  const dates = courseDateSignature(course);
  return schoolId && dates ? `${schoolId}|${dates}` : '';
}

/**
 * Build operational same-school lanes before assigning instructors.
 *
 * Courses are grouped only when they share the exact meeting-date series and a
 * stable school_id. Inside each group, parallel courses create separate lanes,
 * while courses with a 0-30 minute gap extend the nearest lane.
 *
 * Examples:
 *   08-10 + 10-12 + 12-14 => one block
 *   08-10 + 08-10 + 10-12 => one 08-12 block + one 08-10 block
 *   08-10 + 14-16 + 16-18 => 08-10 block + 14-18 block
 */
export function buildOperationalBlocks(results = []) {
  const indexed = (results || []).map((result, index) => ({ result, index }));
  const grouped = new Map();
  const blocks = [];

  for (const item of indexed) {
    const course = item.result?.course || {};
    const key = operationalBlockKey(course);
    const slot = courseSlot(course);
    if (!key || slot.start == null || slot.end == null || slot.end <= slot.start || item.result?.status === 'חסר מידע') {
      blocks.push({ firstIndex: item.index, items: [item] });
      continue;
    }
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...item, slot });
  }

  for (const items of grouped.values()) {
    const ordered = [...items].sort((first, second) =>
      first.slot.start - second.slot.start
      || first.slot.end - second.slot.end
      || first.index - second.index
    );
    const lanes = [];

    for (const item of ordered) {
      const compatible = lanes
        .map((lane, laneIndex) => {
          const last = lane.items.at(-1);
          const gap = item.slot.start - last.slot.end;
          return { lane, laneIndex, gap, lastEnd: last.slot.end };
        })
        .filter(({ gap }) => gap >= 0 && gap <= OPERATIONAL_BLOCK_MAX_GAP_MINUTES)
        .sort((first, second) => second.lastEnd - first.lastEnd || first.laneIndex - second.laneIndex);

      const chosen = compatible[0]?.lane || null;
      if (chosen) {
        chosen.items.push(item);
        chosen.firstIndex = Math.min(chosen.firstIndex, item.index);
      } else {
        lanes.push({ firstIndex: item.index, items: [item] });
      }
    }
    blocks.push(...lanes);
  }

  return blocks
    .sort((first, second) => first.firstIndex - second.firstIndex)
    .map((block, blockIndex) => ({
      id: `operational-block-${blockIndex + 1}`,
      results: block.items.map((item) => item.result),
      courseIds: block.items.map((item) => idOf(item.result?.course)).filter(Boolean)
    }));
}

function planningDraftActivityForCandidate(course = null, candidate = null) {
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
 * Mirror a proposal as an in-memory draft so the next course is evaluated
 * against the plan already produced in this same district simulation.
 */
function planningDraftActivity(result = {}) {
  const candidate = result?.recommended || result?.bestAvailable || null;
  return planningDraftActivityForCandidate(result?.course || null, candidate);
}

function selectedCandidateId(result = {}) {
  return text((result.recommended || result.bestAvailable)?.instructor?.emp_id);
}

function recalculateCourse(scopedInput, baseActivities, planningDrafts, courseId) {
  const recalculatedRaw = calculateCourseScheduleCore({
    ...scopedInput,
    activities: [...baseActivities, ...planningDrafts],
    targetCourseId: courseId,
    targetActivityId: ''
  });
  const recalculated = applySchedulingScoreContractToResults(recalculatedRaw || []);
  return recalculated.find((item) => idOf(item?.course) === courseId) || null;
}

function promoteBlockCandidate(result = {}, empId = '', block = null) {
  const selectedId = text(empId);
  const candidate = (result.checked || []).find((item) =>
    item?.eligible && text(item?.instructor?.emp_id) === selectedId
  );
  if (!candidate) return null;

  const eligibleSorted = (result.checked || [])
    .filter((item) => item?.eligible && text(item?.instructor?.emp_id) !== selectedId)
    .sort((first, second) => compareCandidatesStable(first, second));
  const recommended = Number(candidate.score) >= 60
    ? { ...candidate, recommended: true, bestAvailable: false }
    : null;
  const bestAvailable = recommended
    ? null
    : { ...candidate, recommended: false, bestAvailable: true };
  const selected = recommended || bestAvailable;

  return {
    ...result,
    status: recommended
      ? ((recommended.warnings || []).length ? 'נדרש טיפול' : 'הצעה מוכנה')
      : 'נדרש טיפול',
    recommended,
    bestAvailable,
    alternatives: eligibleSorted
      .slice(0, 3)
      .map((item) => ({ ...item, recommended: false, bestAvailable: false })),
    treatmentReason: recommended
      ? result.treatmentReason || ''
      : 'נבחר כחלק מבלוק תפעולי רציף באותו בית ספר; המדריך עומד בתנאי הסף אך הציון נמוך מסף ההמלצה.',
    selectedQualityBand: selected?.qualityBand || null,
    operationalBlock: block ? {
      id: block.id,
      courseIds: [...block.courseIds],
      size: block.courseIds.length,
      sharedInstructorEmpId: selectedId
    } : null
  };
}

function commonEligibleInstructorIds(results = []) {
  let common = null;
  for (const result of results) {
    const eligible = new Set((result?.checked || [])
      .filter((candidate) => candidate?.eligible)
      .map((candidate) => text(candidate?.instructor?.emp_id))
      .filter(Boolean));
    common = common == null
      ? eligible
      : new Set([...common].filter((empId) => eligible.has(empId)));
    if (!common.size) break;
  }
  return [...(common || [])];
}

function averageFinite(values = []) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function blockCandidateRepresentative(results = [], empId = '') {
  const candidates = results
    .map((result) => (result?.checked || []).find((candidate) =>
      candidate?.eligible && text(candidate?.instructor?.emp_id) === text(empId)))
    .filter(Boolean);
  if (!candidates.length || candidates.length !== results.length) return null;

  const first = candidates[0];
  const last = candidates.at(-1);
  const continuity = averageFinite(candidates.map((candidate) =>
    candidate.scoreBreakdown?.continuityEfficiency?.points));
  const score = averageFinite(candidates.map((candidate) => candidate.score));
  const travelMinutes = averageFinite(candidates.map((candidate) => candidate.relevantTravelMinutes));
  const travelDistance = averageFinite(candidates.map((candidate) => candidate.relevantTravelDistance));
  const utilization = averageFinite(candidates.map((candidate) =>
    candidate.projectedUtilizationRatio ?? candidate.utilizationRatio));

  return {
    ...last,
    currentCourseCount: first.currentCourseCount,
    score: score ?? last.score,
    totalScore: score ?? last.totalScore,
    relevantTravelMinutes: travelMinutes,
    relevantTravelDistance: travelDistance,
    projectedUtilizationRatio: utilization ?? last.projectedUtilizationRatio,
    utilizationRatio: utilization ?? last.utilizationRatio,
    scoreBreakdown: {
      ...(last.scoreBreakdown || {}),
      continuityEfficiency: {
        ...(last.scoreBreakdown?.continuityEfficiency || {}),
        ...(continuity == null ? {} : { points: continuity })
      }
    }
  };
}

function simulateSharedInstructorBlock({
  scopedInput,
  baseActivities,
  planningDrafts,
  block,
  empId
}) {
  const localDrafts = [];
  const plannedResults = [];

  for (const template of block.results) {
    const courseId = idOf(template?.course);
    const recalculated = recalculateCourse(
      scopedInput,
      baseActivities,
      [...planningDrafts, ...localDrafts],
      courseId
    ) || template;
    const promoted = promoteBlockCandidate(recalculated, empId, block);
    if (!promoted) return null;
    const draft = planningDraftActivity(promoted);
    if (!draft) return null;
    plannedResults.push(promoted);
    localDrafts.push(draft);
  }

  return { results: plannedResults, drafts: localDrafts };
}

function planBlockWithSharedInstructor({
  scopedInput,
  baseActivities,
  planningDrafts,
  block
}) {
  if (!block || block.results.length < 2) return null;

  // Re-evaluate every course against persisted assignments plus already accepted
  // blocks, but not against siblings in this block. This identifies instructors
  // who can genuinely cover the whole recurring block.
  const standalone = block.results.map((template) => (
    recalculateCourse(scopedInput, baseActivities, planningDrafts, idOf(template?.course)) || template
  ));
  const commonIds = commonEligibleInstructorIds(standalone);
  if (!commonIds.length) return null;

  const ranked = commonIds
    .map((empId) => ({ empId, representative: blockCandidateRepresentative(standalone, empId) }))
    .filter((item) => item.representative)
    .sort((first, second) => compareCandidatesStable(first.representative, second.representative));

  // Try the strongest block candidate first. Sequential revalidation catches
  // cumulative hard limits (overlap, daily sequence, transitions) before the
  // block is accepted.
  for (const item of ranked) {
    const simulation = simulateSharedInstructorBlock({
      scopedInput,
      baseActivities,
      planningDrafts,
      block,
      empId: item.empId
    });
    if (simulation) return simulation;
  }
  return null;
}

/**
 * Multi-course planning is block-first.
 *
 * Same-school courses with the same recurring dates are first arranged into
 * non-overlapping continuity lanes. If one instructor can cover an entire lane,
 * the lane is kept intact. Only when no instructor can cover the full lane do
 * we fall back to ordinary course-by-course planning.
 *
 * This makes operational continuity a planning constraint rather than merely a
 * score bonus, while every accepted proposal is still revalidated by the same
 * single-course hard-gate engine before it becomes an in-memory draft.
 */
function makeBatchPlanConsistent(scopedInput, initialResults) {
  const targetCourseId = text(scopedInput?.targetCourseId || scopedInput?.targetActivityId);
  if (targetCourseId || !Array.isArray(initialResults) || initialResults.length < 2) {
    return initialResults;
  }

  const baseActivities = Array.isArray(scopedInput.activities) ? scopedInput.activities : [];
  const planningDrafts = [];
  const resultsById = new Map();
  const blocks = buildOperationalBlocks(initialResults);

  const acceptResult = (result) => {
    const courseId = idOf(result?.course);
    if (courseId) resultsById.set(courseId, result);
    const draft = planningDraftActivity(result);
    if (draft) planningDrafts.push(draft);
  };

  for (const block of blocks) {
    const blockPlan = planBlockWithSharedInstructor({
      scopedInput,
      baseActivities,
      planningDrafts,
      block
    });
    if (blockPlan) {
      for (const result of blockPlan.results) acceptResult(result);
      continue;
    }

    // No one can cover the complete lane: split only as much as necessary and
    // retain the existing deterministic single-course ranking for each piece.
    for (const initialResult of block.results) {
      const courseId = idOf(initialResult?.course);
      if (!courseId || initialResult?.status === 'חסר מידע') {
        if (courseId) resultsById.set(courseId, initialResult);
        continue;
      }
      const result = recalculateCourse(scopedInput, baseActivities, planningDrafts, courseId) || initialResult;
      acceptResult(result);
    }
  }

  // Preserve the engine's public result order (urgency / scarcity / date / id)
  // even though the internal planning order is block-first.
  return initialResults.map((result) => resultsById.get(idOf(result?.course)) || result);
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
