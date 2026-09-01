import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import {
  calculateCourseSchedule as calculateCourseScheduleCore,
  preliminaryCourseCandidates as preliminaryCourseCandidatesCore
} from './course-scheduling-engine-core.js';

export * from './course-scheduling-engine-core.js';

const text = (value) => String(value ?? '').trim();

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

export function preliminaryCourseCandidates(input = {}) {
  return preliminaryCourseCandidatesCore(resolveSchedulingInputScope(input));
}

export function calculateCourseSchedule(input = {}) {
  return calculateCourseScheduleCore(resolveSchedulingInputScope(input));
}
