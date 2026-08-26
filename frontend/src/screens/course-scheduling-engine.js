import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import {
  calculateCourseSchedule as calculateCourseScheduleCore,
  preliminaryCourseCandidates as preliminaryCourseCandidatesCore
} from './course-scheduling-engine-core.js';

export * from './course-scheduling-engine-core.js';

const text = (value) => String(value ?? '').trim();

/**
 * UI adapter for ordinary scheduling calculations.
 *
 * The pure engine receives the complete activities collection so conflict,
 * transition and continuity checks still see assignments outside the selected
 * district. Only the set of courses being planned is narrowed by `district`.
 *
 * District simulation already passes an explicit district and authority-scoped
 * searches already pass an authority. The DOM fallback is therefore used only
 * for the ordinary "district selected, all authorities" screen state.
 */
export function resolveSchedulingInputScope(input = {}) {
  const explicitDistrict = normalizeOperationalDistrict(input.district || '');
  if (explicitDistrict) return { ...input, district: explicitDistrict };
  if (text(input.authority)) return input;
  if (typeof document === 'undefined') return input;

  const selectedDistrict = normalizeOperationalDistrict(
    document.querySelector?.('[data-district-filter]')?.value || ''
  );
  return selectedDistrict ? { ...input, district: selectedDistrict } : input;
}

export function preliminaryCourseCandidates(input = {}) {
  return preliminaryCourseCandidatesCore(resolveSchedulingInputScope(input));
}

export function calculateCourseSchedule(input = {}) {
  return calculateCourseScheduleCore(resolveSchedulingInputScope(input));
}
