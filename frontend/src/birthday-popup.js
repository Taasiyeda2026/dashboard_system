import './styles/birthday-popup.css';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';
const POPUP_ROOT_SELECTOR = '[data-birthday-popup-root]';
const PREVIEW_QUERY_PARAM = 'birthday_preview';
const CHECK_INTERVAL_MS = 60_000;
const SHELL_WAIT_TIMEOUT_MS = 15_000;

const checkedRunKeys = new Set();
let activeRunKey = '';
let activeSessionUserId = '';
let activeQueue = [];
let activeBirthdayYear = null;
let checkPromise = null;
let shellWaitTimer = null;

function israelDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    year,
    month,
    day,
    dateKey: `${values.year}-${values.month}-${values.day}`
  };
}

function resolveBirthdayImagePath(path) {
  const cleaned = String(path || '').trim().replace(/^\/+/, '');
  if (!cleaned) return '';
  try {
    return new URL(cleaned, document.baseURI).href;
  } catch {
    return cleaned;
  }
}

function birthdayPreviewSlug() {
  if (typeof window === 'undefined') return '';
  try {
    return String(new URL(window.location.href).searchParams.get(PREVIEW_QUERY_PARAM) || '').trim();
  } catch {
    return '';
  }
}

function clearBirthdayPreviewParam() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(PREVIEW_QUERY_PARAM);
    window.history.replaceState({}, '', url);
  } catch {
    // Ignore URL parsing failures.
  }
}

function closeBirthdayPopup() {
  const root = document.querySelector(POPUP_ROOT_SELECTOR);
  if (root) root.remove();
  document.body.classList.remove('birthday-popup-open');
}

function waitForAuthenticatedShell(timeoutMs = SHELL_WAIT_TIMEOUT_MS) {
  if (document.querySelector('.app-shell')) return Promise.resolve(true);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const finish = (value) => {
      if (shellWaitTimer) clearInterval(shellWaitTimer);
      shellWaitTimer = null;
      resolve(value);
    };
    shellWaitTimer = setInterval(() => {
      if (document.querySelector('.app-shell')) {
        finish(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) finish(false);
    }, 120);
  });
}

async function fetchBirthdayPreview(employeeSlug) {
  const { data, error } = await supabase
    .from('employee_birthdays')
    .select('id,employee_name,employee_slug,image_path,display_order')
    .eq('employee_slug', employeeSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function fetchPendingBirthdays(userId, dateParts) {
  const { data: birthdays, error: birthdaysError } = await supabase
    .from('employee_birthdays')
    .select('id,employee_name,employee_slug,image_path,display_order')
    .eq('is_active', true)
    .eq('birth_day', dateParts.day)
    .eq('birth_month', dateParts.month)
    .order('display_order', { ascending: true })
    .order('employee_name', { ascending: true });

  if (birthdaysError) throw birthdaysError;
  if (!Array.isArray(birthdays) || birthdays.length === 0) return [];

  const birthdayIds = birthdays.map((birthday) => birthday.id).filter(Boolean);
  const { data: acknowledgements, error: acknowledgementsError } = await supabase
    .from('birthday_popup_acknowledgements')
    .select('birthday_id')
    .eq('viewer_auth_user_id', userId)
    .eq('birthday_year', dateParts.year)
    .in('birthday_id', birthdayIds);

  if (acknowledgementsError) throw acknowledgementsError;
  const acknowledgedIds = new Set((acknowledgements || []).map((row) => row.birthday_id));
  return birthdays.filter((birthday) => !acknowledgedIds.has(birthday.id));
}

async function saveBirthdayAcknowledgement(userId, birthdayId, birthdayYear) {
  const payload = {
    viewer_auth_user_id: userId,
    birthday_id: birthdayId,
    birthday_year: birthdayYear,
    acknowledged_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('birthday_popup_acknowledgements')
    .upsert(payload, {
      onConflict: 'viewer_auth_user_id,birthday_id,birthday_year',
      ignoreDuplicates: true
    });

  if (error && error.code !== '23505') throw error;
}

function createBirthdayPopupElement(birthday, { preview = false } = {}) {
  const root = document.createElement('div');
  root.className = 'birthday-popup-overlay';
  root.dataset.birthdayPopupRoot = 'true';
  root.setAttribute('dir', 'rtl');

  const dialog = document.createElement('section');
  dialog.className = 'birthday-popup-card';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `ברכת יום הולדת ל${birthday.employee_name}`);

  const inner = document.createElement('div');
  inner.className = 'birthday-popup-card__inner';

  const image = document.createElement('img');
  image.className = 'birthday-popup-image';
  image.src = resolveBirthdayImagePath(birthday.image_path);
  image.alt = `מזל טוב ל${birthday.employee_name}`;
  image.decoding = 'async';

  const actions = document.createElement('div');
  actions.className = 'birthday-popup-actions';

  const errorText = document.createElement('p');
  errorText.className = 'birthday-popup-error';
  errorText.hidden = true;
  errorText.setAttribute('role', 'alert');

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'birthday-popup-confirm';
  confirmButton.textContent = 'אישור';

  actions.append(errorText, confirmButton);
  inner.append(image, actions);
  dialog.append(inner);
  root.append(dialog);

  confirmButton.addEventListener('click', async () => {
    if (confirmButton.disabled) return;

    if (preview) {
      closeBirthdayPopup();
      clearBirthdayPreviewParam();
      activeQueue = [];
      activeRunKey = '';
      return;
    }

    confirmButton.disabled = true;
    confirmButton.textContent = 'שומר…';
    errorText.hidden = true;

    try {
      await saveBirthdayAcknowledgement(activeSessionUserId, birthday.id, activeBirthdayYear);
      activeQueue.shift();
      closeBirthdayPopup();
      showNextBirthdayPopup();
    } catch (error) {
      console.error('[birthday-popup] acknowledgement failed', error);
      confirmButton.disabled = false;
      confirmButton.textContent = 'אישור';
      errorText.textContent = 'לא ניתן לשמור את האישור. נסו שוב.';
      errorText.hidden = false;
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      confirmButton.focus();
    }
  });

  return { root, confirmButton };
}

function mountBirthdayPopup(birthday, options = {}) {
  closeBirthdayPopup();
  const { root, confirmButton } = createBirthdayPopupElement(birthday, options);
  document.body.appendChild(root);
  document.body.classList.add('birthday-popup-open');
  window.requestAnimationFrame(() => confirmButton.focus({ preventScroll: true }));
}

function showNextBirthdayPopup() {
  closeBirthdayPopup();
  const birthday = activeQueue[0];
  if (!birthday) {
    activeRunKey = '';
    return;
  }
  mountBirthdayPopup(birthday);
}

async function showBirthdayPreview(employeeSlug) {
  const shellReady = await waitForAuthenticatedShell();
  if (!shellReady) return false;
  const birthday = await fetchBirthdayPreview(employeeSlug);
  if (!birthday) return false;
  activeRunKey = `preview:${employeeSlug}`;
  mountBirthdayPopup(birthday, { preview: true });
  return true;
}

async function runBirthdayCheck(session) {
  const userId = String(session?.user?.id || '').trim();
  if (!userId || !supabase) return;

  const dateParts = israelDateParts();
  const runKey = `${userId}:${dateParts.dateKey}`;
  if (checkedRunKeys.has(runKey) || activeRunKey === runKey) return;

  checkedRunKeys.add(runKey);
  activeRunKey = runKey;
  activeSessionUserId = userId;
  activeBirthdayYear = dateParts.year;

  try {
    const shellReady = await waitForAuthenticatedShell();
    if (!shellReady) {
      activeRunKey = '';
      checkedRunKeys.delete(runKey);
      return;
    }

    const pendingBirthdays = await fetchPendingBirthdays(userId, dateParts);
    if (!pendingBirthdays.length) {
      activeRunKey = '';
      return;
    }

    activeQueue = pendingBirthdays;
    showNextBirthdayPopup();
  } catch (error) {
    console.error('[birthday-popup] check failed', error);
    activeRunKey = '';
    checkedRunKeys.delete(runKey);
  }
}

async function triggerBirthdayCheck(sessionOverride = null) {
  if (!supabase || checkPromise) return checkPromise;
  checkPromise = (async () => {
    const session = sessionOverride || (await supabase.auth.getSession()).data?.session || null;
    if (!session?.user?.id) {
      activeSessionUserId = '';
      activeQueue = [];
      activeRunKey = '';
      closeBirthdayPopup();
      return;
    }

    const previewSlug = birthdayPreviewSlug();
    if (previewSlug) {
      try {
        const previewShown = await showBirthdayPreview(previewSlug);
        if (previewShown) return;
      } catch (error) {
        console.error('[birthday-popup] preview failed', error);
      }
    }

    await runBirthdayCheck(session);
  })().finally(() => {
    checkPromise = null;
  });
  return checkPromise;
}

function startBirthdayPopupRuntime() {
  if (!supabase || globalThis.__BIRTHDAY_POPUP_RUNTIME_STARTED__) return;
  globalThis.__BIRTHDAY_POPUP_RUNTIME_STARTED__ = true;

  waitForSupabaseAuthSession({ timeoutMs: 2500 })
    .then((session) => triggerBirthdayCheck(session))
    .catch(() => {});

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user?.id) {
      activeSessionUserId = '';
      activeQueue = [];
      activeRunKey = '';
      closeBirthdayPopup();
      return;
    }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      setTimeout(() => triggerBirthdayCheck(session), 0);
    }
  });

  window.addEventListener('focus', () => triggerBirthdayCheck().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerBirthdayCheck().catch(() => {});
  });

  window.setInterval(() => {
    if (document.visibilityState === 'visible') triggerBirthdayCheck().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

startBirthdayPopupRuntime();

export { israelDateParts, triggerBirthdayCheck };