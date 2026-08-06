const HOTFIX_FLAG = '__DS_ACTIVITY_2026_SEASON_QUERY_HOTFIX_V1__';
const ACTIVITIES_REST_SUFFIX = '/rest/v1/activities';
const REGULAR_FILTER = 'eq.regular';
const YEAR_2026_FILTER = 'in.(regular,summer_2026)';

function requestMethod(input, init) {
  const fromInit = String(init?.method || '').trim();
  if (fromInit) return fromInit.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return String(input.method || 'GET').toUpperCase();
  }
  return 'GET';
}

function rewrittenActivitiesUrl(input, init) {
  const method = requestMethod(input, init);
  if (method !== 'GET' && method !== 'HEAD') return null;

  const rawUrl = typeof Request !== 'undefined' && input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : String(input || '');
  if (!rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl, globalThis.location?.href);
  } catch {
    return null;
  }

  if (!url.pathname.endsWith(ACTIVITIES_REST_SUFFIX)) return null;
  if (url.searchParams.get('activity_season') !== REGULAR_FILTER) return null;

  url.searchParams.set('activity_season', YEAR_2026_FILTER);
  return url;
}

if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' && !globalThis[HOTFIX_FLAG]) {
  const previousFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = function activity2026SeasonFetch(input, init) {
    const rewrittenUrl = rewrittenActivitiesUrl(input, init);
    if (!rewrittenUrl) return previousFetch(input, init);

    if (typeof Request !== 'undefined' && input instanceof Request) {
      return previousFetch(new Request(rewrittenUrl.href, input), init);
    }
    if (input instanceof URL) return previousFetch(rewrittenUrl, init);
    return previousFetch(rewrittenUrl.href, init);
  };

  globalThis[HOTFIX_FLAG] = true;
}
