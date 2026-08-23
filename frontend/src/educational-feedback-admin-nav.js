import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const NAV_ATTRIBUTE = 'data-educational-feedback-admin-nav-item';
const ADMIN_URL = 'https://taasiyeda2026.github.io/dev/summer/admin.html';
const STYLE_ID = 'educational-feedback-admin-nav-styles';

let accessPromise = null;
let cachedAuthUserId = '';
let cachedAccess = false;
let enhancementScheduled = false;

function normalize(value) {
  return String(value || '').trim();
}

async function currentUserCanManageEducationalFeedback() {
  if (!supabase) return false;
  if (accessPromise) return accessPromise;

  accessPromise = (async () => {
    const session = await waitForSupabaseAuthSession({ timeoutMs: 2200 });
    const authUserId = normalize(session?.user?.id);
    if (!authUserId) return false;
    if (authUserId === cachedAuthUserId) return cachedAccess;

    const { data, error } = await supabase
      .from('users')
      .select('user_id,role,is_active')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    const role = normalize(data?.role).toLowerCase();
    cachedAuthUserId = authUserId;
    cachedAccess = !error
      && data?.is_active === true
      && role === 'admin';
    return cachedAccess;
  })();

  try {
    return await accessPromise;
  } finally {
    accessPromise = null;
  }
}

function ensureStyles() {
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
    .shell-nav__btn[${NAV_ATTRIBUTE}] .educational-feedback-nav__icon {
      width: 18px;
      text-align: center;
      font-size: 16px;
      line-height: 1;
    }
  `;
  document.head.append(style);
}

function createNavItem(doc = document) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'shell-nav__btn';
  button.setAttribute(NAV_ATTRIBUTE, 'true');
  button.setAttribute('aria-label', 'קיץ — משוב הצוות החינוכי');
  button.title = 'משובי הקיץ של הצוות החינוכי';
  button.innerHTML = '<span class="educational-feedback-nav__icon" aria-hidden="true">☀️</span><span>קיץ</span>';
  button.addEventListener('click', () => window.location.assign(ADMIN_URL));
  return button;
}

function injectNavItem(host) {
  if (!host?.isConnected || host.querySelector(`[${NAV_ATTRIBUTE}]`)) return;
  const item = createNavItem(host.ownerDocument || document);
  const preferredAnchor = host.querySelector('[data-route="operations-management"]')
    || host.querySelector('[data-route="personal-reports"]')
    || host.querySelector('[data-route="permissions"]');

  if (preferredAnchor) preferredAnchor.insertAdjacentElement('afterend', item);
  else host.append(item);
}

function removeNavItem(root = document) {
  root.querySelectorAll?.(`[${NAV_ATTRIBUTE}]`).forEach((item) => item.remove());
}

async function enhanceSidebar() {
  if (typeof document === 'undefined') return;
  const host = document.querySelector('.shell-sidebar .shell-nav');
  if (!host) return;

  const allowed = await currentUserCanManageEducationalFeedback();
  if (!host.isConnected) return;
  if (!allowed) {
    removeNavItem(document);
    return;
  }

  ensureStyles();
  injectNavItem(host);
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(() => {
    enhancementScheduled = false;
    void enhanceSidebar();
  });
}

function resetAccessCache() {
  cachedAuthUserId = '';
  cachedAccess = false;
  accessPromise = null;
}

function initializeEducationalFeedbackAdminNavigation() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  ensureStyles();

  const observer = new MutationObserver((mutations) => {
    const shellChanged = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        node?.nodeType === 1 && (
          node.matches?.('.app-shell, .shell-sidebar, .shell-nav')
          || node.querySelector?.('.shell-sidebar .shell-nav')
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
  window.addEventListener('focus', scheduleEnhancement);
  supabase?.auth?.onAuthStateChange?.(() => {
    resetAccessCache();
    scheduleEnhancement();
  });

  scheduleEnhancement();
}

initializeEducationalFeedbackAdminNavigation();
