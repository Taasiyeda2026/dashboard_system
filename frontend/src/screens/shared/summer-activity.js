const SUMMER_START_DATE = '2026-07-01';
const SUMMER_END_DATE = '2026-08-31';

function normalizedDateText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeSummerMarker(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function hasExplicitSummerClassification(activity = {}) {
  return [
    activity?.activity_type_group,
    activity?.activity_group,
    activity?.activity_family,
    activity?.source,
    activity?.season,
    activity?.activity_season,
    activity?.catalog_group
  ].some((value) => {
    const marker = normalizeSummerMarker(value);
    return marker.includes('summer') || marker.includes('קיץ');
  });
}

export function isSummerActivity(activity = {}) {
  const startDate = normalizedDateText(activity?.start_date || activity?.date_start);
  if (startDate) {
    return startDate >= SUMMER_START_DATE && startDate <= SUMMER_END_DATE;
  }
  return hasExplicitSummerClassification(activity);
}
