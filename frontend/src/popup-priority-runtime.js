import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

/**
 * Blocking dashboard popup priority:
 * 1. Birthday
 * 2. Gefen start reminder
 * 3. Admin-authored staff messages
 */
const POPUP_PRIORITY = Object.freeze(['birthday', 'gefen', 'admin']);
const HOLD_CLASS = 'dashboard-popup-priority-hold';
const STYLE_ID = 'dashboard-popup-priority-styles';
const JERUSALEM_TIME_ZONE = 'Asia/Jerusalem';
const GEFEN_SEASON = 'school_2027';
const GEFEN_LEAD_DAYS = 10;
const GEFEN_GATE_CACHE_MS = 10_000;

const SELECTORS = Object.freeze({
  birthday: '[data-birthday-popup-root]',
  gefen: '.gefen-start-reminder-overlay',
  admin: '.staff-message-popup-overlay'
});

const FOCUS_SELECTORS = Object.freeze({
  birthday: '.birthday-popup-confirm',
  gefen: '.gefen-start-reminder-action',
  admin: '.staff-message-popup-confirm'
});

let enforcementPromise = Promise.resolve();
let enforcementQueued = false;
let gefenGateCache = { key: '', at: 0, pending: false };

function normalize(value) {
  return String(value ?? '').trim();
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HOLD_CLASS} {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function popupElements(type) {
  return Array.from(document.querySelectorAll(SELECTORS[type]));
}

function hasPopup(type) {
  return Boolean(document.querySelector(SELECTORS[type]));
}

function setHeld(type, held) {
  popupElements(type).forEach((element) => {
    element.classList.toggle(HOLD_CLASS, Boolean(held));
    element.setAttribute('aria-hidden', held ? 'true' : 'false');
  });
}

function visiblePriorityType() {
  return POPUP_PRIORITY.find((type) => hasPopup(type)) || '';
}

function focusHighestPopup() {
  const type = visiblePriorityType();
  if (!type) return;

  const root = document.querySelector(SELECTORS[type]);
  const target = root?.querySelector(FOCUS_SELECTORS[type]);
  if (target && typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
  }
}

function reconcileVisibleStack() {
  const birthdayPresent = hasPopup('birthday');
  const gefenPresent = hasPopup('gefen');

  if (birthdayPresent) {
    setHeld('birthday', false);
    setHeld('gefen', true);
    setHeld('admin', true);
  } else if (gefenPresent) {
    setHeld('gefen', false);
    setHeld('admin', true);
  } else {
    setHeld('admin', false);
  }

  window.requestAnimationFrame(() => focusHighestPopup());
}

function waitForSelectorClear(selector, quietMs = 180) {
  if (!document.querySelector(selector)) {
    return new Promise((resolve) => window.setTimeout(resolve, quietMs));
  }

  return new Promise((resolve) => {
    let quietTimer = null;
    const observer = new MutationObserver(check);

    function finish() {
      if (quietTimer) window.clearTimeout(quietTimer);
      observer.disconnect();
      resolve();
    }

    function check() {
      if (document.querySelector(selector)) {
        if (quietTimer) window.clearTimeout(quietTimer);
        quietTimer = null;
        return;
      }

      if (quietTimer) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, quietMs);
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    check();
  });
}

function waitForSelector(selector, timeoutMs = 8000) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => finish(null), timeoutMs);

    function finish(value) {
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(value);
    }

    function check() {
      const element = document.querySelector(selector);
      if (element) finish(element);
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

async function ensureBirthdayTurnFinished() {
  try {
    const module = await import('./birthday-popup.js');
    if (typeof module.triggerBirthdayCheck === 'function') {
      await module.triggerBirthdayCheck();
    }
  } catch (error) {
    console.warn('[popup-priority] birthday check failed', error);
  }

  if (hasPopup('birthday')) {
    reconcileVisibleStack();
    await waitForSelectorClear(SELECTORS.birthday);
  }
}

function isEligibleGefenUser(user = state?.user) {
  const role = normalize(user?.role || user?.display_role).toLowerCase();
  return Boolean(user?.user_id) && role !== 'instructor';
}

function todayInJerusalem() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: JERUSALEM_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalize(value));
}

function dateOrdinal(isoDate) {
  if (!isIsoDate(isoDate)) return Number.NaN;
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function firstActivityDate(activity) {
  return [activity?.start_date, activity?.date_1]
    .map((value) => normalize(value))
    .filter(isIsoDate)
    .sort()[0] || '';
}

function isGefenDue(startDate, today) {
  if (!isIsoDate(startDate) || !isIsoDate(today)) return false;
  const daysUntilStart = dateOrdinal(startDate) - dateOrdinal(today);
  return daysUntilStart >= 0 && daysUntilStart <= GEFEN_LEAD_DAYS;
}

async function hasPendingGefenReminder() {
  if (!supabase || !isEligibleGefenUser()) return false;

  const session = await waitForSupabaseAuthSession({ timeoutMs: 8000 });
  const authUserId = normalize(session?.user?.id);

  if (!authUserId || !isEligibleGefenUser()) return false;

  const today = todayInJerusalem();
  const cacheKey = `${authUserId}:${today}`;

  if (
    gefenGateCache.key === cacheKey
    && (Date.now() - gefenGateCache.at) < GEFEN_GATE_CACHE_MS
  ) {
    return gefenGateCache.pending;
  }

  const { data: activities, error: activitiesError } = await supabase
    .from('activities')
    .select('id,funding,activity_season,start_date,date_1')
    .eq('activity_season', GEFEN_SEASON)
    .ilike('funding', '%גפן%')
    .or('start_date.not.is.null,date_1.not.is.null');

  if (activitiesError) throw activitiesError;

  const dueIds = (activities || [])
    .filter((activity) => activity?.activity_season === GEFEN_SEASON)
    .filter(
      (activity) => normalize(activity?.funding)
        .replace(/\s+/g, ' ') === 'גפן'
    )
    .map((activity) => ({
      id: activity.id,
      startDate: firstActivityDate(activity)
    }))
    .filter(
      (activity) => (
        activity.id != null
        && isGefenDue(activity.startDate, today)
      )
    )
    .map((activity) => activity.id);

  if (!dueIds.length) {
    gefenGateCache = {
      key: cacheKey,
      at: Date.now(),
      pending: false
    };
    return false;
  }

  const { data: acknowledgements, error: acknowledgementsError } = await supabase
    .from('gefen_start_reminder_acknowledgements')
    .select('activity_id')
    .eq('user_id', authUserId)
    .in('activity_id', dueIds);

  if (acknowledgementsError) throw acknowledgementsError;

  const acknowledgedIds = new Set(
    (acknowledgements || []).map((row) => Number(row.activity_id))
  );
  const pending = dueIds.some(
    (id) => !acknowledgedIds.has(Number(id))
  );

  gefenGateCache = {
    key: cacheKey,
    at: Date.now(),
    pending
  };
  return pending;
}

async function ensureGefenTurnFinished() {
  if (hasPopup('gefen')) {
    reconcileVisibleStack();
    await waitForSelectorClear(SELECTORS.gefen);
    gefenGateCache.at = 0;
    return;
  }

  let pending = false;
  try {
    pending = await hasPendingGefenReminder();
  } catch (error) {
    console.warn('[popup-priority] Gefen pending check failed', error);
    return;
  }

  if (!pending) return;

  // Ask the existing Gefen runtime to run its normal check.
  window.dispatchEvent(new Event('focus'));

  const popup = await waitForSelector(SELECTORS.gefen, 8000);
  if (!popup) return;

  reconcileVisibleStack();
  await waitForSelectorClear(SELECTORS.gefen);
  gefenGateCache.at = 0;
}

async function enforcePriorityOrder() {
  reconcileVisibleStack();

  if (hasPopup('gefen') || hasPopup('admin')) {
    await ensureBirthdayTurnFinished();
    reconcileVisibleStack();
  }

  if (hasPopup('birthday')) return;

  if (hasPopup('gefen')) {
    reconcileVisibleStack();
    return;
  }

  if (hasPopup('admin')) {
    setHeld('admin', true);
    await ensureGefenTurnFinished();
    reconcileVisibleStack();
  }
}

function queueEnforcement() {
  if (enforcementQueued) return;

  enforcementQueued = true;
  enforcementPromise = enforcementPromise
    .catch(() => {})
    .then(async () => {
      enforcementQueued = false;
      await enforcePriorityOrder();
    })
    .catch((error) => {
      console.warn('[popup-priority] enforcement failed', error);
      reconcileVisibleStack();
    });
}

function inspectAddedNode(node) {
  if (!(node instanceof Element)) return;

  for (const selector of [SELECTORS.gefen, SELECTORS.admin]) {
    if (node.matches(selector)) {
      node.classList.add(HOLD_CLASS);
    }
    node.querySelectorAll?.(selector).forEach((element) => {
      element.classList.add(HOLD_CLASS);
    });
  }

  if (
    node.matches(SELECTORS.birthday)
    || node.querySelector?.(SELECTORS.birthday)
  ) {
    setHeld('gefen', true);
    setHeld('admin', true);
  }
}

function startPopupPriorityRuntime() {
  if (globalThis.__DASHBOARD_POPUP_PRIORITY_RUNTIME_STARTED__) return;
  globalThis.__DASHBOARD_POPUP_PRIORITY_RUNTIME_STARTED__ = true;

  ensureStyles();

  popupElements('gefen').forEach((element) => {
    element.classList.add(HOLD_CLASS);
  });
  popupElements('admin').forEach((element) => {
    element.classList.add(HOLD_CLASS);
  });

  reconcileVisibleStack();

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' && event.key !== 'Escape') return;

    const type = visiblePriorityType();
    if (!type) return;

    const lowerExists = POPUP_PRIORITY
      .slice(POPUP_PRIORITY.indexOf(type) + 1)
      .some((lowerType) => hasPopup(lowerType));

    if (!lowerExists) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    focusHighestPopup();
  }, true);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach(inspectAddedNode);
    });

    reconcileVisibleStack();
    queueEnforcement();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  queueEnforcement();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      startPopupPriorityRuntime,
      { once: true }
    );
  } else {
    startPopupPriorityRuntime();
  }
}

export {
  GEFEN_LEAD_DAYS,
  GEFEN_SEASON,
  POPUP_PRIORITY,
  SELECTORS,
  firstActivityDate,
  isGefenDue,
  visiblePriorityType
};
