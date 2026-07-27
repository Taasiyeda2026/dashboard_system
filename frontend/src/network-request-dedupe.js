/*
 * Deduplicate and briefly cache identical heavy Supabase GET requests.
 *
 * The cache is deliberately limited to read-only catalog/list endpoints used by
 * activities and the client file. Mutations always go to the network and clear
 * the related cached responses so edited data is never hidden by the cache.
 */
(function installNetworkRequestDedupe() {
  'use strict';

  if (globalThis.__dsNetworkRequestDedupeInstalled) return;
  const nativeFetch = typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;
  if (!nativeFetch || typeof Response === 'undefined' || typeof Headers === 'undefined') return;

  globalThis.__dsNetworkRequestDedupeInstalled = true;

  const inflight = new Map();
  const responseCache = new Map();

  const READ_POLICIES = new Map([
    ['activities', { namespace: 'activities', ttlMs: 5 * 60_000 }],
    ['activity_meetings', { namespace: 'activity_meetings', ttlMs: 60_000 }],
    ['contacts_schools', { namespace: 'contacts', ttlMs: 5 * 60_000 }],
    ['contacts_unified_view', { namespace: 'contacts', ttlMs: 5 * 60_000 }],
    ['schools', { namespace: 'contacts', ttlMs: 10 * 60_000 }],
    ['authorities', { namespace: 'contacts', ttlMs: 10 * 60_000 }],
    ['proposals_agreements_directory_view', { namespace: 'proposals', ttlMs: 2 * 60_000 }],
    ['proposal_agreement_items', { namespace: 'proposals', ttlMs: 2 * 60_000 }],
    ['proposal_linked_documents', { namespace: 'proposals', ttlMs: 2 * 60_000 }],
    ['proposal_activity_pricing', { namespace: 'proposal_catalog', ttlMs: 10 * 60_000 }],
    ['proposal_gefen_courses', { namespace: 'proposal_catalog', ttlMs: 10 * 60_000 }],
    ['proposal_template_sections', { namespace: 'proposal_catalog', ttlMs: 10 * 60_000 }],
    ['proposal_activity_groups', { namespace: 'proposal_catalog', ttlMs: 10 * 60_000 }],
    ['proposal_group_aliases', { namespace: 'proposal_catalog', ttlMs: 10 * 60_000 }],
    ['school_calendar', { namespace: 'proposal_catalog', ttlMs: 10 * 60_000 }],
    ['lists', { namespace: 'lists', ttlMs: 10 * 60_000 }]
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

  function invalidationNamespaces(table) {
    if (table === 'activities') return ['activities'];
    if (table === 'activity_meetings') return ['activity_meetings', 'activities'];
    if (table === 'contacts_schools' || table === 'schools' || table === 'authorities') return ['contacts', 'proposals'];
    if (table === 'proposals_agreements' || table === 'proposal_agreement_items' || table === 'proposal_linked_documents') return ['proposals'];
    if (table.startsWith('proposal_') || table === 'school_calendar' || table === 'lists') return ['proposal_catalog', 'proposals', 'lists'];
    return [];
  }

  function policyFor(method, url) {
    const table = tableName(url);
    if (!table) return null;
    if (method !== 'GET') return { invalidate: invalidationNamespaces(table) };
    return READ_POLICIES.get(table) || null;
  }

  function cacheKey(namespace, method, url, headers) {
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

  function copyBuffer(buffer) {
    return buffer.slice(0);
  }

  async function snapshotResponse(response) {
    const body = await response.arrayBuffer();
    return {
      body,
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries())
    };
  }

  function responseFromSnapshot(snapshot) {
    return new Response(copyBuffer(snapshot.body), {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers
    });
  }

  function invalidateNamespaces(namespaces) {
    const names = new Set(Array.isArray(namespaces) ? namespaces : []);
    if (!names.size) return;
    for (const key of responseCache.keys()) {
      const namespace = key.split('|', 1)[0];
      if (names.has(namespace)) responseCache.delete(key);
    }
  }

  globalThis.fetch = async function deduplicatedFetch(input, init = {}) {
    const { method, url, headers } = requestMeta(input, init);
    const policy = policyFor(method, url);

    if (policy?.invalidate?.length) {
      invalidateNamespaces(policy.invalidate);
      return nativeFetch(input, init);
    }
    if (!policy?.namespace || init?.signal?.aborted) {
      return nativeFetch(input, init);
    }

    const key = cacheKey(policy.namespace, method, url, headers);
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return responseFromSnapshot(cached.snapshot);
    }
    if (cached) responseCache.delete(key);

    let requestPromise = inflight.get(key);
    if (!requestPromise) {
      requestPromise = nativeFetch(input, init)
        .then(snapshotResponse)
        .then((snapshot) => {
          if (policy.ttlMs > 0 && snapshot.status >= 200 && snapshot.status < 300) {
            responseCache.set(key, { snapshot, expiresAt: Date.now() + policy.ttlMs });
          }
          return snapshot;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, requestPromise);
    }

    const snapshot = await requestPromise;
    return responseFromSnapshot(snapshot);
  };
})();
