const ACTIVITIES_GAP_QUERY_VALUES = new Set(['missing_instructor', 'missing_start_date']);

export function readActivitiesGapFromQuery() {
  if (typeof window === 'undefined') return '';
  const gap = String(new URLSearchParams(window.location.search).get('gap') || '').trim();
  return ACTIVITIES_GAP_QUERY_VALUES.has(gap) ? gap : '';
}

export function syncActivitiesGapQuery(gap) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const normalized = String(gap || '').trim();
  if (ACTIVITIES_GAP_QUERY_VALUES.has(normalized)) url.searchParams.set('gap', normalized);
  else url.searchParams.delete('gap');
  window.history.replaceState({}, '', url);
}

export function isActivitiesGapQueryValue(value) {
  return ACTIVITIES_GAP_QUERY_VALUES.has(String(value || '').trim());
}
