import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const ADMIN_TAB_ATTRIBUTE = 'data-summer-feedback-admin-tab';
const ADMIN_FRAME_URL = './summer-feedback/?view=admin&embedded=1';
const HEIGHT_MESSAGE_TYPE = 'summer-feedback:embedded-height';
const STYLE_ELEMENT_ID = 'summer-feedback-admin-integration-styles';

let adminCheckPromise = null;
let cachedAdminUserId = '';
let cachedAdminResult = false;
let enhancementScheduled = false;

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

async function currentAuthUserIsAdmin() {
  if (!supabase) return false;
  if (adminCheckPromise) return adminCheckPromise;

  adminCheckPromise = (async () => {
    const session = await waitForSupabaseAuthSession({ timeoutMs: 1800 });
    const authUserId = String(session?.user?.id || '').trim();
    if (!authUserId) return false;
    if (authUserId === cachedAdminUserId) return cachedAdminResult;

    const { data, error } = await supabase
      .from('users')
      .select('role,is_active')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    cachedAdminUserId = authUserId;
    cachedAdminResult = !error && data?.is_active !== false && normalizeRole(data?.role) === 'admin';
    return cachedAdminResult;
  })();

  try {
    return await adminCheckPromise;
  } finally {
    adminCheckPromise = null;
  }
}

function ensureIntegrationStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    .pr-summer-feedback-admin-body {
      width: min(100%, 1320px);
      margin-inline: auto;
    }

    .pr-summer-feedback-frame-card {
      padding: 0;
      overflow: hidden;
      border-color: #d7dee7;
      background: #ffffff;
    }

    .pr-summer-feedback-frame {
      display: block;
      width: 100%;
      height: 760px;
      min-height: 760px;
      border: 0;
      background: #ffffff;
    }

    .pr-report-tab[${ADMIN_TAB_ATTRIBUTE}] {
      color: #183153;
    }

    .pr-report-tab[${ADMIN_TAB_ATTRIBUTE}].is-active {
      color: #ffffff;
      background: #183153;
      border-color: #183153;
    }

    @media (max-width: 820px) {
      .pr-summer-feedback-admin-body {
        width: 100%;
      }

      .pr-summer-feedback-frame-card {
        border-radius: 10px;
      }

      .pr-summer-feedback-frame {
        height: 720px;
        min-height: 720px;
      }
    }
  `;
  document.head.append(style);
}

function createAdminTab() {
  const button = document.createElement('button');
  button.className = 'pr-report-tab';
  button.type = 'button';
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', 'false');
  button.setAttribute(ADMIN_TAB_ATTRIBUTE, 'true');
  button.textContent = 'משוב קיץ';
  return button;
}

function markSummerTabActive(tabList) {
  tabList.querySelectorAll('.pr-report-tab').forEach((button) => {
    const active = button.hasAttribute(ADMIN_TAB_ATTRIBUTE);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function restoreOriginalScreen(root, screen, originalNodes) {
  screen?.remove();
  for (const item of originalNodes) {
    if (!item.node?.isConnected) continue;
    item.node.hidden = item.wasHidden;
  }
}

function dispatchDashboardNavigation() {
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
}

function bindEmbeddedFrameHeight(iframe, screen) {
  const onMessage = (event) => {
    if (!screen.isConnected || event.origin !== window.location.origin || event.source !== iframe.contentWindow) return;
    if (event.data?.type !== HEIGHT_MESSAGE_TYPE) return;
    const requested = Number(event.data.height || 0);
    if (!Number.isFinite(requested) || requested <= 0) return;
    const height = Math.min(Math.max(Math.ceil(requested), 720), 5600);
    iframe.style.height = `${height}px`;
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

function openSummerFeedbackAdmin(root, sourceTabList) {
  if (!root || root.querySelector('.pr-screen--summer-feedback-admin')) return;

  const originalNodes = [...root.children].map((node) => ({ node, wasHidden: node.hidden }));
  originalNodes.forEach(({ node }) => { node.hidden = true; });

  const screen = document.createElement('div');
  screen.className = 'pr-screen pr-screen--summer-feedback-admin';
  screen.dir = 'rtl';
  screen.innerHTML = `
    <div class="pr-topbar">
      <button class="pr-btn pr-btn--ghost pr-back-btn" type="button" data-summer-feedback-action="back-to-dashboard">← חזרה לדשבורד</button>
      <span class="pr-topbar__title">משוב קיץ</span>
      <button class="pr-btn pr-btn--ghost pr-btn--sm" type="button" data-summer-feedback-action="lock-screen" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
    </div>
    <div class="pr-body pr-summer-feedback-admin-body">
      <div data-summer-feedback-tabs></div>
      <section class="pr-card pr-summer-feedback-frame-card" aria-label="ניהול משוב הקיץ">
        <iframe class="pr-summer-feedback-frame" title="ניהול משוב הקיץ" src="${ADMIN_FRAME_URL}" loading="eager"></iframe>
      </section>
    </div>
  `;

  const clonedTabs = sourceTabList.cloneNode(true);
  markSummerTabActive(clonedTabs);
  screen.querySelector('[data-summer-feedback-tabs]')?.replaceWith(clonedTabs);
  root.append(screen);

  const iframe = screen.querySelector('.pr-summer-feedback-frame');
  const unbindHeight = iframe ? bindEmbeddedFrameHeight(iframe, screen) : () => {};

  const closeAndActivate = (action) => {
    unbindHeight();
    restoreOriginalScreen(root, screen, originalNodes);
    if (!action) return;
    requestAnimationFrame(() => {
      const originalButton = root.querySelector(`[data-pr-action="${action}"]`);
      if (originalButton) originalButton.click();
    });
  };

  clonedTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.pr-report-tab');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.hasAttribute(ADMIN_TAB_ATTRIBUTE)) return;
    closeAndActivate(button.dataset.prAction || '');
  }, true);

  screen.querySelector('[data-summer-feedback-action="back-to-dashboard"]')?.addEventListener('click', () => {
    unbindHeight();
    restoreOriginalScreen(root, screen, originalNodes);
    const originalBack = root.querySelector('[data-pr-action="back-to-dashboard"]');
    if (originalBack) originalBack.click();
    else dispatchDashboardNavigation();
  });

  screen.querySelector('[data-summer-feedback-action="lock-screen"]')?.addEventListener('click', () => {
    closeAndActivate('lock-screen');
  });
}

function injectAdminTab(tabList) {
  if (!tabList?.isConnected || tabList.querySelector(`[${ADMIN_TAB_ATTRIBUTE}]`)) return;
  const button = createAdminTab();
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const root = button.closest('#pr-root');
    if (root) openSummerFeedbackAdmin(root, tabList);
  }, true);
  tabList.append(button);
}

async function enhancePersonalReportsTabs() {
  if (typeof document === 'undefined') return;
  const tabLists = [...document.querySelectorAll('#pr-root .pr-screen-mode-switch')];
  if (!tabLists.length) return;
  if (!await currentAuthUserIsAdmin()) return;
  tabLists.filter((tabList) => tabList.isConnected).forEach(injectAdminTab);
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(() => {
    enhancementScheduled = false;
    void enhancePersonalReportsTabs();
  });
}

function initializeSummerFeedbackAdminIntegration() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  ensureIntegrationStyles();
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('app:navigate', scheduleEnhancement);
  supabase?.auth?.onAuthStateChange?.(() => {
    cachedAdminUserId = '';
    cachedAdminResult = false;
    scheduleEnhancement();
  });
  scheduleEnhancement();
}

initializeSummerFeedbackAdminIntegration();
