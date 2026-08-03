const SNAPSHOT_KEY = 'dashboard:course-scheduling-calculation-v1';
const ROUTE = 'course-scheduling';
const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
let installPromise = null;
let installed = false;
let rerenderQueued = false;

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
    const actionable = courses.filter((course) => !text(course.emp_id));
    const source = actionable.length ? actionable : courses;
    return [...source].sort((first, second) => {
      const firstDate = text(first.start_date);
      const secondDate = text(second.start_date);
      const firstPast = firstDate && firstDate < today ? 1 : 0;
      const secondPast = secondDate && secondDate < today ? 1 : 0;
      if (firstPast !== secondPast) return firstPast - secondPast;
      return firstDate.localeCompare(secondDate);
    })[0] || null;
  }

  function activeResults(state, courses) {
    const courseById = new Map(courses.map((course) => [idOf(course), course]));
    return (state.courseSchedulingResults || []).filter((result) => {
      const course = courseById.get(idOf(result?.course));
      return course && !text(course.emp_id) && !text(course.draft_emp_id);
    });
  }

  function restoreSnapshot(state, courses) {
    if ((state.courseSchedulingResults || []).length) return;
    try {
      const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
      if (!snapshot || !Array.isArray(snapshot.results)) return;
      const courseById = new Map(courses.map((course) => [idOf(course), course]));
      state.courseSchedulingResults = snapshot.results.flatMap((result) => {
        const course = courseById.get(idOf(result?.course));
        return course && !text(course.emp_id) && !text(course.draft_emp_id)
          ? [{ ...result, course }]
          : [];
      });
      state.courseSchedulingCalculatedAt = text(snapshot.calculatedAt);
    } catch {
      try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* local storage may be unavailable */ }
    }
  }

  function saveSnapshot(state, courses) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        calculatedAt: state.courseSchedulingCalculatedAt || '',
        results: activeResults(state, courses)
      }));
    } catch {
      // Persistence is a convenience only. The scheduling flow must keep working without it.
    }
  }

  function readinessHtml(data) {
    const instructors = (data?.instructors || []).filter((row) => {
      const value = text(row.active).toLowerCase();
      return value === 'yes' || value === 'true' || value === '1';
    });
    const profiles = new Map((data?.scheduling?.profiles || []).map((row) => [text(row.emp_id), row]));
    const ruleCounts = new Map();
    for (const rule of (data?.scheduling?.rules || [])) {
      const empId = text(rule.emp_id);
      if (empId) ruleCounts.set(empId, (ruleCounts.get(empId) || 0) + 1);
    }
    const missingProfile = instructors.filter((row) => !profiles.has(text(row.emp_id))).length;
    const missingAddress = instructors.filter((row) => !text(row.address)).length;
    const missingAvailability = instructors.filter((row) => (ruleCounts.get(text(row.emp_id)) || 0) < 5).length;
    const ready = instructors.filter((row) => profiles.has(text(row.emp_id)) && text(row.address) && (ruleCounts.get(text(row.emp_id)) || 0) >= 5).length;
    return `<section class="course-scheduling__readiness"><b>מוכנות לשיבוץ: ${ready} מתוך ${instructors.length} מדריכים</b><span>${missingAvailability} ללא זמינות שבועית מלאה</span><span>${missingProfile} ללא פרופיל שיבוץ</span><span>${missingAddress} ללא כתובת</span></section>`;
  }

  function summaryHtml(state, courses) {
    const results = activeResults(state, courses);
    const ready = results.filter((result) => result.status === 'הצעה מוכנה').length;
    const treatment = results.filter((result) => result.status === 'נדרש טיפול').length;
    const recruit = results.filter((result) => result.status === 'נדרש גיוס').length;
    const missing = results.filter((result) => result.status === 'חסר מידע').length;
    const drafts = courses.filter((course) => !text(course.emp_id) && text(course.draft_emp_id)).length;
    const waiting = courses.filter((course) => !text(course.emp_id) && !text(course.draft_emp_id)).length;
    const calculatedIds = new Set(results.map((result) => idOf(result.course)));
    const notCalculated = courses.filter((course) => !text(course.emp_id) && !text(course.draft_emp_id) && !calculatedIds.has(idOf(course))).length;
    return `<section class="course-scheduling__summary"><span>חישוב אחרון: ${escapeHtml(state.courseSchedulingCalculatedAt || 'טרם בוצע')}</span><b>${waiting} קורסים ממתינים לשיבוץ</b><b>${notCalculated} טרם חושבו</b><b>${ready} הצעה מוכנה</b><b>${drafts} בטיוטה</b><b>${treatment} נדרש טיפול</b><b>${recruit} נדרש גיוס</b><b>${missing} חסר מידע</b></section>`;
  }

  courseSchedulingScreen.render = function patchedRender(data, context) {
    const courses = interfaceCourses(data);
    const { state } = context;
    restoreSnapshot(state, courses);

    const selectedExists = courses.some((course) => idOf(course) === text(state.courseSchedulingSelectedId));
    if (!selectedExists) {
      const nearest = nearestCourse(courses);
      if (nearest) {
        state.courseSchedulingSelectedId = idOf(nearest);
        state.courseSchedulingWeek = text(nearest.start_date) || state.courseSchedulingWeek;
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
      const status = text(card.querySelector('.ds-status-chip')?.textContent);
      card.classList.toggle('is-status-ready', status === 'הצעה מוכנה');
      card.classList.toggle('is-status-warning', status === 'ממתין לחישוב' || status === 'חסר מידע');
      card.classList.toggle('is-status-danger', status === 'נדרש טיפול' || status === 'נדרש גיוס');
      card.classList.toggle('is-status-draft', status === 'שמור בטיוטה');
    });

    const selected = courses.find((course) => idOf(course) === text(state.courseSchedulingSelectedId));
    const empty = root.querySelector('.course-calendar__empty');
    if (empty && selected && !text(selected.emp_id) && !text(selected.draft_emp_id)) {
      empty.classList.add('course-calendar__selected-empty');
      empty.textContent = '';
      const message = document.createElement('span');
      message.textContent = `הקורס „${text(selected.activity_name) || 'הנבחר'}” טרם שובץ. לאחר חישוב ובחירת מדריך הוא יוצג כאן במערכת השבועית.`;
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
          const completed = sawLoading && !state.courseSchedulingLoading && !!text(state.courseSchedulingCalculatedAt);
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

function ensureInstalledAndRerender(detail = {}) {
  if (installed) return;
  installPromise ||= installCourseSchedulingUsabilityPatch()
    .then(() => { installed = true; })
    .catch((error) => {
      installPromise = null;
      console.error('[course-scheduling-usability] install failed', error);
      throw error;
    });
  if (rerenderQueued) return;
  rerenderQueued = true;
  installPromise.then(() => {
    rerenderQueued = false;
    document.dispatchEvent(new CustomEvent('app:navigate', {
      detail: { ...detail, route: ROUTE, courseSchedulingUsabilityReady: true }
    }));
  }).catch(() => { rerenderQueued = false; });
}

document.addEventListener('app:navigate', (event) => {
  const detail = event?.detail || {};
  if (detail.route !== ROUTE || detail.courseSchedulingUsabilityReady) return;
  ensureInstalledAndRerender(detail);
});
