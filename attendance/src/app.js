import { renderLoginScreen } from './screens/login-screen.js';
import { renderHomeScreen } from './screens/home-screen.js';
import { renderNewReportScreen } from './screens/new-report-screen.js';
import { renderMyReportsScreen } from './screens/my-reports-screen.js';
import { createBottomNav } from './components/bottom-nav.js';
import { signInWithUsername, signOut, getExistingSession } from './auth/auth.service.js';
import { resolveInstructorIdentity, resolveAdminPreviewIdentity } from './auth/identity.service.js';
import { isAdminPreviewRequested } from './preview/preview-mode.js';

// ── App state ────────────────────────────────────────────────────────────────
const today = new Date();

const state = {
  loggedIn:     false,
  previewMode:  isAdminPreviewRequested(),
  screen:       'home',          // 'home' | 'new-report' | 'my-reports'
  instructor:   null,            // { userId, name, empId }
  currentYear:  today.getFullYear(),
  currentMonth: today.getMonth() + 1,  // 1-based
  prefillRecord: null,           // attendance record to duplicate (cleared after use)
};

let appRoot = null;
let navRoot = null;

// ── Navigation ───────────────────────────────────────────────────────────────

function navigate(screen) {
  state.screen = screen;
  renderScreen();
}

function prevMonth() {
  if (state.currentMonth === 1) {
    state.currentMonth = 12;
    state.currentYear -= 1;
  } else {
    state.currentMonth -= 1;
  }
  renderScreen();
}

function nextMonth() {
  const now = new Date();
  // Don't navigate past the current month
  if (
    state.currentYear > now.getFullYear() ||
    (state.currentYear === now.getFullYear() && state.currentMonth >= now.getMonth() + 1)
  ) return;
  if (state.currentMonth === 12) {
    state.currentMonth = 1;
    state.currentYear += 1;
  } else {
    state.currentMonth += 1;
  }
  renderScreen();
}

// ── Auth handlers ────────────────────────────────────────────────────────────

async function resolveCurrentIdentity() {
  return state.previewMode
    ? resolveAdminPreviewIdentity()
    : resolveInstructorIdentity();
}

async function handleLoginSubmit({ username, code }) {
  await signInWithUsername(username, code);
  try {
    state.instructor = await resolveCurrentIdentity();
  } catch (error) {
    // In preview mode the session may also belong to the dashboard. Do not sign
    // the admin out of the main system merely because preview authorization failed.
    if (!state.previewMode) await signOut().catch(() => {});
    throw error;
  }
  state.loggedIn = true;
  state.screen = 'home';
  const now = new Date();
  state.currentYear  = now.getFullYear();
  state.currentMonth = now.getMonth() + 1;
  renderScreen();
}

async function handleLogout() {
  if (state.previewMode) {
    window.location.assign('/dashboard_system/');
    return;
  }
  await signOut().catch(() => {});
  state.loggedIn   = false;
  state.instructor = null;
  renderScreen();
}

// ── Admin preview banner ─────────────────────────────────────────────────────

function ensurePreviewStyles() {
  if (!state.previewMode || document.getElementById('av2-admin-preview-style')) return;
  const style = document.createElement('style');
  style.id = 'av2-admin-preview-style';
  style.textContent = `
    .av2-admin-preview {
      width: min(100% - 24px, 760px);
      margin: 10px auto 0;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      background: #eff6ff;
      color: #1e3a5f;
      font-size: 12px;
      line-height: 1.35;
    }
    .av2-admin-preview strong { font-weight: 800; }
    .av2-admin-preview button {
      flex: 0 0 auto;
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid #93c5fd;
      border-radius: 8px;
      background: #fff;
      color: #1e3a5f;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    @media (max-width: 520px) {
      .av2-admin-preview { align-items: flex-start; }
    }
  `;
  document.head.append(style);
}

function renderPreviewBanner() {
  if (!state.previewMode || !state.loggedIn || !appRoot) return;
  ensurePreviewStyles();
  const banner = document.createElement('div');
  banner.className = 'av2-admin-preview';
  banner.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.innerHTML = '<strong>מצב בדיקה לאדמין</strong> · תצוגת עובד מלאה · כל הנתונים כאן הם נתוני הדגמה ולא נשמרים במערכת.';

  const exitBtn = document.createElement('button');
  exitBtn.type = 'button';
  exitBtn.textContent = 'חזרה לניהול';
  exitBtn.addEventListener('click', () => window.location.assign('/dashboard_system/'));

  banner.append(text, exitBtn);
  appRoot.prepend(banner);
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderScreen() {
  appRoot.classList.toggle('app-shell--with-nav', state.loggedIn);
  appRoot.innerHTML = '';

  if (!state.loggedIn) {
    navRoot.hidden   = true;
    navRoot.innerHTML = '';
    renderLoginScreen(appRoot, { onLogin: handleLoginSubmit });
    return;
  }

  navRoot.hidden   = false;
  navRoot.innerHTML = '';
  const navActive = state.screen === 'new-report' ? 'home' : state.screen;
  navRoot.append(createBottomNav({
    active: navActive,
    desktopActive: state.screen,
    instructor: state.instructor,
    onNavigate: navigate,
    onLogout: handleLogout
  }));

  if (state.screen === 'new-report') {
    const prefill = state.prefillRecord;
    state.prefillRecord = null;
    renderNewReportScreen(appRoot, {
      instructor: state.instructor,
      defaultDate: `${state.currentYear}-${String(state.currentMonth).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,
      prefillRecord: prefill,
      onBack: () => navigate('home'),
      onSaved: () => navigate('my-reports'),
    });

  } else if (state.screen === 'my-reports') {
    renderMyReportsScreen(appRoot, {
      instructor: state.instructor,
      year:  state.currentYear,
      month: state.currentMonth,
      onBack:      () => navigate('home'),
      onPrevMonth: prevMonth,
      onNextMonth: nextMonth,
      onNewReport: () => navigate('new-report'),
      onDuplicate: (record) => {
        state.prefillRecord = record;
        navigate('new-report');
      },
    });

  } else {
    renderHomeScreen(appRoot, {
      instructor:  state.instructor,
      year:        state.currentYear,
      month:       state.currentMonth,
      onNewReport: () => navigate('new-report'),
      onMyReports: () => navigate('my-reports'),
      onPrevMonth: prevMonth,
      onNextMonth: nextMonth,
      onLogout:    handleLogout
    });
  }

  renderPreviewBanner();
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  const session = await getExistingSession().catch(() => null);
  if (session?.user?.id) {
    try {
      state.instructor = await resolveCurrentIdentity();
      state.loggedIn   = true;
    } catch {
      if (!state.previewMode) await signOut().catch(() => {});
    }
  }
  renderScreen();
}

export function startApp(root, nav) {
  appRoot = root;
  navRoot = nav;
  bootstrap();
}
