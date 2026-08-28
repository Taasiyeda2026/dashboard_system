import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

/**
 * Keeps the proposal-list tab badge aligned with the rows actually shown after
 * the screen's existing search/filters run. The legacy screen calculates its
 * badge from the unfiltered payload, so a domain filter (for example E) can
 * leave the badge showing the global sent-proposals total.
 *
 * Explicitly archived proposals are also removed from the active proposal
 * table. They belong in the archive and must not inflate active list counts.
 */

const LIST_PANEL_SELECTOR = '[data-pa-all-proposals-table]';
const TAB_SELECTOR = '[data-pa-screen-tabs] [data-pa-tab]';
const ROW_SELECTOR = 'tbody tr[data-pa-row-id]';
const ARCHIVED_HIDDEN_ATTR = 'paArchivedCountHidden';
const REFRESH_ARCHIVE_AFTER_MS = 5 * 60 * 1000;

let archivedProposalIds = new Set();
let archiveLoadedAt = 0;
let archiveLoadPromise = null;
let syncQueued = false;

function activeListView() {
  const active = document.querySelector(`${TAB_SELECTOR}.is-active`);
  const value = String(active?.dataset?.paTab || '').trim();
  return value === 'records' || value === 'sent' ? value : '';
}

function restoreRowsNoLongerArchived(panel) {
  panel.querySelectorAll(`${ROW_SELECTOR}[data-${ARCHIVED_HIDDEN_ATTR.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="true"]`).forEach((row) => {
    const id = String(row.dataset.paRowId || '').trim();
    if (id && archivedProposalIds.has(id)) return;
    row.hidden = false;
    delete row.dataset[ARCHIVED_HIDDEN_ATTR];
  });
}

function syncActiveTabCount() {
  syncQueued = false;
  const panel = document.querySelector(LIST_PANEL_SELECTOR);
  if (!panel) return;

  const view = activeListView();
  if (!view) return;

  restoreRowsNoLongerArchived(panel);

  const rows = Array.from(panel.querySelectorAll(ROW_SELECTOR));
  let visibleCount = 0;

  rows.forEach((row) => {
    const id = String(row.dataset.paRowId || '').trim();
    if (id && archivedProposalIds.has(id)) {
      row.hidden = true;
      row.dataset[ARCHIVED_HIDDEN_ATTR] = 'true';
      return;
    }
    if (!row.hidden) visibleCount += 1;
  });

  const badge = document.querySelector(`[data-pa-tab-count="${view}"]`);
  if (badge && badge.textContent !== String(visibleCount)) {
    badge.textContent = String(visibleCount);
    badge.setAttribute('aria-label', `${visibleCount} תוצאות לפי הסינון הפעיל`);
  }
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  const run = () => window.requestAnimationFrame(syncActiveTabCount);
  if (typeof queueMicrotask === 'function') queueMicrotask(run);
  else Promise.resolve().then(run);
}

async function loadArchivedProposalIds({ force = false } = {}) {
  const now = Date.now();
  if (!force && archiveLoadedAt && now - archiveLoadedAt < REFRESH_ARCHIVE_AFTER_MS) {
    return archivedProposalIds;
  }
  if (archiveLoadPromise) return archiveLoadPromise;
  if (!supabase) return archivedProposalIds;

  archiveLoadPromise = (async () => {
    try {
      await waitForSupabaseAuthSession({ timeoutMs: 5000 });
      const { data, error } = await supabase
        .from('proposals_agreements')
        .select('id')
        .not('archived_at', 'is', null);
      if (error) throw error;
      archivedProposalIds = new Set(
        (Array.isArray(data) ? data : [])
          .map((row) => String(row?.id || '').trim())
          .filter(Boolean)
      );
      archiveLoadedAt = Date.now();
    } catch (error) {
      console.warn('[proposal-filtered-tab-count] archive lookup failed', error);
    } finally {
      archiveLoadPromise = null;
      queueSync();
    }
    return archivedProposalIds;
  })();

  return archiveLoadPromise;
}

function bindRuntime() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.__proposalFilteredTabCountRuntimeBound) return;
  window.__proposalFilteredTabCountRuntimeBound = true;

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target;
      if (!(target instanceof Element)) return true;
      return Boolean(
        target.closest?.(LIST_PANEL_SELECTOR)
        || target.matches?.('[data-pa-tab-count], [data-pa-screen-tabs]')
        || Array.from(mutation.addedNodes || []).some((node) => node instanceof Element && (
          node.matches?.(LIST_PANEL_SELECTOR)
          || node.querySelector?.(LIST_PANEL_SELECTOR)
          || node.matches?.('[data-pa-tab-count]')
          || node.querySelector?.('[data-pa-tab-count]')
        ))
      );
    });
    if (relevant) queueSync();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('input', (event) => {
    if (event.target?.closest?.(`${LIST_PANEL_SELECTOR} [data-pa-search], ${LIST_PANEL_SELECTOR} [data-pa-filter]`)) queueSync();
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target?.closest?.(`${LIST_PANEL_SELECTOR} [data-pa-filter], ${LIST_PANEL_SELECTOR} [data-pa-search]`)) queueSync();
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.(TAB_SELECTOR)) queueSync();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadArchivedProposalIds().catch(() => {});
    queueSync();
  });

  loadArchivedProposalIds().catch(() => {});
  queueSync();
}

bindRuntime();

export { activeListView, syncActiveTabCount, loadArchivedProposalIds };
