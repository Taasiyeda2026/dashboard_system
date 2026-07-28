import { monthScreen } from './screens/month.js';
import { calendarMonthSessionKey, cleanupLegacyCalendarMonthLocalStorage } from './state.js';
import { monthScreenCacheKey } from './screens/shared/calendar-cache-key.js';

(function installMonthNavigationRuntime() {
  'use strict';

  if (globalThis.__dsMonthNavigationRuntimeInstalled) return;
  globalThis.__dsMonthNavigationRuntimeInstalled = true;

  const originalBind = typeof monthScreen?.bind === 'function'
    ? monthScreen.bind.bind(monthScreen)
    : null;
  if (!originalBind) return;

  function validYm(value) {
    return /^\d{4}-\d{2}$/.test(String(value || '').trim());
  }

  function currentYm() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function shiftMonthYm(ym, delta) {
    const base = validYm(ym)
      ? new Date(Number(String(ym).slice(0, 4)), Number(String(ym).slice(5, 7)) - 1, 1)
      : new Date();
    base.setMonth(base.getMonth() + delta);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
  }

  function withTimeout(promise, timeoutMs) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('month_navigation_timeout');
          error.code = 'month_navigation_timeout';
          reject(error);
        }, timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function persistMonth(state, ym) {
    try {
      cleanupLegacyCalendarMonthLocalStorage(state?.user?.user_id);
      const key = calendarMonthSessionKey(state?.user?.user_id);
      if (key) sessionStorage.setItem(key, ym);
    } catch {
      /* ignore */
    }
  }

  function replaceButton(root, selector, handler) {
    const oldButton = root?.querySelector?.(selector);
    if (!oldButton) return null;
    const button = oldButton.cloneNode(true);
    oldButton.replaceWith(button);
    button.addEventListener('click', handler);
    return button;
  }

  monthScreen.bind = function patchedMonthBind(context = {}) {
    originalBind(context);

    const { root, data, state, rerender, api } = context;
    if (!root || !state || typeof api?.month !== 'function') return;

    const displayedYm = validYm(data?.month)
      ? String(data.month)
      : (validYm(state.monthYm) ? String(state.monthYm) : currentYm());

    const setLocalBusy = (busy) => {
      root.classList.toggle('is-month-loading', !!busy);
      root.setAttribute('aria-busy', busy ? 'true' : 'false');
      root.querySelectorAll('[data-month-prev],[data-month-next],[data-month-today]')
        .forEach((button) => { button.disabled = !!busy; });
    };

    const navigateTo = async (targetYm) => {
      if (state.monthNavLoading || !validYm(targetYm)) return;

      state.monthNavLoading = true;
      setLocalBusy(true);

      try {
        const monthData = await withTimeout(api.month({ ym: targetYm }), 20000);
        const returnedYm = String(monthData?.month || '').trim();
        const readFailed = Boolean(monthData?._debug?.error);
        if (returnedYm !== targetYm || readFailed) {
          throw new Error(readFailed ? String(monthData._debug.error) : 'month_navigation_mismatched_response');
        }

        const cacheKey = monthScreenCacheKey(targetYm, state);
        if (state.screenDataCache) {
          state.screenDataCache[cacheKey] = { data: monthData, t: Date.now() };
        }
        state.monthYm = targetYm;
        persistMonth(state, targetYm);
      } catch (error) {
        state.monthYm = displayedYm;
        console.warn('[month-navigation] load failed', {
          displayed_month: displayedYm,
          requested_month: targetYm,
          error: error?.message || String(error)
        });
      } finally {
        state.monthNavLoading = false;
        setLocalBusy(false);
        rerender?.();
      }
    };

    replaceButton(root, '[data-month-prev]', () => navigateTo(shiftMonthYm(displayedYm, -1)));
    replaceButton(root, '[data-month-next]', () => navigateTo(shiftMonthYm(displayedYm, 1)));
    replaceButton(root, '[data-month-today]', () => navigateTo(currentYm()));
  };
})();
