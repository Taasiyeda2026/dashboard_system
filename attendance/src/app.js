import { renderLoginScreen } from './screens/login-screen.js';
import { renderHomeScreen } from './screens/home-screen.js';
import { renderNewReportScreen } from './screens/new-report-screen.js';
import { renderMyReportsScreen } from './screens/my-reports-screen.js';
import { createBottomNav } from './components/bottom-nav.js';
import { mockMonthSummary, mockReports, ACTIVITY_TYPES } from './services/mock-data.service.js';
import { signInWithUsername, signOut, getExistingSession } from './auth/auth.service.js';
import { resolveInstructorIdentity } from './auth/identity.service.js';

const state = {
  loggedIn: false,
  screen: 'home',
  instructor: null,
  reports: [...mockReports]
};

let appRoot = null;
let navRoot = null;

function navigate(screen) {
  state.screen = screen;
  renderScreen();
}

// Real Supabase Auth sign-in, then block entry unless the resulting user resolves to
// exactly one active instructor (see identity.service.js). Throws on any failure so the
// login screen's own try/catch shows the message — never treated as logged in either way.
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
  renderScreen();
}

async function handleLogout() {
  await signOut().catch(() => {});
  state.loggedIn = false;
  state.instructor = null;
  renderScreen();
}

function renderScreen() {
  appRoot.classList.toggle('app-shell--with-nav', state.loggedIn);
  appRoot.innerHTML = '';

  if (!state.loggedIn) {
    navRoot.hidden = true;
    navRoot.innerHTML = '';
    renderLoginScreen(appRoot, { onLogin: handleLoginSubmit });
    return;
  }

  navRoot.hidden = false;
  navRoot.innerHTML = '';
  navRoot.append(createBottomNav({ active: state.screen, onNavigate: navigate }));

  if (state.screen === 'new-report') {
    renderNewReportScreen(appRoot, {
      activityTypes: ACTIVITY_TYPES,
      onBack: () => navigate('home'),
      onSave: (report) => {
        state.reports = [{ id: Date.now(), status: 'טיוטה', ...report }, ...state.reports];
        navigate('my-reports');
      }
    });
  } else if (state.screen === 'my-reports') {
    renderMyReportsScreen(appRoot, {
      reports: state.reports,
      onBack: () => navigate('home')
    });
  } else {
    renderHomeScreen(appRoot, {
      instructor: state.instructor,
      summary: mockMonthSummary,
      onNewReport: () => navigate('new-report'),
      onMyReports: () => navigate('my-reports'),
      onSubmitMonth: () => navigate('my-reports'),
      onLogout: handleLogout
    });
  }
}

// If a valid Supabase session already exists (persisted by supabase-js itself), resolve
// identity and skip straight past the login screen. A stale/invalid session or an
// identity that no longer resolves just falls through to a normal, silent logged-out state.
async function bootstrap() {
  const session = await getExistingSession().catch(() => null);
  if (session?.user?.id) {
    try {
      state.instructor = await resolveInstructorIdentity();
      state.loggedIn = true;
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
