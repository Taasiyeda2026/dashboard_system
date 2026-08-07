import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import {
  DEFAULT_COURSE_SCHEDULING_PERIOD_KEY,
  filterMeetingsByCourseSchedulingPeriod
} from './course-scheduling-periods.js';
import { calculateCourseSchedule } from './course-scheduling-engine.js';
import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import { exceedsHomeDistanceLimit } from './instructor-matching-engine.js';

export const DISTRICT_SIMULATION_STATUSES = Object.freeze({
  ready: 'הצעה מוכנה',
  review: 'נדרשת בדיקה',
  recruit: 'נדרש גיוס',
  missing: 'חסרים נתונים'
});

export const DISTRICT_SIMULATION_LABEL = 'סימולציה בלבד - השיבוצים טרם נשמרו';
export const DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE = 'לא ניתן להשלים קורסים שחסר עבורם מסלול נסיעה אמין. הם סומנו כחסרים נתונים.';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

export function hasReliableHomeRoute(candidate = {}) {
  const home = candidate?.travel?.home;
  return !!home
    && Number.isFinite(Number(home.distance_km))
    && Number.isFinite(Number(home.duration_minutes));
}

/** Conclusive route/travel hard rejection (known distance >40 km or insufficient known transition). */
export function isConclusiveRouteFailure(message = '') {
  const value = text(message);
  if (!value) return false;
  if (/אין זמן מעבר מספיק/.test(value)) return true;
  if (/עולה על המגבלה של\s*40|40\s*ק״מ/.test(value) && /מרחק/.test(value)) return true;
  return false;
}

/**
 * Unresolved route/travel data (home route missing/unavailable, or transition that cannot be verified).
 * Distinct from conclusive known-route rejections.
 */
export function isUnresolvedRouteFailure(message = '') {
  const value = text(message);
  if (!value) return false;
  if (isConclusiveRouteFailure(value)) return false;
  if (/לא ניתן לאמת זמן מעבר/.test(value)) return true;
  if (/לא נמצא מסלול|שירות המרחקים לא היה זמין|חסרה כתובת/.test(value)) return true;
  return false;
}

function isRouteRelatedFailure(message = '') {
  const value = text(message);
  return isConclusiveRouteFailure(value)
    || isUnresolvedRouteFailure(value)
    || /מרחק|מסלול|40\s*ק״מ|מעבר/.test(value);
}

/** True when the candidate clears language/gender/availability/profile gates (route aside). */
export function passesNonRouteHardGates(candidate = {}) {
  const missing = Array.isArray(candidate?.missingProfileData) ? candidate.missingProfileData.filter(Boolean) : [];
  if (missing.length) return false;
  const failures = Array.isArray(candidate?.failures) ? candidate.failures.filter(Boolean) : [];
  return failures.every((failure) => isRouteRelatedFailure(failure));
}

export function selectedSimulationCandidate(result = {}) {
  return result?.recommended || result?.bestAvailable || null;
}

/** Home missing/unreliable, or required transition/service route data still unresolved. */
export function hasUnresolvedRouteIssue(candidate = {}) {
  if (!hasReliableHomeRoute(candidate)) return true;
  if (text(candidate?.travel?.unavailableReason)) return true;
  const failures = Array.isArray(candidate?.failures) ? candidate.failures : [];
  if (failures.some((failure) => isUnresolvedRouteFailure(failure))) return true;
  const issues = Array.isArray(candidate?.issues) ? candidate.issues : [];
  return issues.some((issue) => (
    text(issue?.kind) === 'unverified_transition'
    || isUnresolvedRouteFailure(issue?.message || issue?.label || '')
  ));
}

/**
 * Route reliability is checked only for candidates who could otherwise cover the course.
 * Rejected hard-gate candidates without calculated routes must not force חסרים נתונים.
 * Unresolved transition routes (cannot verify) count as missing data; known insufficient
 * transition time remains a conclusive rejection.
 */
export function hasUnresolvedRouteBlockingCoverage(result = {}) {
  const selected = selectedSimulationCandidate(result);
  if (selected) return hasUnresolvedRouteIssue(selected);

  const checked = Array.isArray(result.checked) ? result.checked : [];
  return checked.some((candidate) => (
    passesNonRouteHardGates(candidate) && hasUnresolvedRouteIssue(candidate)
  ));
}

/** @deprecated Prefer hasUnresolvedRouteBlockingCoverage — kept for older test imports. */
export function allCandidateRoutesUnreliable(result = {}) {
  return hasUnresolvedRouteBlockingCoverage(result);
}

export function hasKnownOverDistanceRejection(result = {}) {
  const checked = Array.isArray(result.checked) ? result.checked : [];
  return checked.some((candidate) => {
    const km = Number(candidate?.travel?.home?.distance_km);
    return Number.isFinite(km) && exceedsHomeDistanceLimit(km);
  });
}

export function mapEngineStatusToSimulation(status) {
  const value = text(status);
  if (value === 'הצעה מוכנה') return DISTRICT_SIMULATION_STATUSES.ready;
  if (value === 'נדרש טיפול' || value === 'נדרשת בדיקה') return DISTRICT_SIMULATION_STATUSES.review;
  if (value === 'נדרש גיוס') return DISTRICT_SIMULATION_STATUSES.recruit;
  if (value === 'חסר מידע' || value === 'חסרים נתונים') return DISTRICT_SIMULATION_STATUSES.missing;
  return DISTRICT_SIMULATION_STATUSES.review;
}

/**
 * Simulation-facing status. Missing/unreliable route data is never recruitment.
 * A known route above 40 km remains a conclusive rejection / recruitment signal.
 */
export function resolveDistrictSimulationStatus(result = {}) {
  const engineStatus = text(result.status);
  if (engineStatus === 'חסר מידע' || engineStatus === 'חסרים נתונים') {
    return DISTRICT_SIMULATION_STATUSES.missing;
  }
  if (hasUnresolvedRouteBlockingCoverage(result)) {
    return DISTRICT_SIMULATION_STATUSES.missing;
  }
  return mapEngineStatusToSimulation(engineStatus);
}

export function courseScheduleSlot(course = {}, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  const meetings = filterMeetingsByCourseSchedulingPeriod(activityMeetings(course), periodKey);
  const first = meetings[0] || null;
  const date = text(first?.date || course.start_date);
  const startTime = text(first?.start_time || course.start_time);
  const endTime = text(first?.end_time || course.end_time);
  let weekday = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${date}T12:00:00`));
  }
  return { weekday, startTime, endTime, date };
}

function simulationReason(result = {}, status) {
  if (status === DISTRICT_SIMULATION_STATUSES.missing) {
    const missing = Array.isArray(result.missing) ? result.missing.filter(Boolean) : [];
    if (missing.length) return `חסרים נתונים: ${missing.join(', ')}`;
    if (result.missingReliableRoute || hasUnresolvedRouteBlockingCoverage(result)) {
      return 'חסרים נתונים: מסלול נסיעה אמין';
    }
    return 'חסרים נתונים לשיבוץ';
  }
  if (status === DISTRICT_SIMULATION_STATUSES.recruit) {
    return text(result.treatmentReason) || 'לא נמצא מדריך העומד בתנאי הסף';
  }
  if (status === DISTRICT_SIMULATION_STATUSES.review) {
    return text(result.treatmentReason)
      || ((result.recommended?.warnings || []).length ? result.recommended.warnings.join('; ') : '')
      || 'נדרשת בדיקה נוספת לפני שיבוץ';
  }
  const candidate = selectedSimulationCandidate(result);
  return text(candidate?.qualityLabel) || 'הצעה מוכנה לשיבוץ';
}

export function buildDistrictSimulationRow(result = {}, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  const course = result.course || {};
  const status = resolveDistrictSimulationStatus(result);
  const missingReliableRoute = status === DISTRICT_SIMULATION_STATUSES.missing
    && hasUnresolvedRouteBlockingCoverage(result);
  const enrichedResult = missingReliableRoute ? { ...result, missingReliableRoute: true } : result;
  const slot = courseScheduleSlot(course, periodKey);
  // Unresolved selected-route cases must not surface that instructor as a proposal.
  const candidate = status === DISTRICT_SIMULATION_STATUSES.ready || status === DISTRICT_SIMULATION_STATUSES.review
    ? selectedSimulationCandidate(result)
    : null;
  const scoreValue = Number(candidate?.score);
  return {
    courseId: idOf(course),
    status,
    authority: text(course.authority) || '—',
    school: text(course.school) || '—',
    courseName: text(course.activity_name) || '—',
    weekday: slot.weekday || '—',
    startTime: slot.startTime || '—',
    endTime: slot.endTime || '—',
    proposedInstructor: text(candidate?.instructor?.full_name || candidate?.instructor?.emp_id) || '—',
    proposedInstructorEmpId: text(candidate?.instructor?.emp_id),
    score: Number.isFinite(scoreValue) ? scoreValue : null,
    reason: simulationReason(enrichedResult, status),
    missingReliableRoute,
    engineResult: result
  };
}

export function buildDistrictSimulationRows(results = [], periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  return (results || []).map((result) => buildDistrictSimulationRow(result, periodKey));
}

export function summarizeDistrictSimulation(rows = []) {
  const counts = {
    [DISTRICT_SIMULATION_STATUSES.ready]: 0,
    [DISTRICT_SIMULATION_STATUSES.review]: 0,
    [DISTRICT_SIMULATION_STATUSES.recruit]: 0,
    [DISTRICT_SIMULATION_STATUSES.missing]: 0
  };
  for (const row of rows || []) {
    const status = text(row?.status);
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  }
  return counts;
}

export function filterDistrictSimulationRows(rows = [], statusFilter = '') {
  const filter = text(statusFilter);
  if (!filter) return [...(rows || [])];
  return (rows || []).filter((row) => text(row?.status) === filter);
}

export function hasValidProposedInstructor(row = {}) {
  const candidate = selectedSimulationCandidate(row?.engineResult || {});
  const empId = text(candidate?.instructor?.emp_id || row?.proposedInstructorEmpId);
  if (!empId) return false;
  const label = text(row?.proposedInstructor);
  return !!label && label !== '—';
}

/**
 * Selection eligibility for saving simulation proposals as drafts.
 * Ready/review only, with a valid proposed instructor, and not already assigned/drafted.
 */
export function isDistrictSimulationRowSelectable(row = {}, course = null) {
  const status = text(row?.status);
  if (status !== DISTRICT_SIMULATION_STATUSES.ready && status !== DISTRICT_SIMULATION_STATUSES.review) {
    return false;
  }
  if (!hasValidProposedInstructor(row)) return false;
  const source = course || row?.engineResult?.course || {};
  if (text(source.emp_id)) return false;
  if (text(source.draft_emp_id)) return false;
  return true;
}

export function defaultSelectedSimulationCourseIds(rows = []) {
  return (rows || [])
    .filter((row) => (
      text(row?.status) === DISTRICT_SIMULATION_STATUSES.ready
      && isDistrictSimulationRowSelectable(row)
    ))
    .map((row) => text(row.courseId))
    .filter(Boolean);
}

export function normalizeSelectedSimulationCourseIds(rows = [], selectedIds = []) {
  const selectable = new Set(
    (rows || [])
      .filter((row) => isDistrictSimulationRowSelectable(row))
      .map((row) => text(row.courseId))
      .filter(Boolean)
  );
  return [...new Set((selectedIds || []).map((id) => text(id)).filter((id) => selectable.has(id)))];
}

export function districtSimulationSaveButtonLabel(selectedCount = 0) {
  const count = Number(selectedCount) || 0;
  if (count <= 0) return 'שמור נבחרים כטיוטות';
  return `שמור ${count} הצעות כטיוטות`;
}

export function districtSimulationConfirmMessage(selectedCount = 0) {
  const count = Number(selectedCount) || 0;
  return `עומדים לשמור ${count} הצעות כטיוטות. השיבוצים עדיין לא יאושרו סופית.`;
}

export function districtSimulationSaveResultMessage({ saved = 0, failed = 0 } = {}) {
  return `שמירת הטיוטות הסתיימה: ${Number(saved) || 0} נשמרו, ${Number(failed) || 0} לא נשמרו.`;
}

export function courseLabelForSimulationRow(row = {}) {
  return text(row?.school) !== '—' && text(row?.school)
    ? text(row.school)
    : (text(row?.courseName) !== '—' ? text(row.courseName) : text(row?.courseId) || 'קורס');
}

/**
 * Pre-save safety for one simulation proposal. Does not write.
 * Returns Hebrew reason when the row must not be saved.
 */
export function districtSimulationDraftSaveBlockReason({
  row,
  course,
  instructors = [],
  candidateHardBlockReason = () => ''
} = {}) {
  if (!row) return 'השורה אינה זמינה';
  const status = text(row.status);
  if (status === DISTRICT_SIMULATION_STATUSES.recruit || status === DISTRICT_SIMULATION_STATUSES.missing) {
    return status === DISTRICT_SIMULATION_STATUSES.recruit ? 'נדרש גיוס — לא ניתן לשמור' : 'חסרים נתונים — לא ניתן לשמור';
  }
  const liveCourse = course || row?.engineResult?.course || {};
  if (text(liveCourse.emp_id)) return 'הקורס כבר שובץ';
  if (text(liveCourse.draft_emp_id)) return 'הקורס כבר נשמר כטיוטה';
  if (!hasValidProposedInstructor(row)) return 'אין מדריך מוצע תקף';
  if (!isDistrictSimulationRowSelectable(row, liveCourse)) return 'לא ניתן לבחור שורה זו לשמירה';
  const candidate = selectedSimulationCandidate(row.engineResult || {});
  const empId = text(candidate?.instructor?.emp_id || row.proposedInstructorEmpId);
  const instructorExists = (instructors || []).some((instructor) => text(instructor?.emp_id) === empId);
  if (!empId || !instructorExists) return 'המדריך אינו זמין עוד';
  const hardBlock = text(candidateHardBlockReason(candidate));
  if (hardBlock) return hardBlock;
  return '';
}

/**
 * Apply per-row save outcomes: remove successes, keep failures, refresh counts/selection.
 */
export function applyDistrictSimulationSaveOutcome({
  rows = [],
  results = [],
  selectedIds = [],
  outcomes = []
} = {}) {
  const savedIds = new Set(
    (outcomes || [])
      .filter((item) => item?.ok)
      .map((item) => text(item.courseId))
      .filter(Boolean)
  );
  const failures = (outcomes || [])
    .filter((item) => !item?.ok)
    .map((item) => ({
      courseId: text(item.courseId),
      courseLabel: text(item.courseLabel) || text(item.courseId),
      reason: text(item.reason) || 'שמירה נכשלה'
    }));
  const nextRows = (rows || [])
    .filter((row) => !savedIds.has(text(row.courseId)))
    .map((row) => {
      const failure = failures.find((item) => item.courseId === text(row.courseId));
      if (!failure) return row;
      return { ...row, saveFailureReason: failure.reason };
    });
  const nextResults = (results || []).filter((result) => !savedIds.has(idOf(result?.course)));
  const nextSelected = normalizeSelectedSimulationCourseIds(
    nextRows,
    (selectedIds || []).filter((id) => !savedIds.has(text(id)))
  );
  return {
    rows: nextRows,
    results: nextResults,
    selectedIds: nextSelected,
    counts: summarizeDistrictSimulation(nextRows),
    savedCount: savedIds.size,
    failedCount: failures.length,
    failures,
    message: districtSimulationSaveResultMessage({ saved: savedIds.size, failed: failures.length })
  };
}

/**
 * Read-only district simulation. Does not write drafts, assignments, or call RPCs.
 * Scope is selected half-year + district only — authority filter is intentionally ignored.
 * Approved and saved-draft courses remain blockers via full activities input, but are
 * excluded from recommendation targets by the engine (district + eligibility filters).
 * Writes occur only through an explicit confirmed "שמור כטיוטות" action in the screen binder.
 */
export function runDistrictSchedulingSimulation(input = {}) {
  const district = normalizeOperationalDistrict(input.district);
  const periodKey = text(input.periodKey) || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  if (!district) {
    return {
      ok: false,
      error: 'יש לבחור מחוז לפני הפעלת תכנון מחוזי',
      rows: [],
      counts: summarizeDistrictSimulation([]),
      results: []
    };
  }
  const results = calculateCourseSchedule({
    ...input,
    periodKey,
    district,
    // District simulation must not inherit the ordinary authority list filter.
    authority: '',
    // Simulation must never treat itself as a write path.
    preliminary: false
  });
  const rows = buildDistrictSimulationRows(results, periodKey);
  const hasRouteMissing = rows.some((row) => row.missingReliableRoute);
  return {
    ok: true,
    error: '',
    district,
    periodKey,
    rows,
    counts: summarizeDistrictSimulation(rows),
    results,
    hasRouteMissing
  };
}

function scoreCell(score) {
  return score == null ? '—' : String(score);
}

export function districtSimulationSummaryCardsHtml(counts = {}) {
  const cards = [
    ['ready', DISTRICT_SIMULATION_STATUSES.ready, counts[DISTRICT_SIMULATION_STATUSES.ready] || 0],
    ['review', DISTRICT_SIMULATION_STATUSES.review, counts[DISTRICT_SIMULATION_STATUSES.review] || 0],
    ['recruit', DISTRICT_SIMULATION_STATUSES.recruit, counts[DISTRICT_SIMULATION_STATUSES.recruit] || 0],
    ['missing', DISTRICT_SIMULATION_STATUSES.missing, counts[DISTRICT_SIMULATION_STATUSES.missing] || 0]
  ];
  return cards.map(([key, label, value]) => (
    `<button type="button" class="course-scheduling-summary-card course-scheduling-summary-card--sim-${key}" data-simulation-status-filter="${escapeHtml(label)}"><b>${value}</b><span>${escapeHtml(label)}</span></button>`
  )).join('');
}

export function districtSimulationTableHtml(rows = [], {
  statusFilter = '',
  selectedId = '',
  selectedCourseIds = []
} = {}) {
  const filtered = filterDistrictSimulationRows(rows, statusFilter);
  if (!filtered.length) {
    return `<div class="course-scheduling-empty"><strong>אין תוצאות להצגה</strong><p>שנו את סינון הסטטוס או הפעילו מחדש את התכנון המחוזי.</p></div>`;
  }
  const selectedSet = new Set((selectedCourseIds || []).map((id) => text(id)));
  const body = filtered.map((row) => {
    const selectedClass = row.courseId && row.courseId === selectedId ? ' is-selected' : '';
    const selectable = isDistrictSimulationRowSelectable(row);
    const checked = selectable && selectedSet.has(text(row.courseId));
    const checkbox = selectable
      ? `<label class="course-scheduling-sim-check" data-simulation-select-wrap>
          <input type="checkbox" data-simulation-select-course="${escapeHtml(row.courseId)}"${checked ? ' checked' : ''} aria-label="בחירת הצעה לשמירה כטיוטה">
        </label>`
      : `<span class="course-scheduling-sim-check course-scheduling-sim-check--disabled" title="לא ניתן לבחור שורה זו" aria-hidden="true"></span>`;
    const failure = text(row.saveFailureReason)
      ? `<div class="course-scheduling-sim-save-failure">${escapeHtml(row.saveFailureReason)}</div>`
      : '';
    return `<tr class="course-scheduling-sim-row${selectedClass}${row.saveFailureReason ? ' has-save-failure' : ''}" data-simulation-course-row="${escapeHtml(row.courseId)}" role="button" tabindex="0">
      <td class="course-scheduling-sim-check-cell" data-simulation-select-cell>${checkbox}</td>
      <td><span class="course-scheduling-status-chip">${escapeHtml(row.status)}</span>${failure}</td>
      <td>${escapeHtml(row.authority)}</td>
      <td>${escapeHtml(row.school)}</td>
      <td>${escapeHtml(row.courseName)}</td>
      <td>${escapeHtml(row.weekday)}</td>
      <td><bdi dir="ltr">${escapeHtml(row.startTime)}</bdi></td>
      <td><bdi dir="ltr">${escapeHtml(row.endTime)}</bdi></td>
      <td>${escapeHtml(row.proposedInstructor)}</td>
      <td>${escapeHtml(scoreCell(row.score))}</td>
      <td>${escapeHtml(row.reason)}</td>
    </tr>`;
  }).join('');
  return `<div class="course-scheduling-sim-table-wrap">${dsTable(body)}</div>`;
}

function dsTable(body) {
  return `<table class="course-scheduling-sim-table">
    <thead>
      <tr>
        <th class="course-scheduling-sim-check-cell">בחירה</th>
        <th>סטטוס</th>
        <th>רשות</th>
        <th>בית ספר</th>
        <th>שם קורס</th>
        <th>יום</th>
        <th>שעת התחלה</th>
        <th>שעת סיום</th>
        <th>מדריך מוצע</th>
        <th>ציון</th>
        <th>סיבה</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function districtSimulationStatusFilterHtml(activeFilter = '') {
  const options = [
    ['', 'כל הסטטוסים'],
    [DISTRICT_SIMULATION_STATUSES.ready, DISTRICT_SIMULATION_STATUSES.ready],
    [DISTRICT_SIMULATION_STATUSES.review, DISTRICT_SIMULATION_STATUSES.review],
    [DISTRICT_SIMULATION_STATUSES.recruit, DISTRICT_SIMULATION_STATUSES.recruit],
    [DISTRICT_SIMULATION_STATUSES.missing, DISTRICT_SIMULATION_STATUSES.missing]
  ];
  return `<label class="course-scheduling-sim-filter">סינון לפי סטטוס
    <select class="course-scheduling-input" data-simulation-status-select>
      ${options.map(([value, label]) => `<option value="${escapeHtml(value)}"${text(activeFilter) === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
    </select>
  </label>`;
}

export function districtSimulationSaveResultHtml(result = null) {
  if (!result?.message) return '';
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const failureList = failures.length
    ? `<ul class="course-scheduling-sim-save-failures">${failures.map((item) => (
      `<li><strong>${escapeHtml(item.courseLabel || item.courseId || 'קורס')}</strong> - ${escapeHtml(item.reason || 'שמירה נכשלה')}</li>`
    )).join('')}</ul>`
    : '';
  return `<div class="course-scheduling-sim-save-result" data-simulation-save-result role="status">
    <p>${escapeHtml(result.message)}</p>
    ${failureList}
  </div>`;
}

export function districtSimulationConfirmDialogHtml({ open = false, selectedCount = 0 } = {}) {
  if (!open) return '';
  return `<div class="course-scheduling-overlay" data-district-simulation-confirm-overlay>
    <div class="course-scheduling-modal course-scheduling-sim-confirm" role="dialog" aria-modal="true" aria-labelledby="district-sim-save-confirm-title" data-district-simulation-confirm>
      <p id="district-sim-save-confirm-title">${escapeHtml(districtSimulationConfirmMessage(selectedCount))}</p>
      <div class="course-scheduling-sim-confirm-actions">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-cancel-simulation-draft-save>ביטול</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-confirm-simulation-draft-save>שמור כטיוטות</button>
      </div>
    </div>
  </div>`;
}

export function districtSimulationPanelHtml({
  rows = [],
  counts = {},
  statusFilter = '',
  selectedId = '',
  selectedCourseIds = null,
  district = '',
  loading = false,
  error = '',
  saving = false,
  confirmSave = false,
  saveResult = null
} = {}) {
  if (loading) {
    return `<section class="course-scheduling-simulation" data-district-simulation-panel>
      <p class="course-scheduling-sim-banner">${escapeHtml(DISTRICT_SIMULATION_LABEL)}</p>
      <div class="course-scheduling-loading" aria-live="polite"><strong>מחשב תכנון מחוזי...</strong></div>
    </section>`;
  }
  const selectedIds = selectedCourseIds == null
    ? defaultSelectedSimulationCourseIds(rows)
    : normalizeSelectedSimulationCourseIds(rows, selectedCourseIds);
  const selectedCount = selectedIds.length;
  const saveDisabled = selectedCount === 0 || saving;
  const saveLabel = saving ? 'שומר טיוטות...' : districtSimulationSaveButtonLabel(selectedCount);
  return `<section class="course-scheduling-simulation" data-district-simulation-panel>
    <p class="course-scheduling-sim-banner" role="status">${escapeHtml(DISTRICT_SIMULATION_LABEL)}</p>
    ${error ? `<p class="course-scheduling-alert">${escapeHtml(error)}</p>` : ''}
    ${districtSimulationSaveResultHtml(saveResult)}
    <div class="course-scheduling-sim-toolbar">
      <p class="course-scheduling-muted">מחוז ${escapeHtml(district || '—')} · ${rows.length} קורסים בסימולציה</p>
      ${districtSimulationStatusFilterHtml(statusFilter)}
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-save-simulation-drafts ${saveDisabled ? 'disabled' : ''}>${escapeHtml(saveLabel)}</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-close-district-simulation>חזרה לרשימת הקורסים</button>
    </div>
    <section class="course-scheduling-summary course-scheduling-summary--simulation">${districtSimulationSummaryCardsHtml(counts)}</section>
    ${districtSimulationTableHtml(rows, { statusFilter, selectedId, selectedCourseIds: selectedIds })}
    ${districtSimulationConfirmDialogHtml({ open: confirmSave, selectedCount })}
  </section>`;
}
