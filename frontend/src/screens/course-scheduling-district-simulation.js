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

function isRouteRelatedFailure(message = '') {
  return /מרחק|מסלול|40\s*ק״מ|מעבר/.test(text(message));
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

/**
 * Route reliability is checked only for candidates who could otherwise cover the course.
 * Rejected hard-gate candidates without calculated routes must not force חסרים נתונים.
 */
export function hasUnresolvedRouteBlockingCoverage(result = {}) {
  const selected = selectedSimulationCandidate(result);
  if (selected) return !hasReliableHomeRoute(selected);

  const checked = Array.isArray(result.checked) ? result.checked : [];
  return checked.some((candidate) => (
    passesNonRouteHardGates(candidate) && !hasReliableHomeRoute(candidate)
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

/**
 * Read-only district simulation. Does not write drafts, assignments, or call RPCs.
 * Scope is selected half-year + district only — authority filter is intentionally ignored.
 * Approved and saved-draft courses remain blockers via full activities input, but are
 * excluded from recommendation targets by the engine (district + eligibility filters).
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

export function districtSimulationTableHtml(rows = [], { statusFilter = '', selectedId = '' } = {}) {
  const filtered = filterDistrictSimulationRows(rows, statusFilter);
  if (!filtered.length) {
    return `<div class="course-scheduling-empty"><strong>אין תוצאות להצגה</strong><p>שנו את סינון הסטטוס או הפעילו מחדש את התכנון המחוזי.</p></div>`;
  }
  const body = filtered.map((row) => {
    const selectedClass = row.courseId && row.courseId === selectedId ? ' is-selected' : '';
    return `<tr class="course-scheduling-sim-row${selectedClass}" data-simulation-course-row="${escapeHtml(row.courseId)}" role="button" tabindex="0">
      <td><span class="course-scheduling-status-chip">${escapeHtml(row.status)}</span></td>
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

export function districtSimulationPanelHtml({
  rows = [],
  counts = {},
  statusFilter = '',
  selectedId = '',
  district = '',
  loading = false,
  error = ''
} = {}) {
  if (loading) {
    return `<section class="course-scheduling-simulation" data-district-simulation-panel>
      <p class="course-scheduling-sim-banner">${escapeHtml(DISTRICT_SIMULATION_LABEL)}</p>
      <div class="course-scheduling-loading" aria-live="polite"><strong>מחשב תכנון מחוזי...</strong></div>
    </section>`;
  }
  return `<section class="course-scheduling-simulation" data-district-simulation-panel>
    <p class="course-scheduling-sim-banner" role="status">${escapeHtml(DISTRICT_SIMULATION_LABEL)}</p>
    ${error ? `<p class="course-scheduling-alert">${escapeHtml(error)}</p>` : ''}
    <div class="course-scheduling-sim-toolbar">
      <p class="course-scheduling-muted">מחוז ${escapeHtml(district || '—')} · ${rows.length} קורסים בסימולציה</p>
      ${districtSimulationStatusFilterHtml(statusFilter)}
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-close-district-simulation>חזרה לרשימת הקורסים</button>
    </div>
    <section class="course-scheduling-summary course-scheduling-summary--simulation">${districtSimulationSummaryCardsHtml(counts)}</section>
    ${districtSimulationTableHtml(rows, { statusFilter, selectedId })}
  </section>`;
}
