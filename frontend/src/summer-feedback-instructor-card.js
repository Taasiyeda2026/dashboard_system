import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const CYCLE_KEY = 'summer_2026';
const FEEDBACK_URL = './summer-feedback/';
const NAV_ATTRIBUTE = 'data-summer-feedback-nav-item';
const MOBILE_NAV_ATTRIBUTE = 'data-summer-feedback-mobile-nav-item';
const MOBILE_REPLACES_GUIDELINES_ATTRIBUTE = 'data-replaces-instructor-guidelines';
const STYLE_ID = 'summer-feedback-nav-styles';
const TEST_MODE_FLAG = '__SUMMER_FEEDBACK_INSTRUCTOR_CARD_TEST__';
const CACHE_TTL_MS = 30_000;
const REFRESH_INTERVAL_MS = 30_000;

let cachedUserId = '';
let cachedState = null;
let cachedAt = 0;
let statePromise = null;
let enhancementScheduled = false;
let enhancementVersion = 0;
let refreshTimer = null;

export function cycleIsOpen(cycle, now = Date.now()) {
  const opensAt = cycle?.opens_at ? new Date(cycle.opens_at).getTime() : null;
  const closesAt = cycle?.closes_at ? new Date(cycle.closes_at).getTime() : null;
  return cycle?.status === 'open'
    && (!opensAt || opensAt <= now)
    && (!closesAt || closesAt >= now);
}

function ensureNavStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .shell-nav__btn[${NAV_ATTRIBUTE}] {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 750;
    }
    .shell-nav__btn[${NAV_ATTRIBUTE}] .summer-feedback-nav__status {
      margin-inline-start: auto;
      min-width: 18px;
      color: #166534;
      font-size: 12px;
      text-align: center;
    }
    .instructor-bottom-nav__btn[${MOBILE_NAV_ATTRIBUTE}] .summer-feedback-mobile-nav__status {
      position: absolute;
      inset-block-start: 3px;
      inset-inline-end: 7px;
      display: grid;
      place-items: center;
      min-width: 15px;
      height: 15px;
      border-radius: 999px;
      background: #166534;
      color: #fff;
      font-size: 10px;
      line-height: 1;
    }
    .instructor-bottom-nav__btn[${MOBILE_NAV_ATTRIBUTE}] {
      position: relative;
    }
  `;
  document.head.append(style);
}

export function findSummerFeedbackNavHost(root = document) {
  return root.querySelector?.('.shell-sidebar .shell-nav') || null;
}

export function findSummerFeedbackMobileNavHost(root = document) {
  return root.querySelector?.('.instructor-bottom-nav') || null;
}

function navigateToSummerFeedback(button, doc = document) {
  const target = button?.dataset?.summerFeedbackHref || FEEDBACK_URL;
  const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (view) view.location.href = target;
}

export function createSummerFeedbackNavItem(navState = {}, doc = document) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'shell-nav__btn';
  button.setAttribute(NAV_ATTRIBUTE, 'true');
  button.setAttribute('aria-label', 'משוב קיץ');
  button.dataset.summerFeedbackHref = FEEDBACK_URL;
  button.innerHTML = `<span aria-hidden="true">☀</span><span>משוב קיץ</span>${
    navState.complete
      ? '<span class="summer-feedback-nav__status" aria-label="המשוב הושלם">✓</span>'
      : ''
  }`;
  button.addEventListener('click', () => navigateToSummerFeedback(button, doc));
  return button;
}

export function createSummerFeedbackMobileNavItem(navState = {}, doc = document) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'instructor-bottom-nav__btn';
  button.setAttribute(MOBILE_NAV_ATTRIBUTE, 'true');
  button.setAttribute('aria-label', 'משוב קיץ');
  button.dataset.summerFeedbackHref = FEEDBACK_URL;
  button.innerHTML = `
    <span class="instructor-bottom-nav__icon" aria-hidden="true">☀</span>
    <span class="instructor-bottom-nav__label">משוב</span>
    ${navState.complete ? '<span class="summer-feedback-mobile-nav__status" aria-label="המשוב הושלם">✓</span>' : ''}
  `;
  button.addEventListener('click', () => navigateToSummerFeedback(button, doc));
  return button;
}

function createInstructorGuidelinesMobileNavItem(doc = document) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'instructor-bottom-nav__btn';
  button.dataset.route = 'instructor-guidelines';
  button.setAttribute('aria-label', 'נהלים');
  button.innerHTML = '<span class="instructor-bottom-nav__icon" aria-hidden="true">📖</span><span class="instructor-bottom-nav__label">נהלים</span>';
  return button;
}

function updateSummerFeedbackNavItem(button, navState = {}) {
  if (!button) return;
  const complete = navState.complete === true;
  const hasCompleteStatus = Boolean(button.querySelector('.summer-feedback-nav__status'));
  if (complete === hasCompleteStatus) return;
  button.innerHTML = `<span aria-hidden="true">☀</span><span>משוב קיץ</span>${
    complete
      ? '<span class="summer-feedback-nav__status" aria-label="המשוב הושלם">✓</span>'
      : ''
  }`;
}

function updateSummerFeedbackMobileNavItem(button, navState = {}) {
  if (!button) return;
  const complete = navState.complete === true;
  const hasCompleteStatus = Boolean(button.querySelector('.summer-feedback-mobile-nav__status'));
  if (complete === hasCompleteStatus) return;
  button.innerHTML = `
    <span class="instructor-bottom-nav__icon" aria-hidden="true">☀</span>
    <span class="instructor-bottom-nav__label">משוב</span>
    ${complete ? '<span class="summer-feedback-mobile-nav__status" aria-label="המשוב הושלם">✓</span>' : ''}
  `;
}

export function injectSummerFeedbackNavItem(host, navState = {}) {
  if (!host?.isConnected) return false;
  const existing = host.querySelector(`[${NAV_ATTRIBUTE}]`);
  if (existing) {
    updateSummerFeedbackNavItem(existing, navState);
    return false;
  }

  const item = createSummerFeedbackNavItem(navState, host.ownerDocument || document);
  const preferredAnchor = host.querySelector('[data-route="my-data"]')
    || host.querySelector('[data-route="personal-reports"]');
  const firstExternal = host.querySelector('[data-external-url], [data-external-url-blank]');

  if (preferredAnchor) preferredAnchor.insertAdjacentElement('afterend', item);
  else if (firstExternal) host.insertBefore(item, firstExternal);
  else host.append(item);
  return true;
}

export function injectSummerFeedbackMobileNavItem(host, navState = {}) {
  if (!host?.isConnected) return false;
  const existing = host.querySelector(`[${MOBILE_NAV_ATTRIBUTE}]`);
  if (existing) {
    updateSummerFeedbackMobileNavItem(existing, navState);
    return false;
  }

  const item = createSummerFeedbackMobileNavItem(navState, host.ownerDocument || document);
  const guidelinesItem = host.querySelector('[data-route="instructor-guidelines"]');
  if (guidelinesItem) {
    item.setAttribute(MOBILE_REPLACES_GUIDELINES_ATTRIBUTE, 'true');
    guidelinesItem.replaceWith(item);
  } else {
    const attendanceItem = host.querySelector('[data-external-url]');
    if (attendanceItem) host.insertBefore(item, attendanceItem);
    else host.append(item);
  }
  return true;
}

function removeSummerFeedbackNavItems(root = document) {
  root.querySelectorAll?.(`[${NAV_ATTRIBUTE}]`).forEach((item) => item.remove());
  root.querySelectorAll?.(`[${MOBILE_NAV_ATTRIBUTE}]`).forEach((item) => {
    if (item.hasAttribute(MOBILE_REPLACES_GUIDELINES_ATTRIBUTE)) {
      item.replaceWith(createInstructorGuidelinesMobileNavItem(item.ownerDocument || document));
    } else {
      item.remove();
    }
  });
}

function clearCachedState() {
  cachedUserId = '';
  cachedState = null;
  cachedAt = 0;
  statePromise = null;
}

async function fetchCurrentSummerFeedbackNavState() {
  if (!supabase) return { visible: false, complete: false };

  const session = await waitForSupabaseAuthSession({ timeoutMs: 2500 });
  const userId = String(session?.user?.id || '').trim();
  if (!userId) return { visible: false, complete: false };

  const now = Date.now();
  if (cachedState && cachedUserId === userId && now - cachedAt < CACHE_TTL_MS) return cachedState;
  if (statePromise && cachedUserId === userId) return statePromise;

  cachedUserId = userId;
  statePromise = (async () => {
    const cycleResult = await supabase
      .from('summer_feedback_cycles')
      .select('id,status,opens_at,closes_at')
      .eq('cycle_key', CYCLE_KEY)
      .maybeSingle();

    if (cycleResult.error || !cycleIsOpen(cycleResult.data)) {
      return { visible: false, complete: false };
    }

    const cycleId = cycleResult.data.id;
    const [assignmentResult, responseResult] = await Promise.all([
      supabase
        .from('summer_feedback_assignments')
        .select('id')
        .eq('cycle_id', cycleId)
        .eq('instructor_auth_user_id', userId)
        .limit(1),
      supabase
        .from('summer_feedback_responses')
        .select('status')
        .eq('cycle_id', cycleId)
        .eq('instructor_auth_user_id', userId)
        .maybeSingle()
    ]);

    if (assignmentResult.error || responseResult.error) {
      return { visible: false, complete: false };
    }

    return {
      visible: Array.isArray(assignmentResult.data) && assignmentResult.data.length > 0,
      complete: responseResult.data?.status === 'submitted'
    };
  })();

  try {
    cachedState = await statePromise;
    cachedAt = Date.now();
    return cachedState;
  } catch (error) {
    console.warn('[summer-feedback] failed to load navigation eligibility', error);
    cachedState = { visible: false, complete: false };
    cachedAt = Date.now();
    return cachedState;
  } finally {
    statePromise = null;
  }
}

async function enhanceNavigationWithSummerFeedback() {
  if (typeof document === 'undefined') return;
  const sidebarHost = findSummerFeedbackNavHost(document);
  const mobileHost = findSummerFeedbackMobileNavHost(document);
  if (!sidebarHost && !mobileHost) return;

  const version = ++enhancementVersion;
  const navState = await fetchCurrentSummerFeedbackNavState();
  if (version !== enhancementVersion) return;

  if (!navState.visible) {
    removeSummerFeedbackNavItems(document);
    return;
  }

  ensureNavStyles();
  if (sidebarHost?.isConnected) injectSummerFeedbackNavItem(sidebarHost, navState);
  if (mobileHost?.isConnected) injectSummerFeedbackMobileNavItem(mobileHost, navState);
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(() => {
    enhancementScheduled = false;
    void enhanceNavigationWithSummerFeedback();
  });
}

function refreshFromServer() {
  clearCachedState();
  scheduleEnhancement();
}

function initializeSummerFeedbackInstructorNav() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  ensureNavStyles();

  const observer = new MutationObserver((mutations) => {
    const shellChanged = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        node?.nodeType === 1 && (
          node.matches?.('.app-shell, .shell-sidebar, .shell-nav, .instructor-bottom-nav')
          || node.querySelector?.('.shell-sidebar .shell-nav, .instructor-bottom-nav')
        )
      )
    );
    if (shellChanged) scheduleEnhancement();
  });
  observer.observe(document.getElementById('app') || document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener('app:navigate', scheduleEnhancement);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromServer();
  });
  window.addEventListener('focus', refreshFromServer);
  supabase?.auth?.onAuthStateChange?.(() => refreshFromServer());

  clearInterval(refreshTimer);
  refreshTimer = window.setInterval(refreshFromServer, REFRESH_INTERVAL_MS);
  scheduleEnhancement();
}

if (globalThis[TEST_MODE_FLAG] !== true) initializeSummerFeedbackInstructorNav();
