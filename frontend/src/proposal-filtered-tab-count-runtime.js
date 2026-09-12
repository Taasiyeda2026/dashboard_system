import './proposal-client-back-button-layout.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

/**
 * Keeps proposal-list tab badges correct while the list itself stays paginated.
 *
 * Unfiltered list:
 * - badges come from exact server-side counts over all active proposals, so the
 *   first 50-row page never makes the badges look like partial totals.
 * - loading another page does not increase the total badges.
 *
 * Filtered/search list:
 * - preserves the existing behaviour: the active badge reflects the rows that
 *   are currently visible after the screen's client-side filters run.
 *
 * Explicitly archived proposals are removed from the active proposal table and
 * are excluded from the exact server totals.
 */

const LIST_PANEL_SELECTOR = '[data-pa-all-proposals-table]';
const TAB_SELECTOR = '[data-pa-screen-tabs] [data-pa-tab]';
const ROW_SELECTOR = 'tbody tr[data-pa-row-id]';
const ARCHIVED_HIDDEN_ATTR = 'paArchivedCountHidden';
const REFRESH_ARCHIVE_AFTER_MS = 5 * 60 * 1000;
const EXACT_COUNT_REFRESH_AFTER_MS = 30 * 1000;
const EXACT_COUNT_REFRESH_DEBOUNCE_MS = 350;

let archivedProposalIds = new Set();
let archiveLoadedAt = 0;
let archiveLoadPromise = null;
let exactTabCounts = null;
let exactCountsLoadedAt = 0;
let exactCountsLoadPromise = null;
let exactCountRefreshTimer = null;
let syncQueued = false;

function activeListView() {
  const active = document.querySelector(`${TAB_SELECTOR}.is-active`);
  const value = String(active?.dataset?.paTab || '').trim();
  return value === 'records' || value === 'sent' ? value : '';
}

export function hasActiveProposalListFilters(panel) {
  if (!panel) return false;
  const search = String(panel.querySelector?.('[data-pa-search]')?.value || '').trim();
  if (search) return true;
  return Array.from(panel.querySelectorAll?.('[data-pa-filter]') || [])
    .some((control) => String(control?.value || '').trim() !== '');
}

function proposalScreenFor(panel) {
  return panel?.closest?.('.ds-pa-screen') || document;
}

function setTabBadge(screen, view, count, ariaLabel) {
  const badge = screen?.querySelector?.(`[data-pa-tab-count="${view}"]`);
  if (!badge) return false;
  const next = String(Math.max(0, Number(count) || 0));
  if (badge.textContent !== next) badge.textContent = next;
  if (ariaLabel) badge.setAttribute('aria-label', ariaLabel);
  return true;
}

export function applyExactProposalTabCounts(panel, counts = exactTabCounts) {
  if (!panel || !counts || hasActiveProposalListFilters(panel)) return false;
  const screen = proposalScreenFor(panel);
  const records = Math.max(0, Number(counts.records) || 0);
  const sent = Math.max(0, Number(counts.sent) || 0);
  const recordsApplied = setTabBadge(screen, 'records', records, `${records} רשומות פעילות`);
  const sentApplied = setTabBadge(screen, 'sent', sent, `${sent} הצעות שנשלחו`);
  return recordsApplied || sentApplied;
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

  restoreRowsNoLongerArchived(panel);

  // In the normal unfiltered list, both badges are true database totals and do
  // not depend on how many 50-row pages the user has loaded.
  if (!hasActiveProposalListFilters(panel) && applyExactProposalTabCounts(panel)) return;

  // Preserve the pre-existing filtered/search behaviour. This intentionally
  // counts only visible rows while a client-side filter is active.
  const view = activeListView();
  if (!view) return;

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

  const badge = proposalScreenFor(panel).querySelector(`[data-pa-tab-count="${view}"]`);
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

export async function loadExactProposalTabCounts({ force = false } = {}) {
  const now = Date.now();
  if (!force && exactTabCounts && exactCountsLoadedAt && now - exactCountsLoadedAt < EXACT_COUNT_REFRESH_AFTER_MS) {
    return exactTabCounts;
  }
  if (exactCountsLoadPromise) return exactCountsLoadPromise;
  if (!supabase) return exactTabCounts;

  exactCountsLoadPromise = (async () => {
    try {
      await waitForSupabaseAuthSession({ timeoutMs: 5000 });
      const [activeResult, sentResult] = await Promise.all([
        supabase
          .from('proposals_agreements_directory_view')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null),
        supabase
          .from('proposals_agreements_directory_view')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null)
          .eq('status', 'sent')
      ]);
      if (activeResult.error) throw activeResult.error;
      if (sentResult.error) throw sentResult.error;

      const total = Number.isFinite(activeResult.count) ? Number(activeResult.count) : 0;
      const sent = Number.isFinite(sentResult.count) ? Number(sentResult.count) : 0;
      exactTabCounts = {
        total,
        sent,
        records: Math.max(total - sent, 0)
      };
      exactCountsLoadedAt = Date.now();
    } catch (error) {
      console.warn('[proposal-filtered-tab-count] exact count lookup failed', error);
    } finally {
      exactCountsLoadPromise = null;
      queueSync();
    }
    return exactTabCounts;
  })();

  return exactCountsLoadPromise;
}

function scheduleExactCountRefresh() {
  if (exactCountRefreshTimer) clearTimeout(exactCountRefreshTimer);
  exactCountRefreshTimer = setTimeout(() => {
    exactCountRefreshTimer = null;
    const panel = document.querySelector(LIST_PANEL_SELECTOR);
    if (!panel || hasActiveProposalListFilters(panel)) return;
    loadExactProposalTabCounts({ force: true }).catch(() => {});
  }, EXACT_COUNT_REFRESH_DEBOUNCE_MS);
}

function mutationTouchesProposalRows(mutation) {
  const nodes = [
    ...(mutation.addedNodes || []),
    ...(mutation.removedNodes || [])
  ];
  return nodes.some((node) => node instanceof Element && (
    node.matches?.(ROW_SELECTOR)
    || node.querySelector?.(ROW_SELECTOR)
  ));
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
    if (!relevant) return;
    queueSync();
    if (mutations.some(mutationTouchesProposalRows)) scheduleExactCountRefresh();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('input', (event) => {
    if (event.target?.closest?.(`${LIST_PANEL_SELECTOR} [data-pa-search], ${LIST_PANEL_SELECTOR} [data-pa-filter]`)) queueSync();
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target?.closest?.(`${LIST_PANEL_SELECTOR} [data-pa-filter], ${LIST_PANEL_SELECTOR} [data-pa-search]`)) {
      queueSync();
      const panel = document.querySelector(LIST_PANEL_SELECTOR);
      if (panel && !hasActiveProposalListFilters(panel)) loadExactProposalTabCounts().catch(() => {});
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.(TAB_SELECTOR)) queueSync();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadArchivedProposalIds().catch(() => {});
    loadExactProposalTabCounts({ force: true }).catch(() => {});
    queueSync();
  });

  loadArchivedProposalIds().catch(() => {});
  loadExactProposalTabCounts().catch(() => {});
  queueSync();
}

bindRuntime();

export {
  activeListView,
  syncActiveTabCount,
  loadArchivedProposalIds
};
