const PAYROLL_WINDOW_NAME = 'dashboard-payroll-control';
const REVIEW_FIX_MARK = '__dashboardPayrollTestReviewFixInstalled';

const text = (value) => String(value ?? '').trim();
const activityKey = (value) => text(value).normalize('NFKD').toLowerCase()
  .replace(/[׳״'"`´’‘“”.,;:()\[\]{}\-_/\\\u05BE\u2010-\u2015]/g, '')
  .replace(/\s+/g, '');

const NON_COURSE_DIRECT_TIME_TYPES = new Set(['סדנה', 'סדנאותקיץ', 'סיור', 'חדרבריחה']);
const MANUAL_TYPES = new Set(['ביטולזמן', 'הכשרה', 'תפעול']);

function timeMinutes(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function directHours(startTime, endTime) {
  const start = timeMinutes(startTime);
  let end = timeMinutes(endTime);
  if (start == null || end == null) return null;
  if (end < start) end += 1440;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function approxEqual(left, right, tolerance = 0.02) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function compatibleActivityTypes(attendanceType, dashboardType) {
  const attendance = activityKey(attendanceType);
  const dashboard = activityKey(dashboardType);
  if (attendance === dashboard) return true;
  return attendance === 'סדנאותקיץ' && dashboard === 'סדנה';
}

function dayKey(employeeId, date) {
  return `${text(employeeId)}|${text(date)}`;
}

function addReason(map, key, reason) {
  if (!key || !reason) return;
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(reason)) map.get(key).push(reason);
}

/** Test-mode-only review layer. Production payroll comparison logic is untouched. */
export function preparePayrollTestReviewResult(sourceResult = {}) {
  const result = {
    ...sourceResult,
    comparisons: (sourceResult.comparisons || []).map((comparison) => ({
      ...comparison,
      attendance: { ...(comparison.attendance || {}) },
      dashboard: comparison.dashboard ? { ...comparison.dashboard } : comparison.dashboard,
      final: comparison.final ? { ...comparison.final } : comparison.final,
      differences: [...(comparison.differences || [])]
    })),
    notCompared: (sourceResult.notCompared || []).map((entry) => ({
      ...entry,
      attendance: { ...(entry.attendance || {}) },
      final: entry.final ? { ...entry.final } : entry.final
    })),
    dashboardOnly: (sourceResult.dashboardOnly || []).map((entry) => ({
      ...entry,
      dashboard: { ...(entry.dashboard || {}) },
      final: entry.final ? { ...entry.final } : entry.final
    })),
    dailyKilometers: (sourceResult.dailyKilometers || []).map((day) => ({ ...day }))
  };

  const manualReasons = new Map();
  const reviewReasons = new Map();

  result.comparisons.forEach((comparison) => {
    const attendance = comparison.attendance || {};
    const dashboard = comparison.dashboard || {};
    const type = activityKey(attendance.activityType);
    const key = dayKey(attendance.employeeId, attendance.date);

    if (!comparison.unmatched && NON_COURSE_DIRECT_TIME_TYPES.has(type)) {
      comparison.differences = comparison.differences.filter((diff) => {
        if (diff.key === 'meetingNo' && !text(attendance.meetingNo)) return false;
        if (diff.key === 'activityType' && compatibleActivityTypes(attendance.activityType, dashboard.activityType)) return false;
        return true;
      });

      const clockHours = directHours(attendance.startTime, attendance.endTime);
      if (clockHours != null && approxEqual(clockHours, attendance.workHours)) {
        dashboard.workHours = Number(attendance.workHours);
        dashboard.payrollHoursRequireReview = false;
        comparison.differences = comparison.differences.filter((diff) => diff.key !== 'workHours');
      } else {
        dashboard.payrollHoursRequireReview = true;
        addReason(reviewReasons, key, 'שעות שכר – נדרש לבדוק');
      }
    }

    const expenses = Number(attendance.expenses || 0);
    if (Number.isFinite(expenses) && expenses > 0) {
      addReason(manualReasons, key, 'הוצאה – נדרש אישור ידני');
    }
  });

  result.notCompared.forEach((entry) => {
    const attendance = entry.attendance || {};
    const type = activityKey(attendance.activityType);
    if (MANUAL_TYPES.has(type)) {
      addReason(manualReasons, dayKey(attendance.employeeId, attendance.date), `${attendance.activityType} – נדרש אישור ידני`);
    }
  });

  result.dailyKilometers.forEach((km) => {
    const key = dayKey(km.employeeId, km.date);
    if (km.calculated == null) {
      if (Number(km.reported || 0) > 0) addReason(reviewReasons, key, 'ק״מ – לא ניתן לחשב, נדרש לבדוק');
      return;
    }
    if (!km.matches) addReason(reviewReasons, key, `ק״מ – דווח ${km.reported}, חושב ${km.calculated}`);
  });

  const dayStates = new Map();
  const ensureDay = (key, name = '') => {
    if (!dayStates.has(key)) dayStates.set(key, {
      name,
      gapCount: 0,
      reviewReasons: [],
      manualReasons: [],
      status: 'ok',
      issueCount: 0
    });
    if (name && !dayStates.get(key).name) dayStates.get(key).name = name;
    return dayStates.get(key);
  };

  result.comparisons.forEach((comparison) => {
    const attendance = comparison.attendance || {};
    const state = ensureDay(dayKey(attendance.employeeId, attendance.date), attendance.employeeName);
    if (comparison.unmatched || comparison.differences.length) state.gapCount += 1;
  });
  result.notCompared.forEach((entry) => {
    const attendance = entry.attendance || {};
    ensureDay(dayKey(attendance.employeeId, attendance.date), attendance.employeeName);
  });
  result.dashboardOnly.forEach((entry) => {
    const dashboard = entry.dashboard || {};
    const state = ensureDay(dayKey(dashboard.employeeId, dashboard.date), dashboard.employeeName);
    state.gapCount += 1;
  });

  reviewReasons.forEach((reasons, key) => {
    const state = ensureDay(key);
    state.reviewReasons = [...reasons];
  });
  manualReasons.forEach((reasons, key) => {
    const state = ensureDay(key);
    state.manualReasons = [...reasons];
  });

  dayStates.forEach((state) => {
    const hasReview = state.gapCount > 0 || state.reviewReasons.length > 0;
    const hasManual = state.manualReasons.length > 0;
    state.status = hasReview && hasManual ? 'review_and_manual' : hasReview ? 'review' : hasManual ? 'manual' : 'ok';
    state.issueCount = state.gapCount + state.reviewReasons.length + state.manualReasons.length;
  });

  return { result, dayStates };
}

function decorateTestResult(doc, dayStates) {
  const results = doc.querySelector('[data-attendance-results]');
  if (!results) return;

  results.querySelectorAll('.attendance-control__day--not-compared').forEach((row) => {
    const status = row.querySelector('.attendance-control__row-status');
    if (status) status.textContent = 'נדרש אישור ידני';
  });

  results.querySelectorAll('.attendance-control__employee').forEach((card) => {
    const summary = card.querySelector(':scope > summary');
    const strong = summary?.querySelector('strong');
    if (!summary || !strong) return;
    const dateMatch = strong.textContent.match(/\d{4}-\d{2}-\d{2}/);
    if (!dateMatch) return;
    const date = dateMatch[0];
    const stateEntry = [...dayStates.entries()].find(([key]) => key.endsWith(`|${date}`));
    if (!stateEntry) return;
    const [, state] = stateEntry;
    const status = summary.querySelector('span');
    const label = state.status === 'ok' ? 'תקין'
      : state.status === 'manual' ? 'נדרש אישור ידני'
      : state.status === 'review_and_manual' ? 'לבדיקה + אישור ידני'
      : 'לבדיקה';
    if (status) status.textContent = label;
    strong.textContent = strong.textContent.replace(/\|\s*\d+\s+חריגות\s*$/u, `| ${state.issueCount ? `${state.issueCount} נושאים לבדיקה` : 'ללא נושאים לבדיקה'}`);

    const reasons = [...state.reviewReasons, ...state.manualReasons];
    if (reasons.length && !card.querySelector('.payroll-test-review-reasons')) {
      const box = doc.createElement('div');
      box.className = 'payroll-test-review-reasons';
      const heading = state.manualReasons.length ? 'נדרש טיפול לפני תשלום:' : 'נדרש לבדוק:';
      box.innerHTML = `<strong>${heading}</strong> ${reasons.map((reason) => `<span>${reason}</span>`).join('')}`;
      card.querySelector('.attendance-control__employee-summary')?.insertAdjacentElement('afterend', box);
    }
  });

  const states = [...dayStates.values()];
  const summaryBar = results.querySelector('.attendance-control__summary-bar');
  if (summaryBar) {
    const employeeNames = new Set(states.map((state) => state.name).filter(Boolean));
    const ok = states.filter((state) => state.status === 'ok').length;
    const review = states.filter((state) => state.status === 'review' || state.status === 'review_and_manual').length;
    const manual = states.filter((state) => state.status === 'manual' || state.status === 'review_and_manual').length;
    summaryBar.innerHTML = `<span>מדריכים <b>${employeeNames.size}</b></span><span>תקינים <b>${ok}</b></span><span>לבדיקה <b>${review}</b></span><span>אישור ידני <b>${manual}</b></span>`;
  }
}

function ensureStyles(doc) {
  if (!doc?.head || doc.getElementById('payroll-test-review-fix-styles')) return;
  const style = doc.createElement('style');
  style.id = 'payroll-test-review-fix-styles';
  style.textContent = `
    [data-payroll-window] .payroll-test-review-reasons{margin:7px 13px;padding:10px 12px;border:1px solid #f0c36d;border-radius:9px;background:#fffaf0;color:#8a5a00;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    [data-payroll-window] .payroll-test-review-reasons span{padding:4px 8px;border:1px solid #f0d9a5;border-radius:7px;background:#fff}
  `;
  doc.head.appendChild(style);
}

function applyReviewFix(doc) {
  const panel = doc?.querySelector?.('[data-attendance-control]');
  if (!panel || panel.dataset.payrollTestMode !== 'true') return false;
  const sourceResult = panel.__payrollTestResult;
  const moduleApi = panel.__payrollTestModuleApi;
  const results = panel.querySelector('[data-attendance-results]');
  if (!sourceResult || !moduleApi?.resultsHtml || !results) return false;
  if (panel.__payrollTestReviewFixedResult === sourceResult) return true;

  const banner = results.querySelector('.payroll-test-mode-banner')?.outerHTML || '';
  const prepared = preparePayrollTestReviewResult(sourceResult);
  prepared.result.month = sourceResult.month;
  panel.__payrollTestResult = prepared.result;
  ensureStyles(doc);
  results.innerHTML = `${banner}${moduleApi.resultsHtml(prepared.result, prepared.result.month || '2027-01')}`;
  results.querySelector('[data-attendance-export]')?.remove();
  decorateTestResult(doc, prepared.dayStates);
  panel.__payrollTestReviewFixedResult = prepared.result;
  return true;
}

function observePopup(popup) {
  if (!popup || popup.closed) return;
  const doc = popup.document;
  ensureStyles(doc);
  const Observer = doc.defaultView?.MutationObserver || MutationObserver;
  const observer = new Observer(() => applyReviewFix(doc));
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-payroll-test-mode'] });
  applyReviewFix(doc);
}

export function installPayrollControlTestReviewFix(targetWindow = typeof window !== 'undefined' ? window : null) {
  if (!targetWindow || targetWindow[REVIEW_FIX_MARK]) return false;
  targetWindow[REVIEW_FIX_MARK] = true;
  const originalOpen = targetWindow.open?.bind(targetWindow);
  if (typeof originalOpen !== 'function') return false;
  targetWindow.open = function patchedPayrollReviewOpen(url, name, features) {
    const popup = originalOpen(url, name, features);
    if (name === PAYROLL_WINDOW_NAME && popup) {
      try { observePopup(popup); } catch (error) { console.warn('[payroll-test-review-fix] failed', error); }
    }
    return popup;
  };
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installPayrollControlTestReviewFix(window);
}
