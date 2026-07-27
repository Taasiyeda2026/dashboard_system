/*
 * Production hotfix for activity saves.
 *
 * 1. Provides the missing global `changes` binding referenced by the activities
 *    after-save callback, preventing a false error after Supabase already saved.
 * 2. Gives activity writes priority over known heavy background reads so the
 *    PATCH request is not left waiting behind full-table prefetch traffic.
 */
var changes = null; // Intentional global binding for the current activities.js callback.

(function installActivitySavePriorityHotfix() {
  'use strict';

  if (globalThis.__activitySavePriorityHotfixInstalled) return;
  const nativeFetch = typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;
  if (!nativeFetch) return;

  globalThis.__activitySavePriorityHotfixInstalled = true;

  const heavyReadControllers = new Set();
  let savePriorityUntil = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function requestMeta(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const rawUrl = request?.url || String(input || '');
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    let url = null;
    try {
      url = new URL(rawUrl, globalThis.location?.href || 'http://localhost/');
    } catch {
      // Leave url null for malformed/non-standard requests.
    }
    return { method, url };
  }

  function isSupabaseRest(url) {
    return Boolean(url && /\.supabase\.co$/i.test(url.hostname) && url.pathname.includes('/rest/v1/'));
  }

  function isActivityWrite(method, url) {
    return isSupabaseRest(url)
      && url.pathname.endsWith('/rest/v1/activities')
      && ['PATCH', 'POST', 'DELETE'].includes(method);
  }

  function isHeavyBackgroundRead(method, url) {
    if (method !== 'GET' || !isSupabaseRest(url)) return false;

    if (url.pathname.endsWith('/rest/v1/activities')) {
      const select = String(url.searchParams.get('select') || '').trim();
      const hasRowFilter = url.searchParams.has('row_id') || url.searchParams.has('id');
      return select === '*' && !hasRowFilter;
    }

    if (url.pathname.endsWith('/rest/v1/contacts_schools')) return true;
    if (url.pathname.endsWith('/rest/v1/contacts_unified_view')) return true;

    return false;
  }

  function beginSavePriority() {
    savePriorityUntil = Date.now() + 60000;
    for (const controller of heavyReadControllers) {
      try {
        controller.abort('activity_save_priority');
      } catch {
        // Ignore browsers that reject an abort reason.
        try { controller.abort(); } catch { /* ignore */ }
      }
    }
    heavyReadControllers.clear();
  }

  function endSavePriority() {
    savePriorityUntil = Date.now() + 500;
  }

  async function waitForSavePriorityToEnd() {
    const startedAt = Date.now();
    while (Date.now() < savePriorityUntil && Date.now() - startedAt < 65000) {
      await sleep(100);
    }
  }

  function combinedSignal(existingSignal, controller) {
    if (!existingSignal) return controller.signal;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      return AbortSignal.any([existingSignal, controller.signal]);
    }
    return existingSignal;
  }

  globalThis.fetch = async function activitySavePriorityFetch(input, init = {}) {
    const { method, url } = requestMeta(input, init);
    const heavyRead = isHeavyBackgroundRead(method, url);
    const activityWrite = isActivityWrite(method, url);

    if (heavyRead && Date.now() < savePriorityUntil) {
      await waitForSavePriorityToEnd();
    }

    let controller = null;
    let nextInit = init;
    if (heavyRead) {
      controller = new AbortController();
      const signal = combinedSignal(init?.signal || (input instanceof Request ? input.signal : null), controller);
      nextInit = { ...init, signal };
      if (signal === controller.signal || (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function')) {
        heavyReadControllers.add(controller);
      }
    }

    try {
      const response = await nativeFetch(input, nextInit);
      if (activityWrite) endSavePriority();
      return response;
    } catch (error) {
      if (activityWrite) endSavePriority();
      throw error;
    } finally {
      if (controller) heavyReadControllers.delete(controller);
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-action="save-edit"]')) beginSavePriority();
    }, true);

    document.addEventListener('submit', (event) => {
      if (event.target?.matches?.('[data-drawer-form]')) beginSavePriority();
    }, true);
  }
})();
