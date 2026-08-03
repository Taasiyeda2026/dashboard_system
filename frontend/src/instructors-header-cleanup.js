const SCHEDULING_SNAPSHOT_KEY = 'dashboard:course-scheduling-calculation-v1';
const SCHEDULING_ROUTE = 'course-scheduling';
const schedulingText = (value) => String(value ?? '').trim();
const schedulingIdOf = (row) => schedulingText(row?.row_id || row?.RowID || row?.id);
let schedulingInstallPromise = null;
let schedulingInstalled = false;
let schedulingRerenderQueued = false;

async function installCourseSchedulingUsabilityPatch() {
  const [screenModule, eligibilityModule, htmlModule] = await Promise.all([
    import('./screens/course-scheduling.js'),
    import('./screens/shared/activity-scheduling-eligibility.js'),
    import('./screens/shared/html.js')
  ]);
  const { courseSchedulingScreen } = screenModule;
  const { isCourseSchedulingInterfaceEligible } = eligibilityModule;
  const { escapeHtml } = htmlModule;
  if (courseSchedulingScreen.__usabilityPatched) return;
  courseSchedulingScreen.__usabilityPatched = true;

  const originalRender = courseSchedulingScreen.render.bind(courseSchedulingScreen);
  const originalBind = courseSchedulingScreen.bind.bind(courseSchedulingScreen);

  function interfaceCourses(data) {
    return (data?.activities || []).filter(isCourseSchedulingInterfaceEligible);
  }

  function nearestCourse(courses) {
    if (!courses.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const actionable = courses.filter((course) => !schedulingText(course.emp_id));
    const source = actionable.length ? actionable : courses;
    return [...source].sort((first, second) => {
      const firstDate = schedulingText(first.start_date);
      const secondDate = schedulingText(second.start_date);
      const firstPast = firstDate && firstDate < today ? 1 : 0;
      const secondPast = secondDate && secondDate < today ? 1 : 0;
      if (firstPast !== secondPast) return firstPast - secondPast;
      return firstDate.localeCompare(secondDate);
    })[0] || null;
  }

  function activeResults(state, courses) {
    const courseById = new Map(courses.map((course) => [schedulingIdOf(course), course]));
    return (state.courseSchedulingResults || []).filter((result) => {
      const course = courseById.get(schedulingIdOf(result?.course));
      return course && !schedulingText(course.emp_id) && !schedulingText(course.draft_emp_id);
    });
  }

  function restoreSnapshot(state, courses) {
    if ((state.courseSchedulingResults || []).length) return;
    try {
      const snapshot = JSON.parse(localStorage.getItem(SCHEDULING_SNAPSHOT_KEY) || 'null');
      if (!snapshot || !Array.isArray(snapshot.results)) return;
      const courseById = new Map(courses.map((course) => [schedulingIdOf(course), course]));
      state.courseSchedulingResults = snapshot.results.flatMap((result) => {
        const course = courseById.get(schedulingIdOf(result?.course));
        return course && !schedulingText(course.emp_id) && !schedulingText(course.draft_emp_id)
          ? [{ ...result, course }]
          : [];
      });
      state.courseSchedulingCalculatedAt = schedulingText(snapshot.calculatedAt);
    } catch {
      try { localStorage.removeItem(SCHEDULING_SNAPSHOT_KEY); } catch { /* local storage may be unavailable */ }
    }
  }

  function saveSnapshot(state, courses) {
    try {
      localStorage.setItem(SCHEDULING_SNAPSHOT_KEY, JSON.stringify({
        calculatedAt: state.courseSchedulingCalculatedAt || '',
        results: activeResults(state, courses)
      }));
    } catch {
      // Persistence is optional. Scheduling must continue to work without it.
    }
  }

  function readinessHtml(data) {
    const instructors = (data?.instructors || []).filter((row) => {
      const value = schedulingText(row.active).toLowerCase();
      return value === 'yes' || value === 'true' || value === '1';
    });
    const profiles = new Map((data?.scheduling?.profiles || []).map((row) => [schedulingText(row.emp_id), row]));
    const ruleCounts = new Map();
    for (const rule of (data?.scheduling?.rules || [])) {
      const empId = schedulingText(rule.emp_id);
      if (empId) ruleCounts.set(empId, (ruleCounts.get(empId) || 0) + 1);
    }
    const missingProfile = instructors.filter((row) => !profiles.has(schedulingText(row.emp_id))).length;
    const missingAddress = instructors.filter((row) => !schedulingText(row.address)).length;
    const missingAvailability = instructors.filter((row) => (ruleCounts.get(schedulingText(row.emp_id)) || 0) < 5).length;
    const ready = instructors.filter((row) => profiles.has(schedulingText(row.emp_id)) && schedulingText(row.address) && (ruleCounts.get(schedulingText(row.emp_id)) || 0) >= 5).length;
    return `<section class="course-scheduling__readiness"><b>מוכנות לשיבוץ: ${ready} מתוך ${instructors.length} מדריכים</b><span>${missingAvailability} ללא זמינות שבועית מלאה</span><span>${missingProfile} ללא פרופיל שיבוץ</span><span>${missingAddress} ללא כתובת</span></section>`;
  }

  function summaryHtml(state, courses) {
    const results = activeResults(state, courses);
    const ready = results.filter((result) => result.status === 'הצעה מוכנה').length;
    const treatment = results.filter((result) => result.status === 'נדרש טיפול').length;
    const recruit = results.filter((result) => result.status === 'נדרש גיוס').length;
    const missing = results.filter((result) => result.status === 'חסר מידע').length;
    const drafts = courses.filter((course) => !schedulingText(course.emp_id) && schedulingText(course.draft_emp_id)).length;
    const waiting = courses.filter((course) => !schedulingText(course.emp_id) && !schedulingText(course.draft_emp_id)).length;
    const calculatedIds = new Set(results.map((result) => schedulingIdOf(result.course)));
    const notCalculated = courses.filter((course) => !schedulingText(course.emp_id) && !schedulingText(course.draft_emp_id) && !calculatedIds.has(schedulingIdOf(course))).length;
    return `<section class="course-scheduling__summary"><span>חישוב אחרון: ${escapeHtml(state.courseSchedulingCalculatedAt || 'טרם בוצע')}</span><b>${waiting} קורסים ממתינים לשיבוץ</b><b>${notCalculated} טרם חושבו</b><b>${ready} הצעה מוכנה</b><b>${drafts} בטיוטה</b><b>${treatment} נדרש טיפול</b><b>${recruit} נדרש גיוס</b><b>${missing} חסר מידע</b></section>`;
  }

  courseSchedulingScreen.render = function patchedRender(data, context) {
    const courses = interfaceCourses(data);
    const { state } = context;
    restoreSnapshot(state, courses);

    const selectedExists = courses.some((course) => schedulingIdOf(course) === schedulingText(state.courseSchedulingSelectedId));
    if (!selectedExists) {
      const nearest = nearestCourse(courses);
      if (nearest) {
        state.courseSchedulingSelectedId = schedulingIdOf(nearest);
        state.courseSchedulingWeek = schedulingText(nearest.start_date) || state.courseSchedulingWeek;
      }
    }

    let html = originalRender(data, context);
    const summary = summaryHtml(state, courses);
    html = html.replace(/<section class="course-scheduling__summary">[\s\S]*?<\/section>/, summary);
    html = html.replace(summary, `${summary}${readinessHtml(data)}`);
    html = html.replace('</style>', `
      .course-scheduling__summary,.course-scheduling__readiness{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 12px;margin:10px 0;border:1px solid #e1e8f1;border-radius:10px;background:#fff}
      .course-scheduling__readiness{margin-top:0;background:#f8fbff}
      .course-scheduling__readiness span{font-size:.82rem;color:#69778b}
      .course-list__card.is-status-ready{border-inline-start:4px solid #2d8a55}
      .course-list__card.is-status-warning{border-inline-start:4px solid #d08b22}
      .course-list__card.is-status-danger{border-inline-start:4px solid #bd4a4a}
      .course-list__card.is-status-draft{border-inline-start:4px solid #7758b3}
      .course-calendar__selected-empty{display:grid;gap:8px;justify-items:start;padding:18px;border:1px dashed #cbd7e6;border-radius:10px;background:#f8fbff}
    </style>`);
    return html;
  };

  courseSchedulingScreen.bind = function patchedBind(args) {
    originalBind(args);
    const { root, data, state } = args;
    const courses = interfaceCourses(data);

    root.querySelectorAll('[data-course-card]').forEach((card) => {
      const meta = card.querySelectorAll('.course-list__card-meta')[1]?.querySelector('bdi');
      if (meta?.textContent?.includes(' · ')) meta.textContent = meta.textContent.split(' · ').slice(1).join(' · ');
      const status = schedulingText(card.querySelector('.ds-status-chip')?.textContent);
      card.classList.toggle('is-status-ready', status === 'הצעה מוכנה');
      card.classList.toggle('is-status-warning', status === 'ממתין לחישוב' || status === 'חסר מידע');
      card.classList.toggle('is-status-danger', status === 'נדרש טיפול' || status === 'נדרש גיוס');
      card.classList.toggle('is-status-draft', status === 'שמור בטיוטה');
    });

    const selected = courses.find((course) => schedulingIdOf(course) === schedulingText(state.courseSchedulingSelectedId));
    const empty = root.querySelector('.course-calendar__empty');
    if (empty && selected && !schedulingText(selected.emp_id) && !schedulingText(selected.draft_emp_id)) {
      empty.classList.add('course-calendar__selected-empty');
      empty.textContent = '';
      const message = document.createElement('span');
      message.textContent = `הקורס „${schedulingText(selected.activity_name) || 'הנבחר'}” טרם שובץ. לאחר חישוב ובחירת מדריך הוא יוצג כאן במערכת השבועית.`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ds-btn ds-btn--primary ds-btn--sm';
      button.textContent = 'חשב הצעות שיבוץ';
      button.addEventListener('click', () => root.querySelector('[data-calculate-course-schedule]')?.click());
      empty.append(message, button);
    }

    const calculateButton = root.querySelector('[data-calculate-course-schedule]');
    if (calculateButton && !calculateButton.dataset.snapshotBound) {
      calculateButton.dataset.snapshotBound = 'true';
      calculateButton.addEventListener('click', () => {
        const startedAt = Date.now();
        let sawLoading = !!state.courseSchedulingLoading;
        const timer = window.setInterval(() => {
          sawLoading ||= !!state.courseSchedulingLoading;
          const completed = sawLoading && !state.courseSchedulingLoading && !!schedulingText(state.courseSchedulingCalculatedAt);
          if (completed) {
            saveSnapshot(state, courses);
            window.clearInterval(timer);
          } else if (Date.now() - startedAt > 120000) {
            window.clearInterval(timer);
          }
        }, 250);
      });
    }
  };
}

function ensureSchedulingPatchInstalled(detail = {}) {
  if (schedulingInstalled) return;
  schedulingInstallPromise ||= installCourseSchedulingUsabilityPatch()
    .then(() => { schedulingInstalled = true; })
    .catch((error) => {
      schedulingInstallPromise = null;
      console.error('[course-scheduling-usability] install failed', error);
      throw error;
    });
  if (schedulingRerenderQueued) return;
  schedulingRerenderQueued = true;
  schedulingInstallPromise.then(() => {
    schedulingRerenderQueued = false;
    document.dispatchEvent(new CustomEvent('app:navigate', {
      detail: { ...detail, route: SCHEDULING_ROUTE, courseSchedulingUsabilityReady: true }
    }));
  }).catch(() => { schedulingRerenderQueued = false; });
}

function instructorsAppRoot(root = document) {
  if (!root) return null;
  if (root.id === 'app') return root;
  return root.querySelector?.('#app') || null;
}

function isInstructorsScreen(app) {
  const title = app?.querySelector?.('.ds-page-header__title');
  return String(title?.textContent || '').trim() === 'מדריכים';
}

export function cleanupInstructorsHeader(root = document) {
  const app = instructorsAppRoot(root);
  if (!app || !isInstructorsScreen(app)) return false;

  const search = app.querySelector('[data-instructors-search]');
  if (search) {
    if (String(search.value || '').trim()) {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const currentSearch = app.querySelector('[data-instructors-search]');
    currentSearch?.parentElement?.remove();
  }

  app.querySelector('.ds-page-header [data-route="course-scheduling"]')?.remove();
  return true;
}

let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  queueMicrotask(() => {
    cleanupScheduled = false;
    cleanupInstructorsHeader(document);
  });
}

function startInstructorsHeaderCleanup() {
  const app = document.getElementById('app');
  if (!app) return;
  cleanupInstructorsHeader(app);
  new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => (
      node.nodeType === 1 && (
        node.matches?.('.ds-page-header, .ds-screen-top-row, [data-instructors-search]')
        || node.querySelector?.('.ds-page-header, .ds-screen-top-row, [data-instructors-search]')
      )
    )));
    if (relevant) scheduleCleanup();
  }).observe(app, { childList: true, subtree: true });
  document.addEventListener('app:navigate', scheduleCleanup);
}

const isRealBrowser = typeof window !== 'undefined'
  && window === globalThis
  && typeof sessionStorage !== 'undefined'
  && typeof localStorage !== 'undefined';

if (isRealBrowser) {
  import('./activity-2027-contact-list-runtime.js?v=20260802-v1').catch((error) => {
    console.error('[activity-2027-contact-list] load failed', error);
  });
  document.addEventListener('app:navigate', (event) => {
    const detail = event?.detail || {};
    if (detail.route !== SCHEDULING_ROUTE || detail.courseSchedulingUsabilityReady) return;
    ensureSchedulingPatchInstalled(detail);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInstructorsHeaderCleanup, { once: true });
  } else {
    startInstructorsHeaderCleanup();
  }
}
