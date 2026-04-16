// ============================================================
// app.js — Shell, router, auth guard
// ============================================================

import { getSession, clearSession } from "./api/api.js";
import { SCREENS, CONFIG } from "./config/config.js";
import { can } from "./shared/utils.js";
import { initDrawer } from "./components/activity-drawer.js";

// ── Screen modules (lazy-loaded) ─────────────────────────────
const SCREEN_MODULES = {
  dashboard:   () => import("./screens/dashboard.js"),
  activities:  () => import("./screens/activities.js"),
  week:        () => import("./screens/week.js"),
  month:       () => import("./screens/month.js"),
  instructors: () => import("./screens/instructors.js"),
  exceptions:  () => import("./screens/exceptions.js"),
  my_data:     () => import("./screens/my-data.js"),
  contacts:    () => import("./screens/contacts.js"),
  finance:     () => import("./screens/finance.js"),
  permissions: () => import("./screens/permissions.js"),
};

let currentScreen = null;

// ── Boot ─────────────────────────────────────────────────────
export function boot() {
  const user = getSession();
  if (!user) {
    showLogin();
  } else {
    showApp(user);
  }
}

// ── Login ────────────────────────────────────────────────────
function showLogin() {
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
}

function hideLogin() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";
}

// ── App shell ────────────────────────────────────────────────
function showApp(user) {
  hideLogin();
  buildSidebar(user);
  initDrawer();
  const target = user.default_view || CONFIG.DEFAULT_SCREEN;
  navigateTo(target);
}

function buildSidebar(user) {
  const nav = document.getElementById("sidebar-nav");
  const userEl = document.getElementById("sidebar-user");

  nav.innerHTML = SCREENS
    .filter((s) => can(user, s.perm))
    .map((s) => `
      <button class="nav-item" data-screen="${s.id}" aria-label="${s.label}">
        <span class="nav-icon">${s.icon}</span>
        <span>${s.label}</span>
      </button>`)
    .join("");

  nav.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeMobileMenu();
      navigateTo(btn.dataset.screen);
    });
  });

  userEl.innerHTML = `
    <strong>${user.full_name ?? ""}</strong>
    <span>${user.display_role ?? ""}</span>
    <button id="btn-logout">יציאה</button>`;
  document.getElementById("btn-logout").addEventListener("click", logout);
}

// ── Navigate ─────────────────────────────────────────────────
export async function navigateTo(screenId) {
  const user = getSession();
  if (!user) { showLogin(); return; }

  // Permission check
  const screenDef = SCREENS.find((s) => s.id === screenId);
  if (screenDef && !can(user, screenDef.perm)) {
    navigateTo(user.default_view || "dashboard");
    return;
  }

  // Mark active nav item
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === screenId);
  });

  // Update topbar title
  const label = screenDef?.label ?? "";
  document.getElementById("topbar-title").textContent = label;

  // Load screen
  currentScreen = screenId;
  const content = document.getElementById("screen-content");
  content.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>טוען...</span></div>`;

  try {
    const mod = await SCREEN_MODULES[screenId]?.();
    if (mod?.render) {
      await mod.render(content, user);
    } else {
      content.innerHTML = `<div class="empty-state">מסך "${label}" בפיתוח</div>`;
    }
  } catch (err) {
    content.innerHTML = `<div class="error-state">שגיאה בטעינת המסך</div>`;
    console.error(err);
  }
}

// ── Mobile menu ──────────────────────────────────────────────
export function toggleMobileMenu() {
  document.getElementById("sidebar").classList.toggle("open");
}
function closeMobileMenu() {
  document.getElementById("sidebar").classList.remove("open");
}

// ── Logout ───────────────────────────────────────────────────
function logout() {
  clearSession();
  location.reload();
}
