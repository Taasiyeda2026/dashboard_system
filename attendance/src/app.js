import { renderLoginScreen } from './screens/login-screen.js';
import { renderHomeScreen } from './screens/home-screen.js';
import { renderNewReportScreen } from './screens/new-report-screen.js';
import { renderMyReportsScreen } from './screens/my-reports-screen.js';
import { createBottomNav } from './components/bottom-nav.js';
import { mockInstructor, mockMonthSummary, mockReports, ACTIVITY_TYPES } from './services/mock-data.service.js';

const state = {
  loggedIn: false,
  screen: 'home',
  reports: [...mockReports]
};

let appRoot = null;
let navRoot = null;

function navigate(screen) {
  state.screen = screen;
  renderScreen();
}

function handleLogin() {
  state.loggedIn = true;
  state.screen = 'home';
  renderScreen();
}

function handleLogout() {
  state.loggedIn = false;
  renderScreen();
}

function renderScreen() {
  appRoot.classList.toggle('app-shell--with-nav', state.loggedIn);
  appRoot.innerHTML = '';

  if (!state.loggedIn) {
    navRoot.hidden = true;
    navRoot.innerHTML = '';
    renderLoginScreen(appRoot, { onLogin: handleLogin });
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
      instructor: mockInstructor,
      summary: mockMonthSummary,
      onNewReport: () => navigate('new-report'),
      onMyReports: () => navigate('my-reports'),
      onSubmitMonth: () => navigate('my-reports'),
      onLogout: handleLogout
    });
  }
}

export function startApp(root, nav) {
  appRoot = root;
  navRoot = nav;
  renderScreen();
}
