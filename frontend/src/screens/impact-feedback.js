/**
 * "משובים" — admin-only module.
 * Six tabs that share the dashboard academic year and one selected course:
 *   סקירה כללית · תלמידים · מדריכים · צוות חינוכי · ניתוח והשוואה
 * The unit of analysis is a course + respondent population. Results are computed from every valid
 * answer (feedback_admin_answer_facts), collection figures from feedback_admin_course_summary.
 * Server enforces admin access (RLS + admin-checked RPCs); the client check is only UX.
 */
import * as XLSX from 'xlsx';
import { escapeHtml as esc } from './shared/html.js';
import { showToast } from './shared/toast.js';
import { ACTIVE_ACTIVITY_SEASON, normalizeGlobalActivityPeriod } from './shared/summer-activity.js';
import {
  AUDIENCE_LABELS,
  AUDIENCE_ORDER,
  AUDIENCE_STAGES,
  GROUP_SLOTS,
  PHASE_LABELS,
  QUESTION_EXPORT_HEADERS,
  RAW_EXPORT_HEADERS,
  SLOTS,
  SUMMARY_EXPORT_HEADERS,
  academicYearLabel,
  audienceMetricScores,
  campaignUiStatus,
  comparePrePostByQuestion,
  courseCollection,
  courseLabel as domainCourseLabel,
  crossCourseCore,
  describeGroupChange,
  factsFor,
  filterGroups,
  groupHasFeedback,
  hasCourseStartDate,
  hasCourseEndDate,
  studentFeedbackPeriodForGroup,
  filterFeedbackFactsForHalf,
  studentFeedbackHasResponses,
  sortStudentFeedbackGroups,
  sortEducationalStaffFeedbackGroups,
  isProgramUnresolved,
  openAnswers,
  overviewTotals,
  questionExportRows,
  questionStats,
  rawExportRows,
  slotCampaign,
  stageLabelFor,
  stagePhase,
  strengthsAndGaps,
  summaryExportRows,
  threePerspectives,
  uniqueSorted
} from '../impact-feedback/feedback-domain.js';
import {
  fetchAnswerFacts,
  fetchCourseSummary,
  fetchGroups,
  fetchInstructorAssignments,
  fetchMetrics,
  fetchPrograms,
  openCampaign,
  openInstructorCampaign,
  translateFeedbackError,
  updateCampaign
} from '../impact-feedback/feedback-api.js';
import { campaignLink, copyText, openQrProjection, personalShareLinks } from '../impact-feedback/feedback-share.js';
import { renderTemplatesView, bindTemplatesView } from '../impact-feedback/feedback-templates-view.js';
import '../impact-feedback/feedback-form.css';
import '../impact-feedback/impact-feedback-admin.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_SYNC_INTERVAL_MS = 60 * 1000;
const ACTIVITY_SYNC_MIN_GAP_MS = 12 * 1000;
let activitySyncController = null;
let activitySyncTimer = null;
/** Minimum valid answers before a question is ranked as a strength / improvement area. */
const MIN_N_RANKING = 5;
/** Minimum respondents per population before a gap between populations is described. */
const MIN_N_GAP = 3;

const TABS = [
  { key: 'overview', label: 'סקירה כללית' },
  { key: 'students', label: 'תלמידים' },
  { key: 'instructors', label: 'מדריכים' },
  { key: 'staff', label: 'צוות חינוכי' },
  { key: 'analysis', label: 'ניתוח והשוואה' },
  { key: 'templates', label: 'תבניות' }
];

/** Data each tab needs; loaded per academic year and cached until refresh or a mutation. */
const TAB_NEEDS = {
  // Every tab's results are scoped to the same activities and instructor cohorts.
  overview: ['summary', 'facts', 'groups', 'assignments'],
  students: ['summary', 'groups', 'assignments', 'facts'],
  instructors: ['summary', 'assignments', 'groups', 'facts'],
  staff: ['summary', 'groups', 'assignments', 'facts'],
  analysis: ['summary', 'groups', 'assignments', 'facts'],
  templates: []
};

const ui = {
  tab: 'overview',
  groupRowId: null,
  groupReturnTab: 'students',
  feedbackHalf: 'first',
  year: ACTIVE_ACTIVITY_SEASON,
  course: '',
  showAll: true,
  overview: { audience: '', phase: '' },
  filters: { authority: '', school: '', instructor: '', manager: '', status: '', search: '' },
  analysis: { audience: 'student', stage: 'post' },
  results: { drill: '' },
  templates: { templateId: null, versionId: null, previewBand: '' },
  instructorFilters: { instructor: '', manager: '', status: '' },
  filterExpanded: { overview: false, students: false, staff: false, instructors: false, analysis: false, templates: false },
  groups: null,
  groupsYear: null,
  instructorAssignments: null,
  instructorAssignmentsYear: null,
  summary: null,
  summaryYear: null,
  summaryHalf: null,
  metrics: [],
  programs: [],
  facts: null,
  factsYear: null,
  groupFacts: new Map(),
  openForms: new Set(),
  instructorOpenForms: new Set(),
  loading: false,
  error: ''
};

function isAdmin(state) {
  return String(state?.user?.role || '').trim().toLowerCase() === 'admin';
}

function programByKey(key) {
  return ui.programs.find((p) => p.key === key) || null;
}

/** Short course name; look-alike titles (two Biomimicry courses) always carry level + Gefen. */
function programTitle(key) {
  const program = programByKey(key);
  return program ? domainCourseLabel(program, ui.programs) : (key || '');
}

function educationLevelLabel(level) {
  return level === 'elementary' ? 'יסודי' : level === 'secondary' ? 'חטיבת ביניים ותיכון' : '';
}

function programOptionLabel(key) {
  const program = programByKey(key);
  if (!program) return key || '';
  const gefen = Array.isArray(program.gefen_numbers) ? program.gefen_numbers.join(', ') : '';
  return [program.title, educationLevelLabel(program.education_level), gefen ? `גפ״ן ${gefen}` : ''].filter(Boolean).join(' · ');
}

function metricLabel(key) {
  return ui.metrics.find((m) => m.key === key)?.label || key;
}

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtNum(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
}

function fmtDelta(value) {
  if (value === null || value === undefined) return '—';
  return `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}`;
}

function deltaClass(value) {
  return value > 0 ? 'ifb-up' : value < 0 ? 'ifb-down' : '';
}

function isoDay(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date input (local) -> timestamptz. Opening today means "now"; expiry means end of that day. */
function openingIso(day) {
  if (!day || day <= isoDay(Date.now())) return new Date().toISOString();
  return new Date(`${day}T07:00:00`).toISOString();
}

function expiryIso(day) {
  if (!day) return null;
  return new Date(`${day}T23:59:00`).toISOString();
}

const STATUS_ICONS = { muted: '○', scheduled: '◷', active: '●', pending: '◷', success: '✓', warning: '!', closed: '–', info: '●' };

/** The single status representation in the module: small icon + semantic-colour text (no capsule). */
function statusText(label, tone = 'muted', key = '') {
  return `<span class="ifb-status ifb-status--${tone}"${key ? ` data-status="${esc(key)}"` : ''}><span class="ifb-status__icon" aria-hidden="true">${STATUS_ICONS[tone] || '●'}</span><span class="ifb-status__label">${esc(label)}</span></span>`;
}

function campaignStatusHtml(campaign) {
  const status = campaignUiStatus(campaign);
  return statusText(status.label, status.tone, status.key);
}

function tableStatusHtml(campaign) {
  const status = campaignUiStatus(campaign);
  const responseCount = Number(status.responses || 0);
  return `<div class="ifb-status-cell">
    ${statusText(status.label, status.tone, status.key)}
    ${responseCount > 0 ? `<span class="ifb-status-cell__count">${responseCount} שאלונים</span>` : ''}
  </div>`;
}

function optionList(values, selected, emptyLabel, labelFn = (v) => v) {
  return `<option value="">${esc(emptyLabel)}</option>${values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labelFn(v))}</option>`).join('')}`;
}


/** Single-hue magnitude bar; the value is always printed as text next to it. */
function barHtml(value, max, label = '') {
  const width = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return `<span class="ifb-bar" aria-hidden="true"${label ? ` title="${esc(label)}"` : ''}><span style="width:${width}%"></span></span>`;
}

/** 1–5 distribution as five thin columns (single hue), with an accessible text equivalent. */
function distributionHtml(dist = [0, 0, 0, 0, 0]) {
  const total = dist.reduce((a, b) => a + b, 0);
  if (!total) return '<span class="ifb-muted">—</span>';
  const max = Math.max(...dist);
  const text = dist.map((n, i) => `${i + 1}: ${n}`).join(', ');
  return `<span class="ifb-dist5" role="img" aria-label="התפלגות תשובות – ${esc(text)}">${dist.map((n, i) => `
    <span class="ifb-dist5__col" title="${i + 1} – ${n} תשובות (${Math.round((n / total) * 100)}%)"><span style="height:${max ? Math.max(n ? 8 : 0, Math.round((n / max) * 100)) : 0}%"></span></span>`).join('')}
  </span>`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function ensureDefinitions() {
  if (ui.metrics.length && ui.programs.length) return;
  const [metrics, programs] = await Promise.all([fetchMetrics(), fetchPrograms()]);
  ui.metrics = metrics || [];
  ui.programs = programs || [];
}

async function ensureGroups(force = false) {
  if (!force && ui.groups && ui.groupsYear === ui.year) return;
  ui.groups = await fetchGroups(ui.year);
  ui.groupsYear = ui.year;
}

async function ensureInstructorAssignments(force = false) {
  if (!force && ui.instructorAssignments && ui.instructorAssignmentsYear === ui.year) return;
  ui.instructorAssignments = await fetchInstructorAssignments(ui.year);
  ui.instructorAssignmentsYear = ui.year;
}

async function ensureSummary(force = false) {
  if (!force && ui.summary && ui.summaryYear === ui.year && ui.summaryHalf === ui.feedbackHalf) return;
  const year = ui.year;
  const half = ui.feedbackHalf;
  const rows = await fetchCourseSummary(year, half);
  if (year !== ui.year || half !== ui.feedbackHalf) return;
  ui.summary = rows;
  ui.summaryYear = year;
  ui.summaryHalf = half;
}

async function ensureFacts(force = false) {
  if (!force && ui.facts && ui.factsYear === ui.year) return;
  ui.facts = await fetchAnswerFacts({ academic_year: ui.year });
  ui.factsYear = ui.year;
}

async function ensureGroupFacts(rowId, force = false) {
  if (!force && ui.groupFacts.has(rowId)) return ui.groupFacts.get(rowId);
  const facts = await fetchAnswerFacts({ activity_row_id: rowId });
  ui.groupFacts.set(rowId, facts);
  return facts;
}

async function refreshGroup(rowId) {
  const rows = await fetchGroups(null, rowId);
  const fresh = rows[0];
  if (!fresh || !ui.groups) return;
  const index = ui.groups.findIndex((g) => g.row_id === rowId);
  if (index >= 0) ui.groups[index] = fresh;
  else ui.groups.push(fresh);
}

function findGroup(rowId) {
  return (ui.groups || []).find((g) => g.row_id === rowId) || null;
}

function needsReady() {
  const needs = TAB_NEEDS[ui.tab] || [];
  return needs.every((need) => ({
    summary: ui.summary,
    facts: ui.facts,
    groups: ui.groups,
    assignments: ui.instructorAssignments
  })[need]);
}

/** The half-year view has one source of truth for facts on every tab. */
function semesterFacts() {
  return filterFeedbackFactsForHalf(ui.facts || [], ui.groups || [], ui.instructorAssignments || [], ui.feedbackHalf);
}

/** Facts of the selected course and selected scheduling half. */
function courseFacts() {
  const facts = semesterFacts();
  return ui.course ? facts.filter((f) => f.program_key === ui.course) : facts;
}

function courseScopedGroups() {
  const groups = ui.groups || [];
  // Unresolved groups have no course yet; they stay visible so they can be assigned.
  return ui.course ? groups.filter((g) => g.program_key === ui.course || isProgramUnresolved(g)) : groups;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/** Compact, user-controlled filters. Re-renders must never open filters just because a value was selected. */
function filterDisclosureHtml(scope, fieldsHtml, active = 0, label = 'סינון', detail = '') {
  const selected = active ? `<small>${esc(detail || `${active} פעילים`)}</small>` : '';
  return `<details class="ifb-filter-disclosure" data-ifb-filter-disclosure="${esc(scope)}"${ui.filterExpanded[scope] ? ' open' : ''}>
    <summary class="ifb-filter-toggle">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>
      <span>${esc(label)}</span>${selected}
    </summary>
    <div class="ifb-filter-panel">${fieldsHtml}</div>
  </details>`;
}

/** Every tab owns exactly one compact filter panel. The course selection is shared state. */
function courseFilterFieldHtml() {
  return `<label class="ifb-field ifb-field--course">
    <span>קורס</span>
    <select data-ifb-course>${optionList(ui.programs.map((p) => p.key), ui.course, 'כל הקורסים', programTitle)}</select>
  </label>`;
}

function courseOnlyFiltersHtml(scope) {
  return filterDisclosureHtml(scope,
    `<div class="ifb-filters ifb-filters--inline">${courseFilterFieldHtml()}</div>`,
    Number(Boolean(ui.course)), 'סינון', ui.course ? programTitle(ui.course) : '');
}

function shellHtml(inner) {
  const activeTab = TABS.find((t) => t.key === ui.tab) || TABS[0];
  return `
    <div class="ifb-admin__head">
      <h1 class="ifb-admin__title">משובים</h1>
      <button type="button" class="ifb-icon-btn ifb-icon-btn--lg" data-ifb-refresh title="טעינה מחדש של הנתונים" aria-label="טעינה מחדש של הנתונים">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"></path></svg>
      </button>
    </div>
    <nav class="ifb-tabs" role="tablist" aria-label="לשוניות מודול המשובים">
      ${TABS.map((t) => `<button type="button" role="tab" id="ifb-tab-${t.key}" class="ifb-tab${ui.tab === t.key ? ' is-active' : ''}" aria-selected="${ui.tab === t.key}" aria-controls="ifb-panel" tabindex="${ui.tab === t.key ? '0' : '-1'}" data-ifb-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </nav>
    ${ui.groupRowId || ui.tab === 'templates' ? '' : feedbackSemesterTabsHtml()}
    <div class="ifb-view" role="tabpanel" id="ifb-panel" aria-labelledby="ifb-tab-${activeTab.key}" tabindex="-1">${inner}</div>`;
}

function loadingHtml(text = 'טוען נתונים…') {
  return `<div class="ifb-empty" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>${esc(text)}</p></div>`;
}

function errorHtml(message) {
  return `<div class="ifb-empty ifb-empty--error" role="alert"><p>${esc(message)}</p><button type="button" class="ifb-btn" data-ifb-retry>נסו שוב</button></div>`;
}

function emptyHtml(text, sub = '') {
  return `<div class="ifb-empty"><p>${esc(text)}</p>${sub ? `<p class="ifb-muted">${esc(sub)}</p>` : ''}</div>`;
}

function sectionHtml(title, body, { actions = '', id = '', note = '' } = {}) {
  return `<section class="ifb-section"${id ? ` id="${esc(id)}"` : ''}>
    <div class="ifb-section__head"><h2>${esc(title)}</h2>${actions}</div>
    ${body}
  </section>`;
}

function selectCourseHint(what) {
  return emptyHtml(`בחרו קורס להצגת ${what}.`);
}

// ---------------------------------------------------------------------------
// Tab 1 — סקירה כללית
// ---------------------------------------------------------------------------

function overviewFiltersHtml() {
  const o = ui.overview;
  const active = Number(Boolean(ui.course)) + Number(Boolean(o.audience)) + Number(Boolean(o.phase));
  return filterDisclosureHtml('overview', `<div class="ifb-filters ifb-filters--inline" data-ifb-filters="overview">
    ${courseFilterFieldHtml()}
    <label class="ifb-field"><span>קהל יעד</span><select data-o="audience">${optionList(AUDIENCE_ORDER, o.audience, 'כל הקהלים', (a) => AUDIENCE_LABELS[a])}</select></label>
    <label class="ifb-field"><span>שלב המשוב</span><select data-o="phase">${optionList(['pre', 'end'], o.phase, 'פתיחה וסיום', (p) => PHASE_LABELS[p])}</select></label>
  </div>`, active);
}

function overviewFacts() {
  const o = ui.overview;
  return courseFacts().filter((f) => (!o.audience || f.audience === o.audience) && (!o.phase || stagePhase(f.audience, f.stage) === o.phase));
}

function kpiStripHtml(items) {
  return `<dl class="ifb-kpis ifb-kpis--${items.length}">${items.map(([label, value, hint]) => `
    <div class="ifb-kpi">
      <dt class="ifb-kpi__label">${esc(label)}</dt>
      <dd class="ifb-kpi__value">${esc(String(value))}</dd>
      ${hint ? `<dd class="ifb-kpi__hint">${esc(hint)}</dd>` : ''}
    </div>`).join('')}</dl>`;
}

function barListHtml(title, entries) {
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(0, ...entries.map(([, n]) => n));
  return `<section class="ifb-panel ifb-panel--tight">
    <h3>${esc(title)}</h3>
    ${total ? `<ul class="ifb-barlist">${entries.map(([label, n]) => `
      <li><span class="ifb-barlist__label">${esc(label)}</span>${barHtml(n, max, `${label}: ${n}`)}<span class="ifb-barlist__value"><strong>${n}</strong> <span class="ifb-muted">(${total ? Math.round((n / total) * 100) : 0}%)</span></span></li>`).join('')}</ul>`
      : '<p class="ifb-muted">טרם הוגשו שאלונים.</p>'}
  </section>`;
}

/** Student PRE→POST on identical questions, pooled over all of the course's answers. */
function studentChangeFor(programKey) {
  const facts = semesterFacts().filter((f) => f.program_key === programKey && f.audience === 'student');
  const result = comparePrePostByQuestion(factsFor(facts, 'student', 'pre'), factsFor(facts, 'student', 'post'));
  const rows = result.rows.filter((r) => r.comparable);
  if (!rows.length) return null;
  const ids = new Set(rows.map((r) => r.question_id));
  const pooled = (stage) => {
    const values = facts.filter((f) => f.stage === stage && ids.has(f.question_id) && f.question_type === 'rating_1_5' && f.value_number !== null).map((f) => Number(f.value_number));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const pre = pooled('pre');
  const post = pooled('post');
  if (pre === null || post === null) return null;
  return { pre: Math.round(pre * 10) / 10, post: Math.round(post * 10) / 10, delta: Math.round((post - pre) * 10) / 10, questions: rows.length };
}

function personalCell(stage) {
  if (!stage || !stage.invited) return '<span class="ifb-muted">—</span>';
  return `<span class="ifb-num">${stage.completed}/${stage.invited}</span>${stage.responseRate !== null ? ` <span class="ifb-muted">(${stage.responseRate}%)</span>` : ''}`;
}

function studentRateCell(collection) {
  const parts = ['pre', 'post'].map((s) => collection.byStage[s]).filter((s) => s && s.campaigns);
  if (!parts.length) return '<span class="ifb-muted">—</span>';
  return parts.map((s) => s.responseRate === null
    ? `<span class="ifb-muted" title="אין מספר משתתפים רשום בקבוצות – לא ניתן לחשב היענות">${esc(stageLabelFor('student', s.stage))}: אין נתון</span>`
    : `<span title="מחושב רק על ${esc(s.rateCoverage)} קבוצות שבהן רשום מספר משתתפים">${esc(stageLabelFor('student', s.stage))}: ${s.responseRate}%</span>`).join('<br>');
}

function coursesTableHtml() {
  const o = ui.overview;
  const programKeys = new Set([
    ...(ui.groups || []).filter((g) =>
      studentFeedbackPeriodForGroup(g) === ui.feedbackHalf && g.program_key
    ).map((g) => g.program_key),
    ...(ui.instructorAssignments || []).filter((r) =>
      studentFeedbackPeriodForGroup({ start_date: r.first_start_date }) === ui.feedbackHalf
    ).map((r) => r.program_key)
  ]);
  const programs = ui.programs.filter((p) => programKeys.has(p.key) && (!ui.course || p.key === ui.course));
  if (!programs.length) return emptyHtml('לא נמצאו קורסים.');
  const columns = [
    { audience: 'student', stage: 'pre', label: 'תלמידים – פתיחה' },
    { audience: 'student', stage: 'post', label: 'תלמידים – סיום' },
    { audience: 'instructor', stage: 'pre', label: 'מדריכים – פתיחה' },
    { audience: 'instructor', stage: 'final', label: 'מדריכים – סיום' },
    { audience: 'educational_staff', stage: 'final', label: 'צוות חינוכי' }
  ].filter((c) => (!o.audience || c.audience === o.audience)
    && (!o.phase || stagePhase(c.audience, c.stage) === o.phase));

  const rows = programs.map((program) => {
    const stages = columns.map((col) => courseCollection(ui.summary || [], program.key, col.audience).byStage[col.stage]);
    const launched = stages.reduce((n, stage) => n + (stage.campaigns || 0), 0);
    const submitted = stages.reduce((n, stage) => n + (stage.responses || 0), 0);
    const label = !launched ? 'טרם נפתח' : submitted ? 'התקבלו תשובות' : 'ממתין לתשובות';
    const statusClass = !launched ? 'is-idle' : submitted ? 'is-received' : 'is-waiting';
    return `<tr data-course-row="${esc(program.key)}">
      <th scope="row" data-label="קורס"><span class="ifb-course-name">${esc(programTitle(program.key))}</span></th>
      <td data-label="מצב" class="ifb-col-state"><span class="ifb-course-status ${statusClass}">${label}</span></td>
      ${columns.map((col, index) => `<td data-label="${esc(col.label)}" class="ifb-col-audience ifb-center"><span class="ifb-num" title="${stages[index].campaigns ? 'שאלונים שהתקבלו' : 'משוב טרם נפתח'}">${stages[index].campaigns ? stages[index].responses : '—'}</span></td>`).join('')}
      <td data-label="פעולות" class="ifb-col-actions"><button type="button" class="ifb-row-action" data-ifb-analyze="${esc(program.key)}" aria-label="ניתוח הקורס ${esc(programTitle(program.key))}" title="ניתוח הקורס"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V11M10 20V4M16 20v-8M22 20v-5"></path></svg></button></td>
    </tr>`;
  }).join('');

  return `<div class="ifb-table-wrap"><table class="ifb-table ifb-courses-table">
    <caption class="ifb-sr">מצב משובים לפי קורס</caption>
    <thead><tr><th scope="col">קורס</th><th scope="col" class="ifb-col-state">מצב</th>${columns.map((col) => `<th scope="col" class="ifb-col-audience ifb-center">${esc(col.label)}</th>`).join('')}<th scope="col">פעולות</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/**
 * Strengths, improvement areas and PRE→POST trends; each item keeps its course + population.
 * Strengths and gaps rank end-of-course evaluations only — opening answers are a baseline, not an evaluation.
 */
function insightsHtml(facts) {
  const endFacts = facts.filter((f) => stagePhase(f.audience, f.stage) === 'end');
  const units = uniqueSorted(endFacts.map((f) => `${f.program_key}|${f.audience}|${f.stage}`));
  const all = [];
  for (const unit of units) {
    const [programKey, audience, stage] = unit.split('|');
    const stats = questionStats(endFacts.filter((f) => f.program_key === programKey && f.audience === audience && f.stage === stage));
    for (const q of stats) all.push({ ...q, programKey, audience, stage });
  }
  const { strengths, gaps, flat } = strengthsAndGaps(all, { minN: MIN_N_RANKING, count: 4 });
  const trends = [];
  for (const programKey of uniqueSorted(facts.map((f) => f.program_key))) {
    const pf = facts.filter((f) => f.program_key === programKey);
    for (const [audience, pre, post] of [['student', 'pre', 'post'], ['instructor', 'pre', 'final']]) {
      const cmp = comparePrePostByQuestion(factsFor(pf, audience, pre), factsFor(pf, audience, post));
      for (const r of cmp.rows) {
        if (r.comparable && r.delta !== null && r.nPre >= MIN_N_RANKING && r.nPost >= MIN_N_RANKING) trends.push({ ...r, programKey, audience });
      }
    }
  }
  trends.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const item = (q) => `<li>
    <span class="ifb-insight__text">${esc(q.text)}</span>
    <span class="ifb-insight__meta">${esc(programTitle(q.programKey))} · ${esc(AUDIENCE_LABELS[q.audience])} · ${esc(stageLabelFor(q.audience, q.stage))}</span>
    <span class="ifb-insight__value"><strong>${fmtNum(q.avg)}</strong> <span class="ifb-muted">N=${q.valid}</span></span>
  </li>`;
  const list = (items, empty) => (items.length ? `<ul class="ifb-insights">${items.join('')}</ul>` : `<p class="ifb-muted">${esc(empty)}</p>`);
  const notEnough = flat
    ? 'הממוצעים בכל השאלות זהים – אין חוזקות או פערים בולטים.'
    : `אין עדיין שאלות סיום עם לפחות ${MIN_N_RANKING} תשובות תקפות.`;
  if (!all.some((q) => q.valid >= MIN_N_RANKING) && !trends.length) return '';
  return `<div class="ifb-grid-3">
    <section class="ifb-panel ifb-panel--tight"><h3>חוזקות</h3>${list(strengths.map(item), notEnough)}</section>
    <section class="ifb-panel ifb-panel--tight"><h3>תחומים הדורשים שיפור</h3>${list(gaps.map(item), notEnough)}</section>
    <section class="ifb-panel ifb-panel--tight"><h3>מגמות פתיחה → סיום</h3>${list(trends.slice(0, 4).map((t) => `<li>
      <span class="ifb-insight__text">${esc(t.text)}</span>
      <span class="ifb-insight__meta">${esc(programTitle(t.programKey))} · ${esc(AUDIENCE_LABELS[t.audience])} · שינוי בממוצע האוכלוסייה</span>
      <span class="ifb-insight__value"><span class="ifb-num">${fmtNum(t.preAvg)} → ${fmtNum(t.postAvg)}</span> <strong class="${deltaClass(t.delta)}">${fmtDelta(t.delta)}</strong></span>
    </li>`), `אין עדיין שאלות זהות עם לפחות ${MIN_N_RANKING} תשובות בפתיחה ובסיום.`)}</section>
  </div>`;
}

function overviewHtml() {
  const o = ui.overview;
  const totals = overviewTotals(ui.summary || [], { programKey: ui.course, audience: o.audience, phase: o.phase });
  const matchesScope = (campaign) =>
    (!o.audience || campaign.audience === o.audience) && (!o.phase || stagePhase(campaign.audience, campaign.stage) === o.phase);
  const groups = courseScopedGroups().filter((g) =>
    studentFeedbackPeriodForGroup(g) === ui.feedbackHalf &&
    g.program_key && groupHasFeedback(g) && g.campaigns.some(matchesScope));
  const withoutResponses = groups.filter((g) => g.campaigns.some((c) => matchesScope(c) && Number(c.responses || 0) === 0)).length;
  const kpis = [
    ['קורסים במעקב', new Set([
      ...(ui.groups || []).filter((g) => studentFeedbackPeriodForGroup(g) === ui.feedbackHalf && g.program_key).map((g) => g.program_key),
      ...(ui.instructorAssignments || []).filter((r) => studentFeedbackPeriodForGroup({ start_date: r.first_start_date }) === ui.feedbackHalf).map((r) => r.program_key)
    ]).size, ''],
    ['קבוצות עם שאלון', groups.length, ''],
    ['שאלונים שהוגשו', totals.responses, ''],
    ['קבוצות ללא תשובות', withoutResponses, 'לאחר פתיחת משוב']
  ];
  const audienceEntries = AUDIENCE_ORDER.filter((a) => (!o.audience || o.audience === a) && (totals.byAudience[a] || 0) > 0)
    .map((a) => [AUDIENCE_LABELS[a], totals.byAudience[a]]);
  const phaseEntries = ['pre', 'end'].filter((p) => (!o.phase || o.phase === p) && (totals.byPhase[p] || 0) > 0)
    .map((p) => [PHASE_LABELS[p], totals.byPhase[p]]);
  const insights = totals.responses ? insightsHtml(overviewFacts()) : '';
  return `
    ${overviewFiltersHtml()}
    ${kpiStripHtml(kpis)}
    ${sectionHtml('מעקב משובים לפי קורס', coursesTableHtml())}
    ${totals.responses && (audienceEntries.length > 1 || phaseEntries.length > 1) ? `<div class="ifb-grid-2">
      ${audienceEntries.length > 1 ? barListHtml('לפי קהל יעד', audienceEntries) : ''}
      ${phaseEntries.length > 1 ? barListHtml('לפי שלב המשוב', phaseEntries) : ''}
    </div>` : ''}
    ${insights ? sectionHtml('ממצאים מרכזיים', insights) : ''}`;
}

// ---------------------------------------------------------------------------
// Groups (distribution & tracking) — shared by the students and staff tabs
// ---------------------------------------------------------------------------

function groupFiltersHtml(groups, scope) {
  const f = ui.filters;
  const active = Object.values(f).filter(Boolean).length + Number(Boolean(ui.course));
  return `
    <details class="ifb-filter-disclosure"${ui.filterExpanded[scope] ? ' open' : ''} data-ifb-filter-disclosure="${scope}">
      <summary class="ifb-filter-toggle">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>
        <span>סינון קבוצות</span>
        ${active ? `<small>· ${active} פעילים</small>` : ''}
      </summary>
      <section class="ifb-filter-panel">
        <div class="ifb-filters ifb-filters--primary" data-ifb-filters="${scope}">
          ${courseFilterFieldHtml()}
          <label class="ifb-field ifb-field--search"><span>חיפוש</span><input type="search" data-f="search" value="${esc(f.search)}" placeholder="בית ספר, קורס, מדריך, מנהל פעילות…"></label>
          <label class="ifb-field"><span>רשות</span><select data-f="authority">${optionList(uniqueSorted(groups.map((g) => g.authority)), f.authority, 'כל הרשויות')}</select></label>
          <label class="ifb-field"><span>בית ספר</span><select data-f="school">${optionList(uniqueSorted(groups.map((g) => g.school)), f.school, 'כל בתי הספר')}</select></label>
          <label class="ifb-field"><span>מדריך</span><select data-f="instructor">${optionList(uniqueSorted(groups.map((g) => g.instructor_name)), f.instructor, 'כל המדריכים')}</select></label>
          <label class="ifb-field"><span>מנהל פעילות</span><select data-f="manager">${optionList(uniqueSorted(groups.map((g) => g.activity_manager)), f.manager, 'כל מנהלי הפעילות')}</select></label>
          <label class="ifb-field"><span>סטטוס</span><select data-f="status">
            ${[['', 'הכל'], ['unresolved', 'קורס לא זוהה'], ['has_feedback', 'יש משובים'], ['no_feedback', 'ללא משובים'], ['any_live', 'משוב פעיל'], ['pending_contact', 'ממתין לאיש קשר'], ['expired', 'פג תוקף'], ['completed_all', 'כל המשובים הושלמו'], ['excluded', 'הוסתרו (לא רלוונטי)']]
              .map(([v, l]) => `<option value="${v}"${v === f.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          </select></label>
          <button type="button" class="ifb-btn ifb-btn--ghost ifb-clear-btn" data-ifb-clear="groups">ניקוי</button>
        </div>
      </section>
    </details>`;
}


function feedbackSemesterTabsHtml() {
  const halves = [
    { key: 'first', label: "מחצית א׳" },
    { key: 'second', label: "מחצית ב׳" }
  ];
  // One control across the whole feedback module. Templates are intentionally
  // shared and therefore do not need an additional half-specific copy.
  return `<div class="ifb-student-semesters" role="group" aria-label="בחירת מחצית בממשק המשובים">
    ${halves.map(({ key, label }) => `<button type="button"
      class="ifb-student-semester${ui.feedbackHalf === key ? ' is-active' : ''}"
      data-ifb-group-half="${key}" aria-pressed="${ui.feedbackHalf === key}">${label}</button>`).join('')}
  </div>`;
}

function groupsTableHtml(slots, scope) {
  // The activities table is authoritative. Students need a course start date,
  // while school staff need an end date. Other audiences and stored replies are unchanged.
  const all = scope === 'students'
    ? courseScopedGroups().filter(hasCourseStartDate)
    : scope === 'staff'
      ? courseScopedGroups().filter(hasCourseEndDate)
      : courseScopedGroups();
  const inHalf = all.filter((g) => studentFeedbackPeriodForGroup(g) === ui.feedbackHalf);
  const matching = filterGroups(inHalf, ui.filters);
  const filtered = scope === 'students'
    ? sortStudentFeedbackGroups(matching)
    : scope === 'staff'
      ? sortEducationalStaffFeedbackGroups(matching)
      : matching.sort((a, b) =>
        Number(groupHasFeedback(b)) - Number(groupHasFeedback(a)) ||
        String(a.school).localeCompare(String(b.school), 'he'));
  // The course column is shown for all courses or when the source activity has no matching feedback template.
  const showCourse = !ui.course || filtered.some((g) => !g.program_key);
  const body = filtered.length ? `
    <div class="ifb-table-wrap">
      <table class="ifb-table ifb-groups-table ifb-groups-table--${scope}${showCourse ? ' ifb-groups-table--with-program' : ''}">
        <caption class="ifb-sr">קבוצות לימוד – הפצה ומעקב</caption>
        <colgroup>
          <col class="ifb-gw-school"><col class="ifb-gw-authority">
          ${showCourse ? '<col class="ifb-gw-course">' : ''}
          <col class="ifb-gw-person">
          ${scope === 'students'
            ? '<col class="ifb-gw-date ifb-gw-date--start"><col class="ifb-gw-stage"><col class="ifb-gw-date ifb-gw-date--end"><col class="ifb-gw-stage">'
            : '<col class="ifb-gw-date ifb-gw-date--end">' + slots.map(() => '<col class="ifb-gw-stage">').join('')}
          <col class="ifb-gw-actions">
        </colgroup>
        <thead><tr>
          <th scope="col">בית ספר</th>
          <th scope="col">רשות</th>
          ${showCourse ? '<th scope="col">קורס</th>' : ''}
          <th scope="col">${scope === 'staff' ? 'איש קשר' : 'מדריך'}</th>
          ${scope === 'students' ? '<th scope="col" class="ifb-center ifb-col-date">תחילת קורס</th>' : ''}
          ${scope === 'students' ? `<th scope="col" class="ifb-center ifb-col-stage">${esc(slots.find((slot) => slot.stage === 'pre')?.label || 'תלמידים – פתיחה')}</th>` : ''}
          <th scope="col" class="ifb-center ifb-col-date">${scope === 'students' ? 'סיום קורס' : 'סיום הקבוצה'}</th>
          ${scope === 'students'
            ? `<th scope="col" class="ifb-center ifb-col-stage">${esc(slots.find((slot) => slot.stage === 'post')?.label || 'תלמידים – סיום')}</th>`
            : slots.map((slot) => `<th scope="col" class="ifb-col-stage ifb-col-staff">${esc(slot.label)}</th>`).join('')}
          <th scope="col"><span class="ifb-sr">פעולות</span></th>
        </tr></thead>
        <tbody>${filtered.map((g) => `
          <tr data-row="${esc(g.row_id)}">
            <th scope="row" data-label="בית ספר"><span class="ifb-school-name">${esc(g.school || '—')}</span>${g.grade || g.class_group ? `<span class="ifb-muted ifb-cell-sub">${esc([g.grade, g.class_group].filter(Boolean).join(' · '))}</span>` : ''}</th>
            <td data-label="רשות">${esc(g.authority || '—')}</td>
            ${showCourse ? `<td data-label="קורס">${g.program_key
              ? esc(programTitle(g.program_key))
              : g.feedback_excluded ? statusText('לא רלוונטי למשובים', 'muted') : `<span title="נדרש טיפול בהתאמת תבנית המשוב לקורס. השיוך מנוהל במערכת ולא במסך זה.">${statusText('ממתין להתאמת משוב', 'warning')}</span>`}</td>` : ''}
            <td data-label="${scope === 'staff' ? 'איש קשר' : 'מדריך'}">${scope === 'staff' ? (g.contact_name ? esc(g.contact_name) : '<span class="ifb-muted" title="טרם הוגדר שם של איש קשר">לא הוגדר</span>') : esc(g.instructor_name || 'לא שובץ')}</td>
            ${scope === 'students' ? `<td data-label="תחילת קורס" class="ifb-center ifb-nowrap ifb-col-date">${fmtDate(g.start_date)}</td>` : ''}
            ${scope === 'students' ? (() => {
              const slot = slots.find((s) => s.stage === 'pre');
              return `<td class="ifb-center ifb-col-stage" data-label="${esc(slot?.label || 'תלמידים – פתיחה')}">${g.program_key && slot ? tableStatusHtml(slotCampaign(g, slot)) : '<span class="ifb-muted">—</span>'}</td>`;
            })() : ''}
            <td data-label="${scope === 'students' ? 'סיום קורס' : 'סיום הקבוצה'}" class="ifb-center ifb-nowrap ifb-col-date">${fmtDate(g.end_date)}</td>
            ${scope === 'students' ? (() => {
              const slot = slots.find((s) => s.stage === 'post');
              return `<td class="ifb-center ifb-col-stage" data-label="${esc(slot?.label || 'תלמידים – סיום')}">${g.program_key && slot ? tableStatusHtml(slotCampaign(g, slot)) : '<span class="ifb-muted">—</span>'}</td>`;
            })() : slots.map((slot) =>
              `<td class="ifb-col-stage ifb-col-staff" data-label="${esc(slot.label)}">${g.program_key ? tableStatusHtml(slotCampaign(g, slot)) : '<span class="ifb-muted">—</span>'}</td>`).join('')}
            <td data-label="פעולות" class="ifb-col-actions"><button type="button" class="ifb-row-action" data-ifb-open-group="${esc(g.row_id)}" aria-label="ניהול משובי הקבוצה ${esc(g.school || '')}" title="ניהול משובי הקבוצה"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path></svg></button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : emptyHtml('לא נמצאו קבוצות התואמות לסינון.', scope === 'students' ? 'בלשונית תלמידים מוצגות רק קבוצות שנקבע להן תאריך התחלה בכל הפעילויות.' : 'בלשונית צוות חינוכי מוצגות רק קבוצות שנקבע להן תאריך סיום בכל הפעילויות.');
  return `${groupFiltersHtml(inHalf, scope)}${body}`;
}

// ---------------------------------------------------------------------------
// Per-question results (students / instructors / staff / analysis)
// ---------------------------------------------------------------------------

function optionBarsHtml(q) {
  const total = Object.values(q.optionCounts).reduce((a, b) => a + b, 0);
  const respondents = q.n || 0;
  if (!total) return '<span class="ifb-muted">—</span>';
  const labels = Object.fromEntries((q.options || []).map((o) => [o.value, o.label]));
  const entries = Object.entries(q.optionCounts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, n]) => n));
  return `<ul class="ifb-barlist ifb-barlist--compact">${entries.map(([value, n]) => `
    <li><span class="ifb-barlist__label">${esc(labels[value] || metricLabel(value))}</span>${barHtml(n, max)}<span class="ifb-barlist__value"><strong>${n}</strong>${q.question_type === 'multi_select' && respondents ? ` <span class="ifb-muted">/${respondents}</span>` : ''}</span></li>`).join('')}</ul>`;
}

function questionResultCell(q) {
  if (q.question_type === 'rating_1_5') return distributionHtml(q.dist);
  if (q.question_type === 'yes_no') {
    const total = q.yes + q.no;
    return total ? `<span class="ifb-num">כן ${q.yes} · לא ${q.no}</span> <span class="ifb-muted">(${Math.round((q.yes / total) * 100)}% כן)</span>` : '<span class="ifb-muted">—</span>';
  }
  if (q.question_type === 'single_select' || q.question_type === 'multi_select') return optionBarsHtml(q);
  return q.texts ? `<span class="ifb-muted">${q.texts} תשובות פתוחות</span>` : '<span class="ifb-muted">—</span>';
}

/** One table per population: every question with valid N, mean and distribution. */
function questionTableHtml(facts, { caption = '' } = {}) {
  const stats = questionStats(facts);
  if (!stats.length) return emptyHtml('טרם התקבלו תשובות.');
  return `<div class="ifb-table-wrap"><table class="ifb-table ifb-q-table">
    ${caption ? `<caption class="ifb-sr">${esc(caption)}</caption>` : ''}
    <thead><tr><th scope="col">שאלה</th><th scope="col" class="ifb-center">N תקפות</th><th scope="col" class="ifb-center">ממוצע</th><th scope="col">התפלגות</th></tr></thead>
    <tbody>${stats.map((q) => `
      <tr>
        <th scope="row" data-label="שאלה"><span class="ifb-q-text">${esc(q.text)}</span><span class="ifb-cell-sub ifb-muted">${esc(q.section === 'course' ? 'ייחודית לקורס' : 'ליבה')} · ${esc(metricLabel(q.metric_key))}${q.wordingChanged ? ' · הניסוח השתנה בין גרסאות' : ''}</span></th>
        <td data-label="N תקפות" class="ifb-center"><span class="ifb-num">${q.question_type === 'rating_1_5' ? q.valid : q.n}</span>${q.na ? `<span class="ifb-cell-sub ifb-muted">${q.na} „לא רלוונטי”</span>` : ''}</td>
        <td data-label="ממוצע" class="ifb-center"><strong class="ifb-num">${q.question_type === 'rating_1_5' ? fmtNum(q.avg) : '—'}</strong></td>
        <td data-label="התפלגות">${questionResultCell(q)}</td>
      </tr>`).join('')}</tbody>
  </table></div>`;
}

function prePostQuestionTableHtml(preFacts, postFacts, { audience }) {
  const cmp = comparePrePostByQuestion(preFacts, postFacts);
  const preLabel = stageLabelFor(audience, 'pre');
  const postLabel = 'סיום';
  if (!cmp.nPre && !cmp.nPost) return emptyHtml('טרם התקבלו שאלונים.');
  if (!cmp.rows.length) {
    return `${emptyHtml(audience === 'instructor'
      ? 'שאלוני הפתיחה והסיום של המדריכים אינם כוללים שאלות זהות, ולכן לא מוצגת השוואת פתיחה–סיום.'
      : !cmp.nPre || !cmp.nPost ? 'יש נתונים לשלב אחד בלבד – ההשוואה תוצג לאחר שיתקבלו שאלונים בשני השלבים.' : 'אין שאלות זהות בשני השלבים.')}`;
  }
  return `<div class="ifb-table-wrap"><table class="ifb-table ifb-prepost-table">
    <caption class="ifb-sr">השוואת פתיחה–סיום לפי שאלה</caption>
    <thead><tr><th scope="col">שאלה</th><th scope="col" class="ifb-center">${esc(preLabel)}</th><th scope="col" class="ifb-center">${esc(postLabel)}</th><th scope="col" class="ifb-center">שינוי</th></tr></thead>
    <tbody>${cmp.rows.map((r) => `<tr>
      <th scope="row" data-label="שאלה"><span class="ifb-q-text">${esc(r.text)}</span><span class="ifb-cell-sub ifb-muted">${esc(metricLabel(r.metric_key))}</span></th>
      <td data-label="${esc(preLabel)}" class="ifb-center"><span class="ifb-num">${fmtNum(r.preAvg)}</span> <span class="ifb-muted">N=${r.nPre}</span></td>
      <td data-label="${esc(postLabel)}" class="ifb-center"><span class="ifb-num">${fmtNum(r.postAvg)}</span> <span class="ifb-muted">N=${r.nPost}</span></td>
      <td data-label="שינוי" class="ifb-center">${r.comparable ? `<strong class="${deltaClass(r.delta)}">${fmtDelta(r.delta)}</strong>` : '<span class="ifb-muted" title="הניסוח השתנה בין השלבים">לא בר השוואה</span>'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function openAnswersListHtml(items, { showContext = true } = {}) {
  if (!items.length) return '<p class="ifb-muted">אין תשובות פתוחות.</p>';
  return `<ul class="ifb-answers">${items.map((a) => `
    <li class="ifb-answer">
      <p class="ifb-answer__text">${esc(a.text)}</p>
      <p class="ifb-answer__meta">
        <span class="ifb-answer__audience">${esc(AUDIENCE_LABELS[a.audience] || '')} · ${esc(stageLabelFor(a.audience, a.stage))}</span>
        <span>${esc(a.question_text)}</span>
        ${showContext ? `<span>${esc(programTitle(a.program_key))}${a.school_name ? ` · ${esc(a.school_name)}` : ''}${a.grade ? ` · ${esc(a.grade)}` : ''}</span>` : ''}
        ${a.respondent_name ? `<span>${esc(a.respondent_name)}</span>` : ''}
        <span>${fmtDate(a.submitted_at)}</span>
      </p>
    </li>`).join('')}</ul>`;
}

function openAnswersDisclosure(facts, title = 'תשובות פתוחות') {
  const items = openAnswers(facts);
  return `<details class="ifb-disclosure"${items.length && items.length <= 6 ? ' open' : ''}>
    <summary>${esc(title)} <span class="ifb-muted">(${items.length})</span></summary>
    ${openAnswersListHtml(items, { showContext: !ui.course })}
  </details>`;
}

function exportButtonHtml(scope, label = 'הפקת דוח (Excel)') {
  return `<button type="button" class="ifb-btn" data-ifb-export="xlsx" data-scope="${esc(scope)}">
    <svg viewBox="0 0 24 24" aria-hidden="true" class="ifb-btn__icon"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"></path></svg>${esc(label)}</button>`;
}

function collectionLineHtml(audience) {
  if (!ui.course) return '';
  const c = courseCollection(ui.summary || [], ui.course, audience);
  const parts = (AUDIENCE_STAGES[audience] || []).map((stage) => {
    const s = c.byStage[stage];
    if (audience === 'student') return `${stageLabelFor(audience, stage)}: ${s.responses} שאלונים${s.responseRate !== null ? ` · היענות ${s.responseRate}% (${s.rateCoverage} קבוצות עם מספר משתתפים)` : ''}`;
    return `${stageLabelFor(audience, stage)}: ${s.completed} מתוך ${s.invited}${s.responseRate !== null ? ` (${s.responseRate}%)` : ''}`;
  });
  if (c.uniqueRespondents !== null) parts.push(`משיבים ייחודיים: ${c.uniqueRespondents}`);
  return `<p class="ifb-inline-stats">${parts.map((p) => `<span>${esc(p)}</span>`).join('<span aria-hidden="true">·</span>')}</p>`;
}

// ---------------------------------------------------------------------------
// Tab 2 — תלמידים
// ---------------------------------------------------------------------------

const STUDENT_SLOTS = GROUP_SLOTS.filter((s) => s.audience === 'student');
const STAFF_SLOTS = GROUP_SLOTS.filter((s) => s.audience === 'educational_staff');

function studentsHtml() {
  const facts = courseFacts().filter((f) => f.audience === 'student');
  const results = ui.course
    ? `${collectionLineHtml('student')}
       <h3 class="ifb-subhead">השוואת פתיחה–סיום</h3>
       ${prePostQuestionTableHtml(factsFor(facts, 'student', 'pre'), factsFor(facts, 'student', 'post'), { audience: 'student' })}
       <h3 class="ifb-subhead">תוצאות שאלון הסיום</h3>
       ${questionTableHtml(factsFor(facts, 'student', 'post'), { caption: 'תלמידים – סיום' })}
       <details class="ifb-disclosure"><summary>תוצאות שאלון הפתיחה</summary>${questionTableHtml(factsFor(facts, 'student', 'pre'), { caption: 'תלמידים – פתיחה' })}</details>
       ${openAnswersDisclosure(facts)}`
    : selectCourseHint('תוצאות לכל שאלה');
  return `
    ${sectionHtml('הפצה ומעקב לפי קבוצה', groupsTableHtml(STUDENT_SLOTS, 'students'))}
    ${sectionHtml('תוצאות', results, { actions: ui.course ? exportButtonHtml('audience:student') : '' })}`;
}

// ---------------------------------------------------------------------------
// Tab 3 — מדריכים (one feedback per instructor + course + academic year, PRE and FINAL)
// ---------------------------------------------------------------------------

function instructorCampaignFor(row, stage) {
  return stage === 'pre' ? row.pre_campaign : row.final_campaign;
}

function instructorAssignmentKey(row, stage = '') {
  return [row.instructor_emp_id, row.program_key, row.academic_year, stage].filter(Boolean).join('|');
}

function instructorCampaignActionsHtml(row, stage) {
  const campaign = instructorCampaignFor(row, stage);
  const key = instructorAssignmentKey(row, stage);
  const stageName = stage === 'pre' ? 'פתיחה' : 'סיום';
  if (!campaign) {
    if (!ui.instructorOpenForms.has(key)) {
      return `<div class="ifb-instructor-stage ifb-instructor-stage--compact">
        <button type="button" class="ifb-icon-action" data-ifb-instructor-open="${esc(key)}" title="פתיחת משוב ${stageName}" aria-label="פתיחת משוב">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
        </button>
      </div>`;
    }
    return `
      <form class="ifb-instructor-open-form" data-ifb-instructor-open-form
        data-emp="${esc(row.instructor_emp_id)}" data-program="${esc(row.program_key)}" data-year="${esc(row.academic_year)}"
        data-stage="${stage}" data-key="${esc(key)}">
        <label class="ifb-field"><span>פתיחה</span><input type="date" name="opens" value="${isoDay(Date.now())}" required></label>
        <label class="ifb-field"><span>תוקף עד</span><input type="date" name="expires" value="${isoDay(Date.now() + (14 * DAY_MS))}" min="${isoDay(Date.now() + DAY_MS)}"></label>
        <div class="ifb-slot__actions">
          <button type="submit" class="ifb-btn ifb-btn--primary ifb-btn--sm">יצירת קישור</button>
          <button type="button" class="ifb-btn ifb-btn--ghost ifb-btn--sm" data-ifb-instructor-cancel="${esc(key)}">ביטול</button>
        </div>
      </form>`;
  }

  const status = campaignUiStatus(campaign);
  if (status.key === 'completed') {
    return `<div class="ifb-instructor-stage"><span class="ifb-muted ifb-instructor-stage__note" aria-label="משוב הושלם ונעול">נעול</span></div>`;
  }
  const links = personalShareLinks(campaign, { programTitle: programTitle(row.program_key), schoolName: '' });
  const live = status.key === 'active' || status.key === 'collecting' || status.key === 'scheduled';
  return `<div class="ifb-instructor-stage">
    <div class="ifb-text-actions ifb-icon-actions" role="group" aria-label="פעולות לשיתוף וניהול משוב ${esc(stageName)}">
      <a class="ifb-text-action ifb-text-action--whatsapp${live ? '' : ' is-disabled'}" href="${esc(links.whatsapp)}" target="_blank" rel="noopener" data-ifb-share="whatsapp" data-campaign="${esc(campaign.id)}" title="שיתוף ב־WhatsApp" aria-label="שיתוף ב־WhatsApp"${live ? '' : ' aria-disabled="true"'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 19.8 5 16.4a8 8 0 1 1 3 2.6Z"></path><path d="M9 9c.8 2.4 2.5 4 5 5"></path></svg></a>
      <a class="ifb-text-action${live && links.hasEmail ? '' : ' is-disabled'}" href="${esc(links.email)}" data-ifb-share="email" data-campaign="${esc(campaign.id)}" title="שליחה במייל" aria-label="שליחה במייל"${live && links.hasEmail ? '' : ' aria-disabled="true"'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg></a>
      <button type="button" class="ifb-text-action" data-ifb-copy="${esc(campaign.id)}" aria-label="העתקת קישור" title="העתקת קישור"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"></rect><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
      ${campaign.status === 'active'
        ? `<button type="button" class="ifb-text-action ifb-text-action--danger" data-ifb-close="${esc(campaign.id)}" aria-label="סגירת משוב" title="סגירת משוב"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18"></path></svg></button>`
        : `<button type="button" class="ifb-text-action" data-ifb-reopen="${esc(campaign.id)}" aria-label="פתיחת משוב מחדש" title="פתיחת משוב מחדש"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2-5.3M4 4v5h5"></path></svg></button>`}
    </div>
  </div>`;
}

function instructorFilterMatches(row, statusFilter) {
  if (!statusFilter) return true;
  const [stage, wanted] = statusFilter.split(':');
  const campaign = instructorCampaignFor(row, stage);
  const status = campaignUiStatus(campaign).key;
  if (wanted === 'not_opened') return !campaign;
  if (wanted === 'pending') return ['active', 'collecting', 'scheduled'].includes(status);
  if (wanted === 'completed') return status === 'completed';
  if (wanted === 'expired') return status === 'expired';
  return true;
}

/** Status is read independently for each questionnaire stage, never aggregated. */
function instructorStageStatusHtml(row, stage) {
  return tableStatusHtml(instructorCampaignFor(row, stage));
}

function instructorAssignmentsHtml() {
  const all = (ui.instructorAssignments || []).filter((row) =>
    studentFeedbackPeriodForGroup({ start_date: row.first_start_date }) === ui.feedbackHalf &&
    (!ui.course || row.program_key === ui.course));
  const filters = ui.instructorFilters;
  const instructors = [...new Map(
    all.filter((row) => row.instructor_emp_id).map((row) => [String(row.instructor_emp_id), row.instructor_name || row.instructor_emp_id])
  ).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'he'));
  const managers = uniqueSorted(all.flatMap((row) => Array.isArray(row.activity_managers) ? row.activity_managers : []));
  const rows = all.filter((row) => {
    if (filters.instructor && String(row.instructor_emp_id) !== filters.instructor) return false;
    if (filters.manager && !(Array.isArray(row.activity_managers) && row.activity_managers.includes(filters.manager))) return false;
    return instructorFilterMatches(row, filters.status);
  }).sort((a, b) => String(a.first_start_date).localeCompare(String(b.first_start_date))
    || String(a.instructor_name || '').localeCompare(String(b.instructor_name || ''), 'he')
    || String(a.program_key || '').localeCompare(String(b.program_key || '')));
  const preCompleted = all.filter((row) => row.pre_campaign?.recipient?.status === 'completed').length;
  const finalCompleted = all.filter((row) => row.final_campaign?.recipient?.status === 'completed').length;
  const activeFilters = Object.values(filters).filter(Boolean).length + Number(Boolean(ui.course));
  return `
    <p class="ifb-inline-stats" aria-label="סיכום משובי מדריכים">
      <span><strong>${all.length}</strong> שיבוצי מדריך–קורס</span><span aria-hidden="true">·</span>
      <span><strong>${preCompleted}</strong> פתיחה הושלמו</span><span aria-hidden="true">·</span>
      <span><strong>${finalCompleted}</strong> סיום הושלמו</span>
    </p>
    <details class="ifb-filter-disclosure"${ui.filterExpanded.instructors ? ' open' : ''} data-ifb-filter-disclosure="instructors">
      <summary class="ifb-filter-toggle">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>
        <span>סינון</span>${activeFilters ? `<small>· ${activeFilters} פעילים</small>` : ''}
      </summary>
      <section class="ifb-filter-panel">
        <div class="ifb-filters ifb-filters--instructors">
          ${courseFilterFieldHtml()}
          <label class="ifb-field"><span>מדריך</span><select data-i="instructor">
            <option value="">כל המדריכים</option>
            ${instructors.map(([id, name]) => `<option value="${esc(id)}"${id === filters.instructor ? ' selected' : ''}>${esc(name)}</option>`).join('')}
          </select></label>
          <label class="ifb-field"><span>מנהל פעילות</span><select data-i="manager">${optionList(managers, filters.manager, 'כל מנהלי הפעילות')}</select></label>
          <label class="ifb-field"><span>סטטוס</span><select data-i="status">
            ${[['', 'הכל'], ['pre:not_opened', 'פתיחה – טרם נפתח'], ['pre:pending', 'פתיחה – ממתין למילוי'], ['pre:completed', 'פתיחה – הושלם'],
              ['final:not_opened', 'סיום – טרם נפתח'], ['final:pending', 'סיום – ממתין למילוי'], ['final:completed', 'סיום – הושלם']]
              .map(([v, l]) => `<option value="${v}"${v === filters.status ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-clear="instructors">ניקוי</button>
        </div>
      </section>
    </details>
    ${rows.length ? `<div class="ifb-table-wrap">
      <table class="ifb-table ifb-instructor-table">
        <caption class="ifb-sr">משובי מדריכים לפי מדריך וקורס</caption>
        <colgroup>
          <col class="ifb-iw-instructor"><col class="ifb-iw-program"><col class="ifb-iw-groups">
          <col class="ifb-iw-date"><col class="ifb-iw-action"><col class="ifb-iw-status">
          <col class="ifb-iw-date"><col class="ifb-iw-action"><col class="ifb-iw-status">
        </colgroup>
        <thead><tr>
          <th scope="col">מדריך</th>
          <th scope="col">קורס</th>
          <th scope="col" class="ifb-center">קבוצות</th>
          <th scope="col" class="ifb-center ifb-col-date" title="תאריך ההתחלה המוקדם ביותר מכל קבוצות המדריך בקורס">תחילת קורס ראשון</th>
          <th scope="col" class="ifb-center" title="משוב פתיחה – אחרי הכשרה">פתיחה</th>
          <th scope="col" class="ifb-col-status">סטטוס</th>
          <th scope="col" class="ifb-center ifb-col-date" title="תאריך הסיום המאוחר ביותר של קבוצות המדריך בקורס שהתחילו במחצית הרלוונטית">סיום קורס אחרון</th>
          <th scope="col" class="ifb-center" title="משוב סיום הקורס">סיום</th>
          <th scope="col" class="ifb-col-status">סטטוס</th>
        </tr></thead>
        <tbody>${rows.map((row) => `
          <tr data-instructor-feedback="${esc(instructorAssignmentKey(row))}">
            <th scope="row" data-label="מדריך"><span>${esc(row.instructor_name || row.instructor_emp_id)}</span><span class="ifb-muted ifb-instructor-id">#${esc(row.instructor_emp_id)}</span></th>
            <td data-label="קורס">${esc(programTitle(row.program_key))}</td>
            <td data-label="קבוצות" class="ifb-center"><span class="ifb-num">${Number(row.assignment_count) || 0}</span></td>
            <td data-label="תחילת קורס ראשון" class="ifb-center ifb-nowrap ifb-col-date">${fmtDate(row.first_start_date)}</td>
            <td data-label="פתיחה" class="ifb-instructor-stage-cell">${instructorCampaignActionsHtml(row, 'pre')}</td>
            <td data-label="סטטוס פתיחה" class="ifb-col-status">${instructorStageStatusHtml(row, 'pre')}</td>
            <td data-label="סיום קורס אחרון" class="ifb-center ifb-nowrap ifb-col-date">${fmtDate(row.last_end_date)}</td>
            <td data-label="סיום" class="ifb-instructor-stage-cell">${instructorCampaignActionsHtml(row, 'final')}</td>
            <td data-label="סטטוס סיום" class="ifb-col-status">${instructorStageStatusHtml(row, 'final')}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : emptyHtml('לא נמצאו שיבוצי מדריכים התואמים לסינון.', 'מוצגים רק שיבוצי מדריך–קורס עם תאריך התחלה. המשוב נפתח פעם אחת לכל מדריך וקורס בשנת הלימודים.')}`;
}

function instructorsHtml() {
  const facts = courseFacts().filter((f) => f.audience === 'instructor');
  const results = ui.course
    ? `${collectionLineHtml('instructor')}
       <h3 class="ifb-subhead">שאלון מוכנות – פתיחה (אחרי הכשרה)</h3>
       ${questionTableHtml(factsFor(facts, 'instructor', 'pre'), { caption: 'מדריכים – פתיחה' })}
       <h3 class="ifb-subhead">שאלון סיום – תוכן, הדרכה, חומרים, ציוד ותפעול</h3>
       ${questionTableHtml(factsFor(facts, 'instructor', 'final'), { caption: 'מדריכים – סיום' })}
       <h3 class="ifb-subhead">פתיחה–סיום</h3>
       ${prePostQuestionTableHtml(factsFor(facts, 'instructor', 'pre'), factsFor(facts, 'instructor', 'final'), { audience: 'instructor' })}
       ${openAnswersDisclosure(facts)}`
    : selectCourseHint('תוצאות לכל שאלה');
  return `
    ${sectionHtml('הפצה ומעקב', instructorAssignmentsHtml(), { note: 'משוב מדריך הוא אחד לכל מדריך וקורס בשנה, ומשויך למחצית של תאריך ההתחלה הראשון.' })}
    ${sectionHtml('תוצאות', results, { actions: ui.course ? exportButtonHtml('audience:instructor') : '' })}`;
}

// ---------------------------------------------------------------------------
// Tab 4 — צוות חינוכי
// ---------------------------------------------------------------------------

function staffHtml() {
  const facts = courseFacts().filter((f) => f.audience === 'educational_staff');
  const results = ui.course
    ? `${collectionLineHtml('educational_staff')}
       ${questionTableHtml(facts, { caption: 'צוות חינוכי – הערכת תוכנית' })}
       ${openAnswersDisclosure(facts, 'הערות פתוחות')}`
    : selectCourseHint('תוצאות לכל שאלה');
  return `
    ${sectionHtml('הפצה ומעקב לפי קבוצה', groupsTableHtml(STAFF_SLOTS, 'staff'))}
    ${sectionHtml('תוצאות', results, { actions: ui.course ? exportButtonHtml('audience:educational_staff') : '' })}`;
}

// ---------------------------------------------------------------------------
// Tab 5 — ניתוח והשוואה
// ---------------------------------------------------------------------------

function cumulativeSummaryHtml() {
  const rows = AUDIENCE_ORDER.map((audience) => {
    const c = courseCollection(ui.summary || [], ui.course, audience);
    const stages = (AUDIENCE_STAGES[audience] || []).map((stage) => {
      const s = c.byStage[stage];
      return `${stageLabelFor(audience, stage)}: ${s.responses}`;
    }).join(' · ');
    let rate = '—';
    if (audience === 'student') {
      const rates = ['pre', 'post'].map((s) => c.byStage[s]).filter((s) => s.responseRate !== null);
      rate = rates.length ? rates.map((s) => `${stageLabelFor(audience, s.stage)} ${s.responseRate}% (${s.rateCoverage} קבוצות)`).join(' · ') : 'אין מספר משתתפים רשום';
    } else {
      const invited = (AUDIENCE_STAGES[audience] || []).reduce((sum, st) => sum + (c.byStage[st].invited || 0), 0);
      const completed = (AUDIENCE_STAGES[audience] || []).reduce((sum, st) => sum + (c.byStage[st].completed || 0), 0);
      rate = invited ? `${completed}/${invited} (${Math.round((completed / invited) * 100)}%)` : '—';
    }
    return `<tr>
      <th scope="row" data-label="קהל">${esc(AUDIENCE_LABELS[audience])}</th>
      <td data-label="שאלונים שהוגשו" class="ifb-center"><strong class="ifb-num">${c.responses}</strong><span class="ifb-cell-sub ifb-muted">${esc(stages)}</span></td>
      <td data-label="משיבים ייחודיים" class="ifb-center">${c.anonymous ? '<span class="ifb-muted" title="המשוב אנונימי ואין דרך אמינה לזהות משיב בין פתיחה לסיום">לא ניתן לזיהוי (אנונימי)</span>' : `<span class="ifb-num">${c.uniqueRespondents ?? '—'}</span>${c.unidentified ? `<span class="ifb-cell-sub ifb-muted">${c.unidentified} ללא מזהה</span>` : ''}`}</td>
      <td data-label="היענות" class="ifb-center">${esc(rate)}</td>
    </tr>`;
  }).join('');
  return `<div class="ifb-table-wrap"><table class="ifb-table">
    <caption class="ifb-sr">סיכום מצטבר לפי קהל</caption>
    <thead><tr><th scope="col">קהל</th><th scope="col" class="ifb-center">שאלונים שהוגשו</th><th scope="col" class="ifb-center">משיבים ייחודיים</th><th scope="col" class="ifb-center">היענות</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function audienceComparisonHtml(facts) {
  const rows = audienceMetricScores(facts, ui.metrics, { minN: MIN_N_GAP });
  if (!rows.length) return emptyHtml('טרם התקבלו תשובות דירוג.');
  const cell = (c) => (c ? `<span class="ifb-num">${fmtNum(c.avg)}</span> <span class="ifb-muted">N=${c.n}</span>` : '<span class="ifb-muted">לא נמדד</span>');
  return `<div class="ifb-table-wrap"><table class="ifb-table">
    <caption class="ifb-sr">השוואה בין אוכלוסיות לפי מדד</caption>
    <thead><tr><th scope="col">מדד</th><th scope="col" class="ifb-center">תלמידים (סיום)</th><th scope="col" class="ifb-center">מדריכים (סיום)</th><th scope="col" class="ifb-center">צוות חינוכי</th><th scope="col" class="ifb-center">הבדל בין נקודות המבט</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <th scope="row" data-label="מדד">${esc(r.label)}${r.kind === 'program' ? '<span class="ifb-cell-sub ifb-muted">איכות התוכנית</span>' : ''}</th>
      <td data-label="תלמידים (סיום)" class="ifb-center">${cell(r.cells.student)}</td>
      <td data-label="מדריכים (סיום)" class="ifb-center">${cell(r.cells.instructor)}</td>
      <td data-label="צוות חינוכי" class="ifb-center">${cell(r.cells.educational_staff)}</td>
      <td data-label="הבדל בין נקודות המבט" class="ifb-center">${r.gap ? statusText(`${r.gap.label} (${r.gap.gap} נק׳)`, r.gap.key === 'aligned' ? 'success' : r.gap.key === 'partial' ? 'muted' : 'warning') : '<span class="ifb-muted">—</span>'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/** Core wording embeds each course's topic ({topic}); show the shared concept once, topic-neutral. */
function neutralCoreText(text) {
  let out = String(text || '');
  for (const p of ui.programs) if (p.topic) out = out.split(p.topic).join('[נושא הקורס]');
  return out;
}

function analysisFiltersHtml() {
  const a = ui.analysis;
  const stageOptions = AUDIENCE_STAGES[a.audience] || ['post'];
  const stage = stageOptions.includes(a.stage) ? a.stage : stageOptions[stageOptions.length - 1];
  const active = Number(Boolean(ui.course)) + Number(a.audience !== 'student') + Number(Boolean(a.stage && a.stage !== 'post'));
  return filterDisclosureHtml('analysis', `<div class="ifb-filters ifb-filters--inline">
    ${courseFilterFieldHtml()}
    <label class="ifb-field"><span>קהל</span><select data-a="audience">${AUDIENCE_ORDER.map((x) => `<option value="${x}"${x === a.audience ? ' selected' : ''}>${esc(AUDIENCE_LABELS[x])}</option>`).join('')}</select></label>
    <label class="ifb-field"><span>שלב</span><select data-a="stage">${stageOptions.map((s) => `<option value="${s}"${s === stage ? ' selected' : ''}>${esc(stageLabelFor(a.audience, s))}</option>`).join('')}</select></label>
  </div>`, active);
}

function crossCourseHtml() {
  const a = ui.analysis;
  const stageOptions = AUDIENCE_STAGES[a.audience] || ['post'];
  const stage = stageOptions.includes(a.stage) ? a.stage : stageOptions[stageOptions.length - 1];
  const { programKeys, rows } = crossCourseCore(semesterFacts(), { audience: a.audience, stage });
  if (!rows.length) return emptyHtml('אין עדיין תשובות לשאלות הליבה המשותפות בקהל ובשלב שנבחרו.');
  return `<div class="ifb-table-wrap ifb-table-wrap--scroll"><table class="ifb-table ifb-cross-table">
    <caption class="ifb-sr">השוואה בין קורסים בשאלות הליבה</caption>
    <thead><tr><th scope="col">שאלת ליבה</th>${programKeys.map((k) => `<th scope="col" class="ifb-center${k === ui.course ? ' is-selected' : ''}">${esc(programTitle(k))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <th scope="row" data-label="שאלת ליבה"><span class="ifb-q-text">${esc(neutralCoreText(r.text))}</span><span class="ifb-cell-sub ifb-muted">${esc(metricLabel(r.metric_key))}</span></th>
      ${programKeys.map((k) => `<td data-label="${esc(programTitle(k))}" class="ifb-center${k === ui.course ? ' is-selected' : ''}">${r.byProgram[k] ? `<span class="ifb-num">${fmtNum(r.byProgram[k].avg)}</span> <span class="ifb-muted">N=${r.byProgram[k].n}</span>` : '<span class="ifb-muted">—</span>'}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function populationResultsHtml(facts, { section }) {
  const blocks = [];
  for (const audience of AUDIENCE_ORDER) {
    for (const stage of AUDIENCE_STAGES[audience]) {
      const subset = factsFor(facts, audience, stage).filter((f) => (section === 'course' ? f.section === 'course' : f.section !== 'course'));
      if (!subset.length) continue;
      blocks.push(`<details class="ifb-disclosure"${blocks.length === 0 ? ' open' : ''}>
        <summary>${esc(AUDIENCE_LABELS[audience])} – ${esc(stageLabelFor(audience, stage))} <span class="ifb-muted">(${new Set(subset.map((f) => f.response_id)).size} שאלונים)</span></summary>
        ${questionTableHtml(subset, { caption: `${AUDIENCE_LABELS[audience]} – ${stageLabelFor(audience, stage)}` })}
      </details>`);
    }
  }
  return blocks.length ? blocks.join('') : emptyHtml(section === 'course' ? 'טרם התקבלו תשובות לשאלות הייחודיות לקורס.' : 'טרם התקבלו תשובות.');
}

function analysisHtml() {
  if (!ui.course) {
    return `
      ${analysisFiltersHtml()}
      ${selectCourseHint('סיכום מצטבר, השוואה בין אוכלוסיות, פתיחה–סיום ותוצאות לכל שאלה')}
      ${sectionHtml('השוואה בין קורסים במדדי ליבה', crossCourseHtml(), { actions: exportButtonHtml('analysis', 'דוח כל הקורסים (Excel)') })}`;
  }
  const facts = courseFacts();
  return `
    ${analysisFiltersHtml()}
    ${sectionHtml(`סיכום מצטבר – ${programTitle(ui.course)}`, cumulativeSummaryHtml(), { actions: exportButtonHtml('analysis', 'הפקת דוח מסכם (Excel)'), note: 'הנתונים מתייחסים רק למחצית הנבחרת, לפי תאריך תחילת הקורס.' })}
    ${sectionHtml('השוואה בין תלמידים, מדריכים וצוות חינוכי', audienceComparisonHtml(facts))}
    ${sectionHtml('פתיחה–סיום: תלמידים', prePostQuestionTableHtml(factsFor(facts, 'student', 'pre'), factsFor(facts, 'student', 'post'), { audience: 'student' }))}
    ${sectionHtml('פתיחה–סיום: מדריכים', prePostQuestionTableHtml(factsFor(facts, 'instructor', 'pre'), factsFor(facts, 'instructor', 'final'), { audience: 'instructor' }))}
    ${sectionHtml('תוצאות לכל שאלה – שאלות ליבה', populationResultsHtml(facts, { section: 'core' }))}
    ${sectionHtml('מדדים ייחודיים לקורס', populationResultsHtml(facts, { section: 'course' }), { note: 'שאלות שנכתבו לפי מטרות ותוצרי הקורס. אינן משמשות להשוואה בין קורסים.' })}
    ${sectionHtml('השוואה בין קורסים במדדי ליבה', crossCourseHtml())}`;
}

// ---------------------------------------------------------------------------
// Group view (opened from the students / staff tabs)
// ---------------------------------------------------------------------------


function defaultExpiry(slot) {
  const days = slot.audience === 'student' ? 14 : 21;
  return isoDay(Date.now() + days * DAY_MS);
}

function slotMissingReason(group, slot) {
  if (slot.audience === 'educational_staff' && !group.has_contact) return 'לא מוגדר איש קשר לקבוצה. יש להגדיר איש קשר בכרטיס הפעילות.';
  return '';
}

function openFormHtml(group, slot) {
  const key = `${group.row_id}|${slot.key}`;
  if (!group.program_key) return '<p class="ifb-warning">לתוכנית זו טרם הותאמה תבנית משוב. ההתאמה מטופלת בניהול המערכת.</p>';
  const missing = slotMissingReason(group, slot);
  if (missing) return `<p class="ifb-warning">${esc(missing)}</p>`;
  if (!ui.openForms.has(key)) {
    return `<div class="ifb-slot__actions"><button type="button" class="ifb-btn ifb-btn--primary" data-ifb-show-open="${esc(key)}">${slot.audience === 'student' ? 'פתיחת משוב' : 'יצירת קישור'}</button></div>`;
  }
  return `
    <form class="ifb-open-form" data-ifb-open-form="${esc(key)}">
      <label class="ifb-field"><span>מועד פתיחה</span><input type="date" name="opens" value="${isoDay(Date.now())}" min="${isoDay(Date.now())}" required></label>
      <label class="ifb-field"><span>תוקף עד</span><input type="date" name="expires" value="${defaultExpiry(slot)}" min="${isoDay(Date.now() + DAY_MS)}"></label>
      <div class="ifb-slot__actions">
        <button type="submit" class="ifb-btn ifb-btn--primary">${slot.audience === 'student' ? 'פתיחת המשוב' : 'יצירת קישור אישי'}</button>
        <button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-cancel-open="${esc(key)}">ביטול</button>
      </div>
    </form>`;
}

function slotCardHtml(group, slot) {
  const campaign = slotCampaign(group, slot);
  const status = campaignUiStatus(campaign);
  const title = `<h3 class="ifb-slot__title">${esc(slot.label)}</h3>`;
  if (!campaign) {
    return `<article class="ifb-slot" data-slot="${slot.key}">
      <div class="ifb-slot__head">${title}${campaignStatusHtml(null)}</div>
      ${slot.audience === 'educational_staff' && group.contact_name ? `<p class="ifb-muted">איש קשר: ${esc(group.contact_name)}</p>` : ''}
      ${openFormHtml(group, slot)}
    </article>`;
  }
  const isStudent = slot.audience === 'student';
  const live = status.key === 'active' || status.key === 'collecting' || status.key === 'scheduled';
  const recipient = campaign.recipient;
  const meta = `
    <dl class="ifb-meta">
      <div><dt>נפתח</dt><dd>${fmtDate(campaign.opens_at)}</dd></div>
      <div><dt>תוקף</dt><dd>${campaign.expires_at ? fmtDate(campaign.expires_at) : 'ללא'}</dd></div>
      <div><dt>שאלונים</dt><dd>${Number(campaign.responses) || 0}</dd></div>
      <div><dt>גרסת שאלון</dt><dd>${esc(String(campaign.version_no ?? '—'))}${campaign.template_is_current === false ? ' <span class="ifb-muted">(קיימת גרסה חדשה יותר)</span>' : ''}</dd></div>
      ${!isStudent && recipient ? `<div class="ifb-meta__wide"><dt>נמען</dt><dd>${esc(recipient.display_name || '—')}${recipient.phone ? ` · <span dir="ltr">${esc(recipient.phone)}</span>` : ''}${recipient.email ? ` · ${esc(recipient.email)}` : ''}</dd></div>` : ''}
      ${!isStudent && recipient?.completed_at ? `<div class="ifb-meta__wide"><dt>מולא</dt><dd>${fmtDate(recipient.completed_at)}</dd></div>` : ''}
      ${!isStudent && recipient?.last_shared_at && !recipient?.completed_at ? `<div class="ifb-meta__wide"><dt>נשלח לאחרונה</dt><dd>${fmtDate(recipient.last_shared_at)} (${esc({ whatsapp: 'WhatsApp', email: 'מייל', copy: 'העתקה' }[recipient.last_shared_channel] || '')})</dd></div>` : ''}
    </dl>`;
  let actions = '';
  const id = esc(campaign.id);
  if (isStudent) {
    actions = `
      ${live ? `<button type="button" class="ifb-btn ifb-btn--primary" data-ifb-qr="${id}">הצגת QR</button>` : ''}
      <button type="button" class="ifb-btn" data-ifb-copy="${id}">העתקת קישור</button>
      ${campaign.status === 'active' ? `<button type="button" class="ifb-btn ifb-btn--danger" data-ifb-close="${id}">סגירה</button>` : `<button type="button" class="ifb-btn" data-ifb-reopen="${id}">פתיחה מחדש</button>`}`;
  } else if (status.key === 'completed') {
    actions = '<span class="ifb-muted">המשוב הושלם ונעול</span>';
  } else {
    const links = personalShareLinks(campaign, { programTitle: programTitle(group.program_key), schoolName: group.school });
    actions = `
      <a class="ifb-btn ifb-btn--whatsapp${live ? '' : ' is-disabled'}" href="${esc(links.whatsapp)}" target="_blank" rel="noopener" data-ifb-share="whatsapp" data-campaign="${id}"${live ? '' : ' aria-disabled="true"'}>WhatsApp</a>
      <a class="ifb-btn${live && links.hasEmail ? '' : ' is-disabled'}" href="${esc(links.email)}" data-ifb-share="email" data-campaign="${id}" title="${links.hasEmail ? '' : 'לא קיימת כתובת מייל לנמען'}"${live && links.hasEmail ? '' : ' aria-disabled="true"'}>מייל</a>
      <button type="button" class="ifb-btn" data-ifb-copy="${id}">העתקת קישור</button>
      ${campaign.status === 'active' ? `<button type="button" class="ifb-btn ifb-btn--danger" data-ifb-close="${id}">סגירה</button>` : `<button type="button" class="ifb-btn" data-ifb-reopen="${id}">פתיחה מחדש</button>`}`;
  }
  const extendForm = status.key === 'expired' || (campaign.status === 'active' && status.key !== 'completed')
    ? `<details class="ifb-extend"><summary>עדכון תוקף</summary>
        <form data-ifb-extend="${id}"><label class="ifb-field"><span>תוקף עד</span><input type="date" name="expires" min="${isoDay(Date.now() + DAY_MS)}" value="${campaign.expires_at ? isoDay(campaign.expires_at) : ''}"></label>
        <button type="submit" class="ifb-btn ifb-btn--sm">שמירה</button></form></details>`
    : '';
  return `<article class="ifb-slot" data-slot="${slot.key}" data-campaign="${id}">
    <div class="ifb-slot__head">${title}${campaignStatusHtml(campaign)}</div>
    ${meta}
    <div class="ifb-slot__actions">${actions}</div>
    ${extendForm}
  </article>`;
}

function prePostMetricTableHtml(comparison) {
  if (!comparison.nPre && !comparison.nPost) return '<p class="ifb-muted">טרם התקבלו תשובות תלמידים.</p>';
  const note = !comparison.nPre ? '<p class="ifb-muted">אין שאלוני פתיחה.</p>'
    : !comparison.nPost ? '<p class="ifb-muted">אין שאלוני סיום.</p>' : '';
  return `${note}
    <div class="ifb-table-wrap"><table class="ifb-table ifb-table--compact">
      <thead><tr><th scope="col">מדד</th><th scope="col">פתיחה</th><th scope="col">סיום</th><th scope="col">שינוי</th><th scope="col">מגמה</th></tr></thead>
      <tbody>${comparison.rows.map((r) => `
        <tr>
          <th scope="row" data-label="מדד">${esc(r.label)}</th>
          <td data-label="פתיחה">${fmtNum(r.preAvg)} <span class="ifb-muted">N=${r.nPre}</span></td>
          <td data-label="סיום">${fmtNum(r.postAvg)} <span class="ifb-muted">N=${r.nPost}</span></td>
          <td data-label="שינוי" class="${deltaClass(r.delta)}">${fmtDelta(r.delta)}</td>
          <td data-label="מגמה">${esc(describeGroupChange(r.preAvg, r.postAvg))}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function groupResultsHtml(facts) {
  const p = threePerspectives(facts, ui.metrics);
  const staffFacts = factsFor(facts, 'educational_staff');
  return `<div class="ifb-angles">
    <section class="ifb-panel ifb-angle ifb-angle--students">
      <h3>תלמידים</h3>
      ${prePostMetricTableHtml(p.students.comparison)}
    </section>
    <section class="ifb-panel ifb-angle ifb-angle--staff">
      <h3>צוות חינוכי</h3>
      ${p.staff.n ? questionTableHtml(staffFacts, { caption: 'צוות חינוכי' }) : '<p class="ifb-muted">טרם התקבל משוב מהצוות החינוכי.</p>'}
    </section>
  </div>`;
}

function groupViewHtml(group) {
  if (!group) return errorHtml('הקבוצה לא נמצאה בשנת הלימודים שנבחרה');
  const facts = ui.groupFacts.get(group.row_id);
  const back = TABS.find((t) => t.key === ui.groupReturnTab)?.label || 'תלמידים';
  const staffView = ui.groupReturnTab === 'staff';
  // The activity is the single source of truth for course, school, grade and dates.
  const activityTitle = group.activity_name || (group.program_key ? programTitle(group.program_key) : 'שם תוכנית לא הוגדר');
  const groupLevel = [group.grade, group.class_group].filter(Boolean).join(' · ');
  // The staff tab is for managing school-contact feedback, not for showing
  // unrelated student questionnaires/results on the same operational screen.
  const visibleSlots = staffView ? GROUP_SLOTS.filter((slot) => slot.audience === 'educational_staff') : GROUP_SLOTS;
  const staffFacts = staffView && facts ? factsFor(facts, 'educational_staff') : [];
  const staffOpenAnswers = staffView && facts ? openAnswers(staffFacts) : [];
  const results = staffView
    ? (!facts
      ? loadingHtml('טוען תוצאות…')
      : staffFacts.length
        ? questionTableHtml(staffFacts, { caption: 'תוצאות משוב הצוות החינוכי' })
        : '<p class="ifb-staff-results-empty">עדיין לא התקבלו תשובות מהצוות החינוכי בקבוצה זו.</p>')
    : facts ? groupResultsHtml(facts) : loadingHtml('טוען תוצאות…');
  return `
    <div class="ifb-group-detail${staffView ? ' ifb-group-detail--staff' : ''}">
      <button type="button" class="ifb-back" data-ifb-back>→ חזרה ללשונית ${esc(back)}</button>
      <section class="ifb-group-head" aria-label="פרטי הקבוצה">
        <header class="ifb-group-head__identity">
          <h2 class="ifb-group-head__title">${esc(group.school || 'בית הספר לא הוגדר')}</h2>
          <p class="ifb-group-head__program">${esc(activityTitle)}</p>
        </header>
        <dl class="ifb-meta ifb-meta--head">
          <div><dt>רשות</dt><dd>${esc(group.authority || 'לא הוגדרה')}</dd></div>
          <div><dt>${group.grade && group.class_group ? 'שכבה / קבוצה' : group.class_group ? 'קבוצה' : 'שכבה'}</dt><dd>${esc(groupLevel || 'לא הוגדרה')}</dd></div>
          <div><dt>מדריך/ה</dt><dd>${esc(group.instructor_name || 'לא שובץ/ה')}</dd></div>
          <div><dt>איש/אשת קשר</dt><dd>${esc(group.contact_name || (group.has_contact ? 'מוגדר/ת' : 'לא הוגדר/ה'))}</dd></div>
          <div class="ifb-group-head__date"><dt>תחילת קורס</dt><dd>${fmtDate(group.start_date)}</dd></div>
          <div class="ifb-group-head__date"><dt>סיום קורס</dt><dd>${fmtDate(group.end_date)}</dd></div>
        </dl>
      </section>
      <div class="ifb-slots${staffView ? ' ifb-slots--staff' : ''}">${visibleSlots.map((slot) => slotCardHtml(group, slot)).join('')}</div>
      ${sectionHtml(staffView ? 'תוצאות משוב הצוות החינוכי' : 'תוצאות הקבוצה', results, {
        actions: facts ? (staffView ? (staffFacts.length ? exportButtonHtml(`group-staff:${group.row_id}`, 'ייצוא צוות חינוכי (Excel)') : '') : exportButtonHtml(`group:${group.row_id}`, 'ייצוא הקבוצה (Excel)')) : ''
      })}
      ${facts && (!staffView || staffOpenAnswers.length) ? `<details class="ifb-disclosure ifb-group-answers">
        <summary>תשובות פתוחות <span class="ifb-muted">(${staffView ? staffOpenAnswers.length : openAnswers(facts).length})</span></summary>
        ${openAnswersListHtml(staffView ? staffOpenAnswers : openAnswers(facts), { showContext: false })}
      </details>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportFacts(scope) {
  if (scope.startsWith('group-staff:')) return factsFor(ui.groupFacts.get(scope.slice(12)) || [], 'educational_staff');
  if (scope.startsWith('group:')) return ui.groupFacts.get(scope.slice(6)) || [];
  if (scope.startsWith('audience:')) return courseFacts().filter((f) => f.audience === scope.slice(9));
  return courseFacts();
}

function openAnswersExportRows(facts) {
  return openAnswers(facts).map((a) => [
    String(a.submitted_at || '').slice(0, 16).replace('T', ' '),
    AUDIENCE_LABELS[a.audience] || a.audience || '',
    stageLabelFor(a.audience, a.stage),
    programTitle(a.program_key),
    a.authority_name || '',
    a.school_name || '',
    a.grade || '',
    a.activity_name || '',
    a.respondent_name || '',
    a.question_text || '',
    a.text || ''
  ]);
}

function collectionExportRows(programKeys) {
  const rows = [];
  for (const key of programKeys) {
    for (const audience of AUDIENCE_ORDER) {
      const c = courseCollection(ui.summary || [], key, audience);
      if (!c.campaigns) continue;
      for (const stage of AUDIENCE_STAGES[audience]) {
        const s = c.byStage[stage];
        rows.push([
          programTitle(key), AUDIENCE_LABELS[audience], stageLabelFor(audience, stage),
          s.campaigns, s.responses,
          audience === 'student' ? '' : s.invited,
          audience === 'student' ? '' : s.completed,
          s.responseRate === null ? '' : `${s.responseRate}%`,
          audience === 'student' ? (s.participants ? `${s.rateCoverage} קבוצות עם מספר משתתפים` : 'אין מספר משתתפים') : '',
          c.anonymous ? 'אנונימי' : (c.uniqueRespondents ?? '')
        ]);
      }
    }
  }
  return rows;
}

function setExportSheetLayout(sheet, widths) {
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
}

function appendSheet(wb, name, headers, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  setExportSheetLayout(sheet, widths);
  XLSX.utils.book_append_sheet(wb, sheet, name);
}

function runExport(scope) {
  const facts = exportFacts(scope);
  const isGroup = scope.startsWith('group:') || scope.startsWith('group-staff:');
  if (!facts.length && isGroup) {
    showToast('אין נתונים לייצוא', 'info');
    return;
  }
  const stamp = isoDay(Date.now());
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  if (!isGroup && ui.summary) {
    const keys = ui.course ? [ui.course] : ui.programs.map((p) => p.key);
    appendSheet(wb, 'איסוף והיענות', ['קורס', 'קהל', 'שלב', 'משובים שנפתחו', 'שאלונים שהוגשו', 'נשלחו', 'הושלמו', 'היענות', 'בסיס ההיענות', 'משיבים ייחודיים'],
      collectionExportRows(keys), [24, 14, 20, 14, 14, 10, 10, 10, 30, 16]);
  }
  appendSheet(wb, 'תוצאות לפי שאלה', QUESTION_EXPORT_HEADERS, questionExportRows(facts, { programs: ui.programs, metrics: ui.metrics }),
    [24, 14, 20, 14, 18, 56, 14, 14, 12, 12, 6, 6, 6, 6, 6, 18]);
  if (!isGroup && ui.course) {
    const cmpRows = [];
    for (const [audience, pre, post] of [['student', 'pre', 'post'], ['instructor', 'pre', 'final']]) {
      for (const r of comparePrePostByQuestion(factsFor(facts, audience, pre), factsFor(facts, audience, post)).rows) {
        cmpRows.push([AUDIENCE_LABELS[audience], r.text, metricLabel(r.metric_key), r.preAvg ?? '', r.nPre, r.postAvg ?? '', r.nPost, r.comparable ? (r.delta ?? '') : 'לא בר השוואה (ניסוח שונה)']);
      }
    }
    appendSheet(wb, 'פתיחה-סיום', ['קהל', 'שאלה', 'מדד', 'ממוצע פתיחה', 'N פתיחה', 'ממוצע סיום', 'N סיום', 'שינוי בממוצע האוכלוסייה'], cmpRows, [14, 56, 18, 12, 10, 12, 10, 24]);
    const aud = audienceMetricScores(facts, ui.metrics, { minN: MIN_N_GAP }).map((r) => [
      r.label,
      ...AUDIENCE_ORDER.flatMap((a) => [r.cells[a]?.avg ?? '', r.cells[a]?.n ?? '']),
      r.gap ? `${r.gap.label} (${r.gap.gap})` : ''
    ]);
    appendSheet(wb, 'השוואת אוכלוסיות', ['מדד', 'תלמידים – ממוצע', 'תלמידים – N', 'מדריכים – ממוצע', 'מדריכים – N', 'צוות – ממוצע', 'צוות – N', 'הבדל'], aud, [20, 14, 10, 14, 10, 14, 10, 18]);
  }
  if (!isGroup) {
    const cross = [];
    for (const audience of AUDIENCE_ORDER) {
      for (const stage of AUDIENCE_STAGES[audience]) {
        const { programKeys, rows } = crossCourseCore(semesterFacts(), { audience, stage });
        for (const r of rows) {
          for (const k of programKeys) {
            if (r.byProgram[k]) cross.push([AUDIENCE_LABELS[audience], stageLabelFor(audience, stage), neutralCoreText(r.text), programTitle(k), r.byProgram[k].avg ?? '', r.byProgram[k].n]);
          }
        }
      }
    }
    appendSheet(wb, 'השוואת קורסים (ליבה)', ['קהל', 'שלב', 'שאלת ליבה', 'קורס', 'ממוצע', 'N'], cross, [14, 20, 56, 24, 10, 8]);
  } else {
    appendSheet(wb, 'סיכום מדדים', SUMMARY_EXPORT_HEADERS, summaryExportRows(threePerspectives(facts, ui.metrics), ui.metrics), [26, 24, 18, 18, 16, 16, 12, 12, 14, 34]);
  }
  appendSheet(wb, 'תשובות פתוחות', ['תאריך מילוי', 'קהל', 'שלב', 'קורס', 'רשות', 'בית ספר', 'שכבה', 'שם הפעילות', 'שם הממלא/ת', 'שאלה', 'תשובה'],
    openAnswersExportRows(facts), [18, 18, 14, 22, 18, 22, 12, 28, 22, 42, 56]);
  appendSheet(wb, 'נתונים גולמיים', RAW_EXPORT_HEADERS, rawExportRows(facts, { programs: ui.programs, metrics: ui.metrics }),
    [18, 18, 18, 14, 22, 18, 18, 22, 12, 14, 18, 28, 20, 22, 14, 18, 18, 14, 42, 34]);

  const scopeName = isGroup
    ? (facts[0]?.school_name || 'קבוצה')
    : ui.course ? programTitle(ui.course) : 'כל-הקורסים';
  const base = `משובים-${String(scopeName).replace(/[\\/?%*:|"<>]/g, '_')}-${academicYearLabel(ui.year).replace(/[\\/?%*:|"<>()]/g, '')}-${stamp}`.replace(/\s+/g, '-');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`);
}

// ---------------------------------------------------------------------------
// Render + events
// ---------------------------------------------------------------------------

function viewHtml() {
  if (ui.error) return errorHtml(ui.error);
  if (ui.groupRowId) {
    if (ui.loading || !ui.groups) return loadingHtml();
    return groupViewHtml(findGroup(ui.groupRowId));
  }
  if (ui.loading || !ui.programs.length || !needsReady()) return loadingHtml();
  if (ui.tab === 'students') return studentsHtml();
  if (ui.tab === 'instructors') return instructorsHtml();
  if (ui.tab === 'staff') return staffHtml();
  if (ui.tab === 'analysis') return analysisHtml();
  if (ui.tab === 'templates') return `<p class="ifb-template-semester-note">תבניות השאלונים משותפות למחצית א׳ ולמחצית ב׳ ואין צורך לשכפל אותן.</p>${courseOnlyFiltersHtml('templates')}${renderTemplatesView(ui)}`;
  return overviewHtml();
}

const FOCUS_ATTRS = ['data-f', 'data-i', 'data-o', 'data-a'];

function paint(host, { focusTab = false } = {}) {
  if (!host.isConnected) return;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  let focusKey = null;
  if (active && host.contains(active)) {
    focusKey = FOCUS_ATTRS.map((attr) => active.getAttribute(attr) && `[${attr}="${active.getAttribute(attr)}"]`).find(Boolean)
      || (active.matches('[data-ifb-course]') ? '[data-ifb-course]' : null);
  }
  host.innerHTML = shellHtml(viewHtml());
  if (focusTab) host.querySelector(`[data-ifb-tab="${ui.tab}"]`)?.focus();
  else if (focusKey) {
    const el = host.querySelector(focusKey);
    if (el) {
      el.focus();
      if (el.type === 'search') el.setSelectionRange?.(el.value.length, el.value.length);
    }
  }
  window.scrollTo({ top: scrollY });
  if (host.querySelector('[data-ifb-templates]') || host.querySelector('[data-tpl-reload]')) bindTemplatesView(host, ui, () => paint(host));
}

async function load(host, { force = false, focusTab = false } = {}) {
  ui.error = '';
  ui.loading = true;
  paint(host, { focusTab });
  try {
    await ensureDefinitions();
    const needs = ui.groupRowId ? ['groups'] : (TAB_NEEDS[ui.tab] || []);
    await Promise.all(needs.map((need) => ({
      summary: () => ensureSummary(force),
      facts: () => ensureFacts(force),
      groups: () => ensureGroups(force),
      assignments: () => ensureInstructorAssignments(force)
    })[need]()));
    if (ui.groupRowId) {
      // Always show live counts for the opened group.
      await refreshGroup(ui.groupRowId);
      ui.groupFacts.delete(ui.groupRowId);
      ui.loading = false;
      paint(host);
      await ensureGroupFacts(ui.groupRowId, true);
    }
  } catch (error) {
    ui.error = translateFeedbackError(error);
  } finally {
    ui.loading = false;
    paint(host, { focusTab });
  }
}

function campaignById(id) {
  for (const group of ui.groups || []) {
    const campaign = (group.campaigns || []).find((c) => c.id === id);
    if (campaign) return { group, instructorAssignment: null, campaign };
  }
  for (const row of ui.instructorAssignments || []) {
    for (const campaign of [row.pre_campaign, row.final_campaign]) {
      if (campaign?.id === id) return { group: null, instructorAssignment: row, campaign };
    }
  }
  return { group: null, instructorAssignment: null, campaign: null };
}

/** Collection figures and results change with every campaign action. */
function invalidateAggregates() {
  ui.facts = null;
  ui.summary = null;
}

async function afterCampaignChange(host, rowId) {
  await refreshGroup(rowId);
  invalidateAggregates();
  paint(host);
}

async function afterInstructorCampaignChange(host) {
  await ensureInstructorAssignments(true);
  invalidateAggregates();
  await ensureFacts(true);
  paint(host);
}

async function switchTab(host, key, { focusTab = false } = {}) {
  if (!TABS.some((t) => t.key === key)) return;
  ui.tab = key;
  ui.groupRowId = null;
  ui.templates.templateId = null;
  await load(host, { force: true, focusTab });
}

function handleTabKeys(host, event) {
  const tab = event.target.closest('[data-ifb-tab]');
  if (!tab) return;
  const index = TABS.findIndex((t) => t.key === tab.dataset.ifbTab);
  let next = null;
  // RTL: the visually next tab is to the left.
  if (event.key === 'ArrowLeft') next = (index + 1) % TABS.length;
  else if (event.key === 'ArrowRight') next = (index - 1 + TABS.length) % TABS.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = TABS.length - 1;
  if (next === null) return;
  event.preventDefault();
  switchTab(host, TABS[next].key, { focusTab: true });
}

async function handleClick(host, event) {
  const t = event.target;
  const tab = t.closest('[data-ifb-tab]');
  if (tab) { await switchTab(host, tab.dataset.ifbTab); return; }
  if (t.closest('[data-ifb-retry]') || t.closest('[data-ifb-refresh]')) { await load(host, { force: true }); return; }
  const analyze = t.closest('[data-ifb-analyze]');
  if (analyze) {
    ui.course = analyze.dataset.ifbAnalyze;
    await switchTab(host, 'analysis');
    window.scrollTo({ top: 0 });
    return;
  }
  const groupHalf = t.closest('[data-ifb-group-half]');
  if (groupHalf) {
    const next = groupHalf.dataset.ifbGroupHalf;
    if ((next === 'first' || next === 'second') && ui.feedbackHalf !== next) {
      ui.feedbackHalf = next;
      ui.summary = null;
      ui.summaryHalf = null;
      await load(host);
    }
    return;
  }
  const openGroup = t.closest('[data-ifb-open-group]');
  if (openGroup) {
    ui.groupReturnTab = ui.tab;
    ui.groupRowId = openGroup.dataset.ifbOpenGroup;
    window.scrollTo({ top: 0 });
    await load(host);
    return;
  }
  if (t.closest('[data-ifb-back]')) { ui.groupRowId = null; ui.tab = ui.groupReturnTab || 'students'; await load(host, { force: true }); return; }
  const clear = t.closest('[data-ifb-clear]');
  if (clear) {
    const target = clear.dataset.ifbClear === 'instructors' ? ui.instructorFilters : ui.filters;
    for (const key of Object.keys(target)) target[key] = '';
    paint(host);
    return;
  }
  const showOpen = t.closest('[data-ifb-show-open]');
  if (showOpen) { ui.openForms.add(showOpen.dataset.ifbShowOpen); paint(host); return; }
  const cancelOpen = t.closest('[data-ifb-cancel-open]');
  if (cancelOpen) { ui.openForms.delete(cancelOpen.dataset.ifbCancelOpen); paint(host); return; }
  const instructorOpen = t.closest('[data-ifb-instructor-open]');
  if (instructorOpen) { ui.instructorOpenForms.add(instructorOpen.dataset.ifbInstructorOpen); paint(host); return; }
  const instructorCancel = t.closest('[data-ifb-instructor-cancel]');
  if (instructorCancel) { ui.instructorOpenForms.delete(instructorCancel.dataset.ifbInstructorCancel); paint(host); return; }
  const qr = t.closest('[data-ifb-qr]');
  if (qr) {
    const { group, campaign } = campaignById(qr.dataset.ifbQr);
    if (campaign) {
      await openQrProjection(campaign, {
        programTitle: programTitle(group.program_key), schoolName: group.school, grade: group.grade,
        onCopy: (ok) => showToast(ok ? 'הקישור הועתק' : 'ההעתקה נכשלה', ok ? 'success' : 'error')
      });
    }
    return;
  }
  const copy = t.closest('[data-ifb-copy]');
  if (copy) {
    const { campaign } = campaignById(copy.dataset.ifbCopy);
    const ok = campaign ? await copyText(campaignLink(campaign)) : false;
    showToast(ok ? 'הקישור הועתק' : 'ההעתקה נכשלה', ok ? 'success' : 'error');
    if (ok && campaign?.audience !== 'student') updateCampaign(campaign.id, 'mark_shared', { channel: 'copy' }).catch(() => {});
    return;
  }
  const share = t.closest('[data-ifb-share]');
  if (share) {
    if (share.classList.contains('is-disabled')) { event.preventDefault(); return; }
    updateCampaign(share.dataset.campaign, 'mark_shared', { channel: share.dataset.ifbShare }).catch(() => {});
    return;
  }
  const close = t.closest('[data-ifb-close]');
  const reopen = t.closest('[data-ifb-reopen]');
  if (close || reopen) {
    const id = (close || reopen).dataset[close ? 'ifbClose' : 'ifbReopen'];
    const { group, instructorAssignment } = campaignById(id);
    if (close && !window.confirm('לסגור את המשוב? לא יתקבלו תשובות נוספות (ניתן לפתוח מחדש).')) return;
    try {
      await updateCampaign(id, close ? 'close' : 'reopen');
      showToast(close ? 'המשוב נסגר' : 'המשוב נפתח מחדש');
      if (instructorAssignment) await afterInstructorCampaignChange(host);
      else if (group) await afterCampaignChange(host, group.row_id);
    } catch (error) {
      showToast(translateFeedbackError(error), 'error', 5000);
    }
    return;
  }
  const exp = t.closest('[data-ifb-export]');
  if (exp) runExport(exp.dataset.scope);
}

async function handleSubmit(host, event) {
  const form = event.target;
  if (form.closest('[data-ifb-templates]')) return;
  if (form.matches('[data-ifb-instructor-open-form]')) {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await openInstructorCampaign(form.dataset.emp, form.dataset.program, form.dataset.year, form.dataset.stage, {
        opensAt: openingIso(String(data.get('opens') || '')),
        expiresAt: expiryIso(String(data.get('expires') || ''))
      });
      ui.instructorOpenForms.delete(form.dataset.key);
      showToast(form.dataset.stage === 'pre' ? 'נוצר משוב פתיחה למדריך' : 'נוצר משוב סיום למדריך');
      await afterInstructorCampaignChange(host);
    } catch (error) {
      button.disabled = false;
      showToast(translateFeedbackError(error), 'error', 6000);
    }
    return;
  }
  if (form.matches('[data-ifb-open-form]')) {
    event.preventDefault();
    const [rowId, slotKey] = form.dataset.ifbOpenForm.split('|');
    const slot = SLOTS.find((s) => s.key === slotKey);
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await openCampaign(rowId, slot.audience, slot.stage, {
        opensAt: openingIso(String(data.get('opens') || '')),
        expiresAt: expiryIso(String(data.get('expires') || ''))
      });
      ui.openForms.delete(form.dataset.ifbOpenForm);
      showToast(slot.audience === 'student' ? 'המשוב נפתח – ה־QR והקישור מוכנים' : 'הקישור האישי נוצר');
      await afterCampaignChange(host, rowId);
    } catch (error) {
      button.disabled = false;
      showToast(translateFeedbackError(error), 'error', 6000);
    }
    return;
  }
  if (form.matches('[data-ifb-extend]')) {
    event.preventDefault();
    const id = form.dataset.ifbExtend;
    const { group, campaign } = campaignById(id);
    const day = String(new FormData(form).get('expires') || '');
    try {
      if (campaign.status === 'closed' || campaignUiStatus(campaign).key === 'expired') {
        await updateCampaign(id, 'reopen', { expiresAt: expiryIso(day) });
      } else {
        await updateCampaign(id, 'update_window', { expiresAt: expiryIso(day) });
      }
      showToast('התוקף עודכן');
      await afterCampaignChange(host, group.row_id);
    } catch (error) {
      showToast(translateFeedbackError(error), 'error', 5000);
    }
  }
}

function resetYearScopedState() {
  ui.groupRowId = null;
  ui.groupFacts.clear();
  ui.groups = null;
  ui.instructorAssignments = null;
  ui.summary = null;
  ui.facts = null;
  ui.summaryHalf = null;
  ui.feedbackHalf = 'first';
  ui.instructorOpenForms.clear();
  ui.openForms.clear();
}

function handleFilterInput(host, event) {
  const el = event.target;
  if (el.matches('[data-ifb-course]')) {
    ui.course = el.value;
    ui.templates.templateId = null;
    paint(host);
    return;
  }
  const map = [['f', ui.filters], ['i', ui.instructorFilters], ['o', ui.overview], ['a', ui.analysis]];
  for (const [attr, target] of map) {
    const key = el.getAttribute(`data-${attr}`);
    if (key) {
      target[key] = el.value;
      paint(host);
      return;
    }
  }
}

/**
 * Keep the feedback activity view in sync with the canonical activities table.
 * Opening the feedback screen and switching tabs already perform a forced read.
 * While student/staff/instructor tabs remain open, re-read in the foreground every minute and
 * when the browser regains focus; deletions and cleared dates are reflected too.
 * No second date store, database triggers, or persistent polling in the background.
 */
function installActivityDateSync(host) {
  activitySyncController?.abort();
  if (activitySyncTimer !== null) window.clearInterval(activitySyncTimer);
  const controller = new AbortController();
  activitySyncController = controller;
  let lastCheckedAt = 0;
  let pending = false;
  const check = async () => {
    if (!host.isConnected) {
      controller.abort();
      window.clearInterval(activitySyncTimer);
      activitySyncTimer = null;
      return;
    }
    if (pending || ui.loading || ui.groupRowId ||
        !['students', 'staff', 'instructors'].includes(ui.tab) ||
        document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (now - lastCheckedAt < ACTIVITY_SYNC_MIN_GAP_MS) return;
    lastCheckedAt = now;
    pending = true;
    const year = ui.year;
    const tab = ui.tab;
    try {
      if (tab === 'instructors') {
        const assignments = await fetchInstructorAssignments(year);
        if (controller.signal.aborted || !host.isConnected || year !== ui.year ||
            tab !== ui.tab || ui.groupRowId) return;
        if (JSON.stringify(assignments) !== JSON.stringify(ui.instructorAssignments)) {
          ui.instructorAssignments = assignments;
          ui.instructorAssignmentsYear = year;
          paint(host);
        }
      } else {
        const groups = await fetchGroups(year);
        if (controller.signal.aborted || !host.isConnected || year !== ui.year ||
            tab !== ui.tab || ui.groupRowId) return;
        if (JSON.stringify(groups) !== JSON.stringify(ui.groups)) {
          ui.groups = groups;
          ui.groupsYear = year;
          paint(host);
        }
      }
    } catch (error) {
      // A temporary refresh failure must not clear the current table.
      console.warn('[impact-feedback:activity-sync]', translateFeedbackError(error));
    } finally {
      pending = false;
    }
  };
  window.addEventListener('focus', check, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  }, { signal: controller.signal });
  window.addEventListener('israa-activities-changed', () => {
    lastCheckedAt = 0;
    check();
  }, { signal: controller.signal });
  activitySyncTimer = window.setInterval(check, ACTIVITY_SYNC_INTERVAL_MS);
}

function mount(host, state) {
  if (!isAdmin(state)) {
    host.innerHTML = '<div class="ifb-empty ifb-empty--error" role="alert"><p>מודול המשובים זמין לאדמין בלבד.</p></div>';
    return;
  }
  // The dashboard owns the year; feedback never exposes an independent year selector.
  const dashboardYear = normalizeGlobalActivityPeriod(state?.activityPeriodTab || ACTIVE_ACTIVITY_SEASON);
  if (ui.year !== dashboardYear) {
    ui.year = dashboardYear;
    resetYearScopedState();
  }
  const entry = state.impactFeedback;
  if (entry?.groupRowId) {
    ui.tab = 'students';
    ui.groupReturnTab = 'students';
    ui.groupRowId = entry.groupRowId;
    state.impactFeedback = null;
  }
  host.addEventListener('click', (event) => {
    // Store the user's explicit filter toggle before the browser changes <details>.open.
    const disclosure = event.target.closest('summary.ifb-filter-toggle')?.closest('details[data-ifb-filter-disclosure]');
    if (disclosure) ui.filterExpanded[disclosure.dataset.ifbFilterDisclosure] = !disclosure.open;
    handleClick(host, event);
  });
  host.addEventListener('keydown', (event) => { handleTabKeys(host, event); });
  host.addEventListener('submit', (event) => { handleSubmit(host, event); });
  host.addEventListener('change', (event) => {
    if (event.target.matches('input[type="search"]')) return;
    if (event.target.closest('[data-ifb-templates]')) return;
    handleFilterInput(host, event);
  });
  host.addEventListener('input', (event) => {
    if (event.target.matches('input[type="search"]')) handleFilterInput(host, event);
  });
  installActivityDateSync(host);
  load(host, { force: true });
}

export const impactFeedbackScreen = {
  load() {
    return Promise.resolve({});
  },
  render() {
    return '<div class="ifb-admin" data-ifb-admin dir="rtl"></div>';
  },
  bind({ root, state }) {
    const host = root.querySelector('[data-ifb-admin]');
    if (host) mount(host, state);
  }
};
