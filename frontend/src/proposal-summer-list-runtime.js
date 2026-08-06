const SUMMER_ALIASES = new Set(['summer', 'פעילויות קיץ', 'קיץ תשפ״ו', 'קיץ תשפו', 'קיץ']);
const PATCH_KEY = Symbol.for('taasiyeda.proposalSummerListRuntime');

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return text(value).replace(/[״"׳'`]/g, '').toLowerCase();
}

export function normalizeSummerProposalType(value) {
  const raw = text(value);
  return SUMMER_ALIASES.has(raw) || SUMMER_ALIASES.has(normalized(raw)) ? 'summer' : raw;
}

export function proposalTypeFromTableRow(row) {
  const explicit = text(row?.dataset?.paProposalType || row?.dataset?.proposalType);
  if (explicit) return normalizeSummerProposalType(explicit);
  const cells = Array.from(row?.cells || []);
  const visibleType = cells.map((cell) => text(cell.textContent)).find((value) => /קיץ|תשפ|גפ|סיור|משולב/.test(value));
  return normalizeSummerProposalType(visibleType);
}

function proposalScreen(node) {
  return node?.closest?.('.ds-pa-screen') || null;
}

function proposalTypeFilter(screen) {
  return screen?.querySelector?.('[data-pa-filter="activity_type_group"]') || null;
}

function summerTab(screen) {
  return screen?.querySelector?.('[data-pa-summer-tab]') || null;
}

function sentTab(screen) {
  return screen?.querySelector?.('[data-pa-tab="sent"]') || null;
}

function tableRows(screen) {
  return Array.from(screen?.querySelectorAll?.('[data-pa-table] tbody tr[data-pa-row-id]') || []);
}

function setTabClasses(screen, summerActive) {
  screen?.querySelectorAll?.('[data-pa-tab]').forEach((tab) => tab.classList.toggle('is-active', !summerActive && tab.dataset.paTab === 'sent'));
  summerTab(screen)?.classList.toggle('is-active', summerActive);
}

export function applySummerProposalListMode(screen) {
  if (!screen) return 0;
  const mode = text(screen.dataset.paProposalListMode) || 'regular';
  const selectedType = normalizeSummerProposalType(proposalTypeFilter(screen)?.value);
  const rows = tableRows(screen);
  let summerCount = 0;

  rows.forEach((row) => {
    const isSummer = proposalTypeFromTableRow(row) === 'summer';
    if (isSummer) summerCount += 1;

    if (mode === 'summer' || selectedType === 'summer') {
      row.hidden = !isSummer;
      return;
    }
    if (isSummer) row.hidden = true;
  });

  if (summerCount > 0) screen.dataset.paKnownSummerCount = String(summerCount);
  const output = screen.querySelector('[data-pa-summer-count]');
  if (output) output.textContent = String(summerCount || Number(screen.dataset.paKnownSummerCount || 0));
  return summerCount;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPagingCycle(button, screen, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!screen?.isConnected || !button?.isConnected) return;
    const current = screen.querySelector('[data-pa-load-more-proposals]');
    if (!current || current !== button || !current.disabled) return;
    await wait(80);
  }
}

export async function loadAllProposalPages(screen, { maxPages = 20 } = {}) {
  let loaded = 0;
  while (loaded < maxPages) {
    const button = screen?.querySelector?.('[data-pa-load-more-proposals]:not([disabled])');
    if (!button) break;
    button.click();
    loaded += 1;
    await waitForPagingCycle(button, screen);
    applySummerProposalListMode(screen);
  }
  return loaded;
}

export function leaveSummerProposalTab(screen, { clearSummerFilter = true } = {}) {
  if (!screen) return;
  const filter = proposalTypeFilter(screen);
  if (clearSummerFilter && normalizeSummerProposalType(filter?.value) === 'summer') filter.value = '';
  screen.dataset.paProposalListMode = 'regular';
  setTabClasses(screen, false);
  applySummerProposalListMode(screen);
}

export async function activateSummerProposalTab(screen) {
  if (!screen || screen.dataset.paSummerLoading === 'yes') return false;
  screen.dataset.paSummerLoading = 'yes';
  try {
    const filter = proposalTypeFilter(screen);
    if (filter) filter.value = 'summer';

    // Historical summer proposals are final proposals. The dedicated summer tab
    // therefore uses the sent list as its source and then applies the summer type.
    sentTab(screen)?.click();
    await wait(0);

    screen.dataset.paProposalListMode = 'summer';
    setTabClasses(screen, true);
    applySummerProposalListMode(screen);

    await loadAllProposalPages(screen);

    if (filter) filter.value = 'summer';
    screen.dataset.paProposalListMode = 'summer';
    setTabClasses(screen, true);
    applySummerProposalListMode(screen);
    return true;
  } finally {
    delete screen.dataset.paSummerLoading;
  }
}

function installEventGuards(documentRef) {
  documentRef.addEventListener('click', (event) => {
    const summerButton = event.target?.closest?.('[data-pa-summer-tab]');
    if (summerButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activateSummerProposalTab(proposalScreen(summerButton));
      return;
    }

    const regularTab = event.target?.closest?.('[data-pa-tab]');
    const screen = proposalScreen(regularTab);
    if (!screen || text(screen.dataset.paProposalListMode) !== 'summer') return;
    leaveSummerProposalTab(screen, { clearSummerFilter: true });
  }, true);

  documentRef.addEventListener('change', (event) => {
    const filter = event.target?.closest?.('[data-pa-filter="activity_type_group"]');
    if (!filter) return;
    const screen = proposalScreen(filter);
    if (!screen) return;

    if (normalizeSummerProposalType(filter.value) === 'summer') {
      event.preventDefault();
      event.stopImmediatePropagation();
      activateSummerProposalTab(screen);
      return;
    }

    if (text(screen.dataset.paProposalListMode) === 'summer') {
      leaveSummerProposalTab(screen, { clearSummerFilter: false });
    }
  }, true);
}

function installObserver(scope) {
  const documentRef = scope?.document;
  if (!documentRef?.documentElement || typeof scope.MutationObserver !== 'function') return;
  let queued = false;
  const schedule = (mutations = []) => {
    const relevant = !mutations.length || mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => (
      node instanceof scope.Element && (
        node.matches?.('.ds-pa-screen, [data-pa-table], tr[data-pa-row-id], [data-pa-summer-tab]')
        || node.querySelector?.('.ds-pa-screen, [data-pa-table], tr[data-pa-row-id], [data-pa-summer-tab]')
      )
    )));
    if (!relevant || queued) return;
    queued = true;
    const run = () => {
      queued = false;
      documentRef.querySelectorAll('.ds-pa-screen').forEach(applySummerProposalListMode);
    };
    if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(run);
    else scope.setTimeout(run, 0);
  };
  new scope.MutationObserver(schedule).observe(documentRef.getElementById('app') || documentRef.documentElement, { childList: true, subtree: true });
  schedule();
}

export function installProposalSummerListRuntime(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef[PATCH_KEY]) return false;
  installEventGuards(documentRef);
  installObserver(scope);
  Object.defineProperty(documentRef, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installProposalSummerListRuntime(globalThis);
