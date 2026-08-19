import { renderLoginScreen } from './screens/login-screen.js';
import { renderHomeScreen } from './screens/home-screen.js';
import { renderNewReportScreen } from './screens/new-report-screen.js';
import { renderMyReportsScreen } from './screens/my-reports-screen.js';
import { createBottomNav } from './components/bottom-nav.js';
import { signInWithUsername, signOut, getExistingSession } from './auth/auth.service.js';
import { resolveInstructorIdentity } from './auth/identity.service.js';

// ── App state ────────────────────────────────────────────────────────────────
const today = new Date();

const state = {
  loggedIn:     false,
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

async function handleLoginSubmit({ username, code }) {
  await signInWithUsername(username, code);
  try {
    state.instructor = await resolveInstructorIdentity();
  } catch (error) {
    await signOut().catch(() => {});
    throw error;
  }
  state.loggedIn = true;
  state.screen = 'home';
  // Reset month to current on fresh login
  const now = new Date();
  state.currentYear  = now.getFullYear();
  state.currentMonth = now.getMonth() + 1;
  renderScreen();
}

async function handleLogout() {
  await signOut().catch(() => {});
  state.loggedIn   = false;
  state.instructor = null;
  renderScreen();
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
  // Keep the mobile tab state unchanged while allowing the desktop sidebar to
  // show the active new-report destination.
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
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  const session = await getExistingSession().catch(() => null);
  if (session?.user?.id) {
    try {
      state.instructor = await resolveInstructorIdentity();
      state.loggedIn   = true;
    } catch {
      await signOut().catch(() => {});
    }
  }
  renderScreen();
}

export function startApp(root, nav) {
  appRoot = root;
  navRoot = nav;
  bootstrap();
}
