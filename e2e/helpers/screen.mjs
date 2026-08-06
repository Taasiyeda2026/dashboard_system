import { SCREEN_TIMEOUT_MS } from './env.mjs';

export const SCREENS = {
  dashboard: {
    route: 'dashboard',
    nav: '.shell-nav__btn[data-route="dashboard"]',
    ready: '.ds-dashboard-wrap, [data-dash-data-area]',
    title: 'לוח בקרה',
    action: async (page) => {
      const btn = page.locator('.ds-dashboard-wrap button, .ds-dashboard-kpi-rows button, [data-dash-data-area] button').first();
      if (await btn.count()) await btn.click({ trial: true }).catch(() => {});
      await page.locator('.ds-dashboard-wrap').first().isVisible();
    }
  },
  activities: {
    route: 'activities',
    nav: '.shell-nav__btn[data-route="activities"]',
    ready: '.ds-activities-screen, .ds-activities-main-toolbar',
    title: 'פעילויות',
    action: async (page) => {
      const search = page.locator('.ds-activities-screen input, .ds-activities-main-toolbar input').first();
      if (await search.count()) {
        await search.fill('א');
        await search.fill('');
      } else {
        await page.locator('.ds-activities-screen, .ds-table').first().isVisible();
      }
    }
  },
  week: {
    route: 'week',
    nav: '[data-route-switch="week"]',
    ready: '.ds-week-board, .ds-cal-nav[aria-label="ניווט שבועי"]',
    title: 'שבוע',
    via: 'activities',
    action: async (page) => {
      const next = page.locator('.ds-cal-nav button, .ds-week-board button').first();
      if (await next.count()) await next.click({ trial: true }).catch(() => {});
      await page.locator('.ds-week-board').first().isVisible();
    }
  },
  month: {
    route: 'month',
    nav: '[data-route-switch="month"]',
    ready: '.ds-cal-wrap, .ds-cal-grid[aria-label="לוח חודש"]',
    title: 'חודש',
    via: 'activities',
    action: async (page) => {
      const next = page.locator('.ds-cal-nav button, .ds-cal-wrap button').first();
      if (await next.count()) await next.click({ trial: true }).catch(() => {});
      await page.locator('.ds-cal-grid').first().isVisible();
    }
  },
  'proposals-agreements': {
    route: 'proposals-agreements',
    nav: '.shell-nav__btn[data-route="proposals-agreements"]',
    ready: '[data-pa-screen], [data-pa-client-home], [data-pa-client-workspace]',
    title: 'תיק לקוח',
    action: async (page) => {
      await page.locator('[data-pa-client-search], [data-pa-client-queues]').first().isVisible();
    }
  },
  'operations-management': {
    route: 'operations-management',
    nav: '.shell-nav__btn[data-route="operations-management"], .shell-header-nav [data-route="operations-management"]',
    ready: '.ds-ops-mgmt-screen, .ds-ops-mgmt-tabs',
    title: 'ניהול תפעול',
    action: async (page) => {
      const tab = page.locator('.ds-ops-mgmt-tabs button, [data-ops-tab]').first();
      if (await tab.count()) await tab.click({ trial: true }).catch(() => {});
      await page.locator('.ds-ops-mgmt-screen, .ds-ops-mgmt-content').first().isVisible();
    }
  },
  instructors: {
    route: 'instructors',
    nav: '.shell-header-nav [data-route="instructors"], [data-act-subnav="instructors"], .shell-nav__btn[data-route="instructors"]',
    ready: '[data-instructors-search], .ds-page-header__title',
    title: 'מדריכים',
    action: async (page) => {
      const search = page.locator('[data-instructors-search]');
      if (await search.count()) {
        await search.fill('א');
        await search.fill('');
      }
    }
  },
  archive: {
    route: 'archive',
    nav: '.shell-header-nav [data-route="archive"], [data-act-subnav="archive"], .shell-nav__btn[data-route="archive"]',
    ready: '.ds-activities-screen--archive, .ds-archive-kpi-row',
    title: 'ארכיון',
    allowProgrammatic: true,
    action: async (page) => {
      await page.locator('.ds-archive-kpi-row').first().isVisible();
    }
  },
  contacts: {
    route: 'contacts',
    nav: '.shell-header-nav [data-route="contacts"], [data-act-subnav="contacts"], .shell-nav__btn[data-route="contacts"]',
    ready: '.contacts-tab-bar, .contacts-list-wrap, [data-contacts-tab]',
    title: 'אנשי קשר',
    allowProgrammatic: true,
    action: async (page) => {
      const tab = page.locator('[data-contacts-tab]').first();
      if (await tab.count()) await tab.click({ trial: true }).catch(() => {});
      await page.locator('.contacts-list-wrap, .contacts-tab-bar').first().isVisible();
    }
  }
};

export async function waitForAppShell(page, timeout = SCREEN_TIMEOUT_MS) {
  await page.locator('.app-shell #screenRoot').waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const shell = document.querySelector('.app-shell');
      if (!shell) return false;
      if (shell.classList.contains('is-route-loading')) return false;
      return !document.querySelector('#screenRoot .ds-loading-card .ds-spinner');
    },
    null,
    { timeout }
  );
}

export async function waitForRoute(page, route, timeout = SCREEN_TIMEOUT_MS) {
  await page.locator(`.app-shell[data-current-route="${route}"]`).waitFor({ state: 'attached', timeout });
  await waitForAppShell(page, timeout);
}

export async function waitForScreenReady(page, screenKey, timeout = SCREEN_TIMEOUT_MS) {
  const screen = SCREENS[screenKey];
  if (!screen) throw new Error(`Unknown screen ${screenKey}`);
  await waitForRoute(page, screen.route, timeout);
  await page.locator(screen.ready).first().waitFor({ state: 'visible', timeout });
  // Empty-screen guard: root must have meaningful content
  const text = (await page.locator('#screenRoot').innerText()).trim();
  if (!text || text.length < 3) {
    throw new Error(`Screen ${screenKey} appears empty`);
  }
  // Spinner must not remain indefinitely
  const stuckSpinner = await page.locator('#screenRoot .ds-spinner, #screenRoot .ds-loading-card').count();
  if (stuckSpinner > 0) {
    await page
      .locator('#screenRoot .ds-spinner, #screenRoot .ds-loading-card')
      .first()
      .waitFor({ state: 'detached', timeout: Math.min(timeout, 20_000) })
      .catch(() => {
        throw new Error(`Spinner did not finish on screen ${screenKey}`);
      });
  }
}

export async function navigateToScreen(page, screenKey) {
  const screen = SCREENS[screenKey];
  if (!screen) throw new Error(`Unknown screen ${screenKey}`);

  if (screen.via === 'activities') {
    const current = await page.locator('.app-shell').getAttribute('data-current-route');
    if (current !== 'activities' && current !== 'week' && current !== 'month') {
      await page.locator(SCREENS.activities.nav).first().click();
      await waitForScreenReady(page, 'activities');
    }
  }

  const nav = page.locator(screen.nav).first();
  if (await nav.count()) {
    await nav.click();
  } else if (screen.allowProgrammatic) {
    await page.evaluate((route) => {
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }));
    }, screen.route);
  } else {
    await page.evaluate((route) => {
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }));
    }, screen.route);
  }
  await waitForScreenReady(page, screenKey);
}

export async function setActivityPeriod(page, period) {
  // period: 'regular' (2026) | 'school_2027' (2027)
  const toggle = page.locator('[data-global-period-toggle]');
  await toggle.click();
  await page.locator(`[data-global-period-option="${period}"]`).click();
  await page.waitForTimeout(300);
  await waitForAppShell(page);
}

/** Label currently shown on the global period selector ('2026' / '2027'). */
export async function readActivityPeriodLabel(page) {
  return (await page.locator('[data-global-period-toggle]').first().innerText()).trim();
}

/**
 * Reveals more table rows until the requested row id is rendered, using the
 * screen's own "show more" control.
 */
export async function revealListRow(page, rowId, { maxClicks = 12 } = {}) {
  const row = page.locator(`.ds-data-row[data-row-id="${rowId}"]`);
  for (let attempt = 0; attempt <= maxClicks; attempt += 1) {
    if (await row.count()) return row.first();
    const showMore = page.locator('[data-list-show-more]:visible').first();
    if (!(await showMore.count())) return null;
    await showMore.click();
    await page.waitForTimeout(250);
  }
  return (await row.count()) ? row.first() : null;
}

export async function loginViaUi(page, { username, password }) {
  await page.goto('/');
  await page.locator('#loginForm').waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
  await page.fill('#userId', username);
  await page.fill('#entryCode', password);
  await page.click('.login-submit');
  await page.locator('.app-shell #screenRoot').waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
  await waitForAppShell(page);
}

export async function basicScreenAction(page, screenKey) {
  const screen = SCREENS[screenKey];
  if (screen?.action) await screen.action(page);
}
