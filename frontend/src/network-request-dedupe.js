/*
 * Deduplicate identical Supabase GET requests that are already in flight.
 *
 * No response body is buffered, copied or retained. Each caller receives a
 * lightweight clone of the native response, while a later request always goes
 * back to the server/application data layer as usual.
 */
(function installNetworkRequestDedupe() {
  'use strict';

  if (globalThis.__dsNetworkRequestDedupeInstalled) return;
  const nativeFetch = typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;
  if (!nativeFetch || typeof Headers === 'undefined') return;

  globalThis.__dsNetworkRequestDedupeInstalled = true;

  const inflight = new Map();

  const READ_NAMESPACES = new Map([
    ['activities', 'activities'],
    ['activity_meetings', 'activity_meetings'],
    ['activity_completion_approval_uploads', 'completion_approvals'],
    ['activity_school_contact_responsibles', 'school_contacts'],
    ['instructor_schedule_print_contacts', 'school_contacts'],
    ['contacts_instructors', 'contacts'],
    ['contacts_schools', 'contacts'],
    ['contacts_unified_view', 'contacts'],
    ['schools', 'contacts'],
    ['authorities', 'contacts'],
    ['proposals_agreements_directory_view', 'proposals'],
    ['proposal_agreement_items', 'proposals'],
    ['proposal_linked_documents', 'proposals'],
    ['proposal_activity_pricing', 'proposal_catalog'],
    ['proposal_gefen_courses', 'proposal_catalog'],
    ['proposal_template_sections', 'proposal_catalog'],
    ['proposal_activity_groups', 'proposal_catalog'],
    ['proposal_group_aliases', 'proposal_catalog'],
    ['school_calendar', 'proposal_catalog'],
    ['lists', 'lists']
  ]);

  function isRequest(value) {
    return typeof Request !== 'undefined' && value instanceof Request;
  }

  function requestMeta(input, init = {}) {
    const request = isRequest(input) ? input : null;
    const rawUrl = request?.url || String(input || '');
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    let url = null;
    try {
      url = new URL(rawUrl, globalThis.location?.href || 'http://localhost/');
    } catch {
      return { method, url: null, headers: new Headers() };
    }

    const headers = new Headers(request?.headers || undefined);
    new Headers(init.headers || undefined).forEach((value, key) => headers.set(key, value));
    return { method, url, headers };
  }

  function isSupabaseRest(url) {
    return Boolean(url && /\.supabase\.co$/i.test(url.hostname) && url.pathname.includes('/rest/v1/'));
  }

  function tableName(url) {
    if (!isSupabaseRest(url)) return '';
    const marker = '/rest/v1/';
    const index = url.pathname.indexOf(marker);
    return index >= 0 ? decodeURIComponent(url.pathname.slice(index + marker.length)).split('/')[0] : '';
  }

  function namespaceFor(method, url) {
    if (method !== 'GET') return '';
    return READ_NAMESPACES.get(tableName(url)) || '';
  }

  function requestKey(namespace, method, url, headers) {
    return [
      namespace,
      method,
      url.href,
      headers.get('range') || '',
      headers.get('accept-profile') || '',
      headers.get('content-profile') || '',
      headers.get('authorization') || ''
    ].join('|');
  }

  globalThis.fetch = async function deduplicatedFetch(input, init = {}) {
    const { method, url, headers } = requestMeta(input, init);
    const namespace = namespaceFor(method, url);

    if (!namespace || init?.signal?.aborted) {
      return nativeFetch(input, init);
    }

    const key = requestKey(namespace, method, url, headers);
    let requestPromise = inflight.get(key);
    if (!requestPromise) {
      requestPromise = nativeFetch(input, init)
        .finally(() => inflight.delete(key));
      inflight.set(key, requestPromise);
    }

    const response = await requestPromise;
    return response.clone();
  };
})();
