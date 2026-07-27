/*
 * Deduplicate identical heavy Supabase GET requests in the browser.
 *
 * This is intentionally limited to read-only endpoints that were observed to
 * repeat during dashboard/activity loading. Mutations are never delayed or
 * cached. Contact caches are invalidated whenever contacts_schools is changed.
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

  function policyFor(method, url) {
    if (!isSupabaseRest(url)) return null;
    const path = url.pathname;

    if (method !== 'GET') {
      if (path.endsWith('/rest/v1/contacts_schools')) return { invalidateContacts: true };
      return null;
    }

    if (path.endsWith('/rest/v1/activities')) {
      return { namespace: 'activities', ttlMs: 0 };
    }
    if (path.endsWith('/rest/v1/contacts_schools')) {
      return { namespace: 'contacts_schools', ttlMs: 60_000 };
    }
    if (path.endsWith('/rest/v1/contacts_unified_view')) {
      return { namespace: 'contacts_unified_view', ttlMs: 20_000 };
    }
    return null;
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

  function invalidateContactCaches() {
    for (const key of responseCache.keys()) {
      if (key.startsWith('contacts_schools|') || key.startsWith('contacts_unified_view|')) {
        responseCache.delete(key);
      }
    }
  }

  globalThis.fetch = async function deduplicatedFetch(input, init = {}) {
    const { method, url, headers } = requestMeta(input, init);
    const policy = policyFor(method, url);

    if (policy?.invalidateContacts) {
      invalidateContactCaches();
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
