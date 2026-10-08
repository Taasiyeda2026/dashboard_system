/**
 * "משובים" — admin-only module.
 * Isolated screen: owns its own data loading and sub-views inside the route root.
 * Server enforces admin access (RLS + admin-checked RPCs); the client check is only UX.
 */
import * as XLSX from 'xlsx';
import { escapeHtml as esc } from './shared/html.js';
import { showToast } from './shared/toast.js';
import { ACTIVE_ACTIVITY_SEASON } from './shared/summer-activity.js';
import {
  AGE_BANDS,
  AUDIENCE_LABELS,
  RAW_EXPORT_HEADERS,
  PROGRAM_SOURCE_LABELS,
  GROUP_SLOTS,
  SLOTS,
  SUMMARY_EXPORT_HEADERS,
  academicYearLabel,
  ageBandLabel,
  buildCsv,
  campaignUiStatus,
  dashboardKpis,
  describeGroupChange,
  factsFor,
  filterFacts,
  filterGroups,
  groupHasFeedback,
  isProgramUnresolved,
  multiSelectDistribution,
  openAnswers,
  perspectiveGap,
  rawExportRows,
  slotCampaign,
  summaryExportRows,
  threePerspectives,
  uniqueSorted
} from '../impact-feedback/feedback-domain.js';
import {
  fetchAnswerFacts,
  fetchGroups,
  fetchInstructorAssignments,
  fetchMetrics,
  fetchPrograms,
  openCampaign,
  openInstructorCampaign,
  setActivityProgram,
  translateFeedbackError,
  updateCampaign
} from '../impact-feedback/feedback-api.js';
import { campaignLink, copyText, openQrProjection, personalShareLinks } from '../impact-feedback/feedback-share.js';
import { renderTemplatesView, bindTemplatesView } from '../impact-feedback/feedback-templates-view.js';
import '../impact-feedback/feedback-form.css';
import '../impact-feedback/impact-feedback-admin.css';

const YEAR_OPTIONS = ['school_2027', 'regular'];
const DAY_MS = 24 * 60 * 60 * 1000;

const ui = {
  tab: 'overview',
  groupRowId: null,
  year: ACTIVE_ACTIVITY_SEASON,
  showAll: true,
  filters: { program: '', authority: '', school: '', instructor: '', ageBand: '', from: '', to: '', status: '', search: '' },
  results: { program: '', authority: '', school: '', ageBand: '', group: '', instructor: '', from: '', to: '', drill: '' },
  answers: { program: '', audience: '', question: '', school: '', search: '' },
  templates: { templateId: null, versionId: null, previewBand: '' },
  instructorFilters: { search: '', program: '', status: '' },
  groups: null,
  groupsYear: null,
  instructorAssignments: null,
  instructorAssignmentsYear: null,
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

function programTitle(key) {
  return ui.programs.find((p) => p.key === key)?.title || key || '';
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

function statusChip(campaign) {
  const status = campaignUiStatus(campaign);
  return `<span class="ifb-chip ifb-chip--${status.tone}" data-status="${status.key}">${esc(status.label)}</span>`;
}

function tableStatusHtml(campaign) {
  const status = campaignUiStatus(campaign);
  const studentResponses = campaign?.audience === 'student' ? Number(status.responses || 0) : 0;
  return `<div class="ifb-status-cell">
    <span class="ifb-chip ifb-chip--${status.tone}" data-status="${status.key}">${esc(status.label)}</span>
    ${studentResponses > 0 ? `<span class="ifb-status-cell__count">${studentResponses} תשובות</span>` : ''}
  </div>`;
}

function optionList(values, selected, emptyLabel, labelFn = (v) => v) {
  return `<option value="">${esc(emptyLabel)}</option>${values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labelFn(v))}</option>`).join('')}`;
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

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'overview', label: 'סקירה' },
  { key: 'instructors', label: 'משובי מדריכים' },
  { key: 'results', label: 'תוצאות והשפעה' },
  { key: 'answers', label: 'תשובות פתוחות' },
  { key: 'templates', label: 'תבניות ושאלות' }
];

function shellHtml(inner) {
  return `
    <div class="ifb-admin__head">
      <div>
        <h1 class="ifb-admin__title">משובים</h1>
        <p class="ifb-admin__sub">מדידת למידה, התקדמות והשפעה בתוכניות תעשיידע</p>
      </div>
      <div class="ifb-slot__actions">
      <button type="button" class="ifb-btn" data-ifb-refresh title="טעינה מחדש של הנתונים">↻ רענון</button>
      <label class="ifb-field ifb-field--inline">
        <span>שנת פעילות</span>
        <select data-ifb-year>${YEAR_OPTIONS.map((y) => `<option value="${y}"${y === ui.year ? ' selected' : ''}>${esc(academicYearLabel(y))}</option>`).join('')}</select>
      </label>
      </div>
    </div>
    <nav class="ifb-tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" role="tab" class="ifb-tab${ui.tab === t.key ? ' is-active' : ''}" aria-selected="${ui.tab === t.key}" data-ifb-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </nav>
    <div class="ifb-view">${inner}</div>`;
}

function loadingHtml(text = 'טוען נתונים…') {
  return `<div class="ifb-empty" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>${esc(text)}</p></div>`;
}

function errorHtml(message) {
  return `<div class="ifb-empty ifb-empty--error" role="alert"><p>${esc(message)}</p><button type="button" class="ifb-btn" data-ifb-retry>נסו שוב</button></div>`;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function kpiHtml(groups, instructorAssignments = []) {
  const k = dashboardKpis(groups);
  const instructorCampaigns = instructorAssignments.map((row) => row.campaign).filter(Boolean);
  const pendingInstructor = instructorCampaigns.filter((campaign) => {
    const key = campaignUiStatus(campaign).key;
    return key === 'active' || key === 'collecting';
  }).length;
  const instructorCompleted = instructorCampaigns.filter((campaign) => campaign?.recipient?.status === 'completed').length;
  const staffCampaigns = groups.flatMap((group) => (group.campaigns || []).filter((campaign) => campaign.audience === 'educational_staff'));
  const staffCompleted = staffCampaigns.filter((campaign) => campaign?.recipient?.status === 'completed').length;
  const personalTotal = instructorCampaigns.length + staffCampaigns.length;
  const responseRate = personalTotal ? Math.round(((instructorCompleted + staffCompleted) / personalTotal) * 100) : null;
  const items = [
    ['קבוצות עם משובים', k.withFeedback, `מתוך ${groups.length} קבוצות`, k.unresolved ? `${k.unresolved} דורשות שיוך` : ''],
    ['משובי פתיחה פעילים', k.activePre, 'תלמידים', ''],
    ['משובי סיום פעילים', k.activePost, 'תלמידים', ''],
    ['ממתינים למדריך', pendingInstructor, 'משוב חד־פעמי לפי תוכנית', ''],
    ['ממתינים לאיש קשר', k.pendingContact, 'קישורים שטרם מולאו', ''],
    ['שיעור מענה', responseRate === null ? '—' : `${responseRate}%`, responseRate === null ? 'אין עדיין נתונים' : `צוות ומדריכים · ${k.studentResponses} תשובות תלמידים`, '']
  ];
  return `<div class="ifb-kpis">${items.map(([label, value, hint, warning]) => `
    <div class="ifb-kpi${warning ? ' ifb-kpi--warning' : ''}">
      <span class="ifb-kpi__label">${esc(label)}</span>
      <strong class="ifb-kpi__value">${esc(String(value))}</strong>
      <span class="ifb-kpi__hint">${esc(hint)}</span>
      ${warning ? `<span class="ifb-kpi__warning">${esc(warning)}</span>` : ''}
    </div>`).join('')}</div>`;
}
function overviewFiltersHtml(groups) {
  const f = ui.filters;
  const advancedCount = [f.instructor, f.ageBand, f.from, f.to].filter(Boolean).length;
  return `
    <section class="ifb-filter-panel">
      <div class="ifb-filters ifb-filters--primary" data-ifb-filters="overview">
        <label class="ifb-field ifb-field--search"><span>חיפוש</span><input type="search" data-f="search" value="${esc(f.search)}" placeholder="בית ספר, רשות, מדריך…"></label>
        <label class="ifb-field"><span>תוכנית</span><select data-f="program">${optionList(ui.programs.map((p) => p.key), f.program, 'כל התוכניות', programTitle)}</select></label>
        <label class="ifb-field"><span>רשות</span><select data-f="authority">${optionList(uniqueSorted(groups.map((g) => g.authority)), f.authority, 'כל הרשויות')}</select></label>
        <label class="ifb-field"><span>בית ספר</span><select data-f="school">${optionList(uniqueSorted(groups.map((g) => g.school)), f.school, 'כל בתי הספר')}</select></label>
        <label class="ifb-field"><span>סטטוס</span><select data-f="status">
          ${[['', 'הכל'], ['unresolved', 'תוכנית לא זוהתה'], ['has_feedback', 'יש משובים'], ['no_feedback', 'ללא משובים'], ['any_live', 'משוב פעיל'], ['pending_contact', 'ממתין לאיש קשר'], ['expired', 'פג תוקף'], ['completed_all', 'הושלם (3 משובים)'], ['excluded', 'הוסתרו (לא רלוונטי)']]
            .map(([v, l]) => `<option value="${v}"${v === f.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select></label>
        <button type="button" class="ifb-btn ifb-btn--ghost ifb-clear-btn" data-ifb-clear="overview">ניקוי</button>
      </div>
      <details class="ifb-filter-more"${advancedCount ? ' open' : ''}>
        <summary>סינון נוסף${advancedCount ? ` <span class="ifb-filter-count">${advancedCount}</span>` : ''}</summary>
        <div class="ifb-filters ifb-filters--more">
          <label class="ifb-field"><span>מדריך</span><select data-f="instructor">${optionList(uniqueSorted(groups.map((g) => g.instructor_name)), f.instructor, 'כל המדריכים')}</select></label>
          <label class="ifb-field"><span>שכבה</span><select data-f="ageBand">${optionList(AGE_BANDS.map((b) => b.key), f.ageBand, 'כל השכבות', ageBandLabel)}</select></label>
          <label class="ifb-field"><span>התחלה מ־</span><input type="date" data-f="from" value="${esc(f.from)}"></label>
          <label class="ifb-field"><span>עד</span><input type="date" data-f="to" value="${esc(f.to)}"></label>
        </div>
      </details>
    </section>`;
}
function resultsCellHtml(group) {
  const pre = slotCampaign(group, SLOTS[0]);
  const post = slotCampaign(group, SLOTS[1]);
  const nPre = Number(pre?.responses) || 0;
  const nPost = Number(post?.responses) || 0;
  const staffDone = (group.campaigns || []).some((c) => c.audience === 'educational_staff' && c.recipient?.status === 'completed');
  if (!nPre && !nPost && !staffDone) return '<span class="ifb-muted">—</span>';
  return `<button type="button" class="ifb-link" data-ifb-results-group="${esc(group.row_id)}">פתיחה ${nPre} · סיום ${nPost}${staffDone ? ' · צוות הושלם' : ''}</button>`;
}

function programOptionsHtml(selected = '') {
  return `<option value="">בחירת תוכנית…</option>${ui.programs.map((p) => `<option value="${esc(p.key)}"${p.key === selected ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}`;
}

/** Inline picker in the table row: status + choose one of the 8 programs. */
function programQuickPickHtml(group) {
  return `<div class="ifb-unresolved">
    <span class="ifb-chip ifb-chip--warning">תוכנית לא זוהתה</span>
    <span class="ifb-muted ifb-unresolved__name">${esc(group.activity_name || '')}</span>
    <form class="ifb-unresolved__form" data-ifb-set-program="${esc(group.row_id)}">
      <select name="program" aria-label="בחירת תוכנית ידנית" required>${programOptionsHtml()}</select>
      <button type="submit" class="ifb-btn ifb-btn--sm">שמירה</button>
    </form>
  </div>`;
}

/** Group screen card: manual program choice (feedback mapping only; activity data untouched). */
function programCardHtml(group) {
  const locked = groupHasFeedback(group);
  const unresolved = isProgramUnresolved(group);
  if (locked) {
    return `<p class="ifb-note">תוכנית: <strong>${esc(programTitle(group.program_key))}</strong> · ${esc(PROGRAM_SOURCE_LABELS[group.program_source] || '')} · נעולה לאחר פתיחת משוב.</p>`;
  }
  const form = `
    <form class="ifb-program-form" data-ifb-set-program="${esc(group.row_id)}">
      <label class="ifb-field"><span>תוכנית</span><select name="program" required>${programOptionsHtml(group.program_key || '')}</select></label>
      <label class="ifb-check"><input type="checkbox" name="apply_to_name"> להחיל על כל הפעילויות בשם „${esc(group.activity_name || '')}”</label>
      <div class="ifb-slot__actions">
        <button type="submit" class="ifb-btn ifb-btn--primary">שמירת תוכנית</button>
        ${group.program_source === 'manual' || group.program_source === 'manual_name' || group.feedback_excluded
          ? '<button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-program-auto>חזרה לזיהוי אוטומטי</button>' : ''}
        ${group.feedback_excluded ? '' : '<button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-program-exclude>לא רלוונטי למשובים</button>'}
      </div>
    </form>`;
  if (unresolved || group.feedback_excluded) {
    return `<section class="ifb-panel ifb-program-card--pick" data-ifb-program-card>
      <h3>${group.feedback_excluded ? 'הפעילות סומנה כלא רלוונטית למשובים' : '⚠️ תוכנית לא זוהתה'}</h3>
      <p class="ifb-note">שם הפעילות „${esc(group.activity_name || '')}” לא זוהה כאחת מ־8 התוכניות. בחרו תוכנית – הבחירה נשמרת למודול המשובים בלבד ואינה משנה את נתוני הפעילות.</p>
      ${form}
    </section>`;
  }
  return `<details class="ifb-program-change" data-ifb-program-card>
    <summary>תוכנית: <strong>${esc(programTitle(group.program_key))}</strong> · ${esc(PROGRAM_SOURCE_LABELS[group.program_source] || '')} · שינוי</summary>
    ${form}
  </details>`;
}

function overviewTableHtml(groups) {
  if (!groups.length) {
    return `<div class="ifb-empty"><p>לא נמצאו קבוצות התואמות לסינון.</p><p class="ifb-muted">המודול מציג פעילויות של 8 התוכניות לפי שם הפעילות בשנת הפעילות שנבחרה.</p></div>`;
  }
  const rows = groups.map((g) => `
    <tr data-row="${esc(g.row_id)}">
      <td class="ifb-col-school" data-label="בית ספר"><strong class="ifb-school-name">${esc(g.school || '—')}</strong>${g.class_group ? `<span class="ifb-muted ifb-cell-sub">${esc(g.class_group)}</span>` : ''}</td>
      <td class="ifb-col-authority" data-label="רשות">${esc(g.authority || '—')}</td>
      <td class="ifb-col-program" data-label="תוכנית">${g.program_key
        ? esc(programTitle(g.program_key))
        : g.feedback_excluded
          ? '<span class="ifb-chip ifb-chip--muted">לא רלוונטי למשובים</span>'
          : programQuickPickHtml(g)}</td>
      <td class="ifb-col-grade" data-label="שכבה">${esc(g.grade || ageBandLabel(g.age_band) || '—')}</td>
      <td class="ifb-col-instructor" data-label="מדריך">${esc(g.instructor_name || '—')}</td>
      <td class="ifb-col-date" data-label="התחלה">${fmtDate(g.start_date)}</td>
      <td class="ifb-col-date" data-label="סיום">${fmtDate(g.end_date)}</td>
      ${GROUP_SLOTS.map((slot) => `<td class="ifb-col-status" data-label="${esc(slot.label)}">${g.program_key ? tableStatusHtml(slotCampaign(g, slot)) : '<span class="ifb-muted">—</span>'}</td>`).join('')}
      <td class="ifb-col-results" data-label="תוצאות">${resultsCellHtml(g)}</td>
      <td class="ifb-col-actions" data-label="פעולות"><button type="button" class="ifb-row-action" data-ifb-open-group="${esc(g.row_id)}" title="ניהול משובי הקבוצה">ניהול</button></td>
    </tr>`).join('');
  return `
    <div class="ifb-table-wrap ifb-overview-wrap">
      <table class="ifb-table ifb-overview-table">
        <colgroup>
          <col class="ifb-w-school">
          <col class="ifb-w-authority">
          <col class="ifb-w-program">
          <col class="ifb-w-grade">
          <col class="ifb-w-instructor">
          <col class="ifb-w-date">
          <col class="ifb-w-date">
          <col class="ifb-w-status">
          <col class="ifb-w-status">
          <col class="ifb-w-status">
          <col class="ifb-w-results">
          <col class="ifb-w-actions">
        </colgroup>
        <thead><tr>
          <th class="ifb-col-school">בית ספר</th>
          <th class="ifb-col-authority">רשות</th>
          <th class="ifb-col-program">תוכנית</th>
          <th class="ifb-col-grade">שכבה</th>
          <th class="ifb-col-instructor">מדריך</th>
          <th class="ifb-col-date">התחלה</th>
          <th class="ifb-col-date">סיום</th>
          <th class="ifb-col-status">תלמידים – פתיחה</th>
          <th class="ifb-col-status">תלמידים – סיום</th>
          <th class="ifb-col-status">צוות חינוכי</th>
          <th class="ifb-col-results">תוצאות</th>
          <th class="ifb-col-actions">פעולות</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
function overviewHtml() {
  const groups = ui.groups || [];
  const scoped = ui.showAll ? groups : groups.filter(groupHasFeedback);
  const filtered = filterGroups(scoped, ui.filters).sort((a, b) =>
    Number(groupHasFeedback(b)) - Number(groupHasFeedback(a))
    || String(a.school).localeCompare(String(b.school), 'he'));
  const unresolved = groups.filter(isProgramUnresolved).length;
  return `
    ${kpiHtml(groups, ui.instructorAssignments || [])}
    ${overviewFiltersHtml(groups)}
    <div class="ifb-list-head">
      <div class="ifb-list-head__title">
        <h2>קבוצות <span class="ifb-list-count">(${filtered.length})</span></h2>
        ${unresolved ? `<button type="button" class="ifb-chip ifb-chip--warning ifb-unresolved-filter" data-ifb-show-unresolved>${unresolved} דורשות שיוך תוכנית</button>` : ''}
      </div>
      <label class="ifb-check"><input type="checkbox" data-ifb-show-all${ui.showAll ? ' checked' : ''}> הצגת קבוצות ללא משובים</label>
    </div>
    ${overviewTableHtml(filtered)}`;
}

// ---------------------------------------------------------------------------
// Group view
// ---------------------------------------------------------------------------

function defaultExpiry(slot) {
  const days = slot.audience === 'student' ? 14 : 21;
  return isoDay(Date.now() + days * DAY_MS);
}

function slotMissingReason(group, slot) {
  if (slot.audience === 'educational_staff' && !group.has_contact) return 'לא מוגדר איש קשר לקבוצה. יש להגדיר איש קשר בכרטיס הפעילות.';
  if (slot.audience === 'instructor' && !group.instructor_emp_id && !group.instructor_name) return 'לא משובץ מדריך לקבוצה.';
  return '';
}

function openFormHtml(group, slot) {
  const key = `${group.row_id}|${slot.key}`;
  if (!group.program_key) return '<p class="ifb-warning">יש לבחור תוכנית לפני פתיחת משוב.</p>';
  const missing = slotMissingReason(group, slot);
  if (missing) return `<p class="ifb-warning">${esc(missing)}</p>`;
  if (!ui.openForms.has(key)) {
    return `<div class="ifb-slot__actions"><button type="button" class="ifb-btn ifb-btn--primary" data-ifb-show-open="${esc(key)}">${slot.audience === 'student' ? 'פתח משוב' : 'צור קישור'}</button></div>`;
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
      <div class="ifb-slot__head">${title}${statusChip(null)}</div>
      ${slot.audience === 'educational_staff' && group.contact_name ? `<p class="ifb-muted">איש קשר: ${esc(group.contact_name)}</p>` : ''}
      ${slot.audience === 'instructor' && group.instructor_name ? `<p class="ifb-muted">מדריך: ${esc(group.instructor_name)}</p>` : ''}
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
      <div><dt>תשובות</dt><dd>${Number(campaign.responses) || 0}</dd></div>
      <div><dt>גרסת שאלון</dt><dd>v${esc(String(campaign.version_no || ''))}${campaign.template_is_current === false ? ' <span class="ifb-chip ifb-chip--muted" title="המשוב נשאר על הגרסה שהייתה בתוקף בפתיחתו">גרסה קודמת</span>' : ''}</dd></div>
      ${!isStudent && recipient ? `<div class="ifb-meta__wide"><dt>נמען</dt><dd>${esc(recipient.display_name || '—')}${recipient.phone ? ` · <span dir="ltr">${esc(recipient.phone)}</span>` : ''}${recipient.email ? ` · ${esc(recipient.email)}` : ''}</dd></div>` : ''}
      ${!isStudent && recipient?.completed_at ? `<div class="ifb-meta__wide"><dt>מולא</dt><dd>${fmtDate(recipient.completed_at)}</dd></div>` : ''}
      ${!isStudent && recipient?.last_shared_at && !recipient?.completed_at ? `<div class="ifb-meta__wide"><dt>נשלח לאחרונה</dt><dd>${fmtDate(recipient.last_shared_at)} (${esc({ whatsapp: 'WhatsApp', email: 'מייל', copy: 'העתקה' }[recipient.last_shared_channel] || '')})</dd></div>` : ''}
    </dl>`;
  let actions = '';
  const id = esc(campaign.id);
  if (isStudent) {
    actions = `
      ${live ? `<button type="button" class="ifb-btn ifb-btn--primary" data-ifb-qr="${id}">הצג QR</button>` : ''}
      <button type="button" class="ifb-btn" data-ifb-copy="${id}">העתק קישור</button>
      ${campaign.status === 'active' ? `<button type="button" class="ifb-btn ifb-btn--danger" data-ifb-close="${id}">סגור</button>` : `<button type="button" class="ifb-btn" data-ifb-reopen="${id}">פתח מחדש</button>`}`;
  } else if (status.key === 'completed') {
    actions = '<span class="ifb-muted">המשוב הושלם ונעול</span>';
  } else {
    const links = personalShareLinks(campaign, { programTitle: programTitle(group.program_key), schoolName: group.school });
    actions = `
      <a class="ifb-btn ifb-btn--whatsapp${live ? '' : ' is-disabled'}" href="${esc(links.whatsapp)}" target="_blank" rel="noopener" data-ifb-share="whatsapp" data-campaign="${id}">WhatsApp</a>
      <a class="ifb-btn${live && links.hasEmail ? '' : ' is-disabled'}" href="${esc(links.email)}" data-ifb-share="email" data-campaign="${id}" title="${links.hasEmail ? '' : 'לא קיימת כתובת מייל לנמען'}">מייל</a>
      <button type="button" class="ifb-btn" data-ifb-copy="${id}">העתק קישור</button>
      ${campaign.status === 'active' ? `<button type="button" class="ifb-btn ifb-btn--danger" data-ifb-close="${id}">סגור</button>` : `<button type="button" class="ifb-btn" data-ifb-reopen="${id}">פתח מחדש</button>`}`;
  }
  const extendForm = status.key === 'expired' || (campaign.status === 'active' && status.key !== 'completed')
    ? `<details class="ifb-extend"><summary>עדכון תוקף</summary>
        <form data-ifb-extend="${id}"><label class="ifb-field"><span>תוקף עד</span><input type="date" name="expires" min="${isoDay(Date.now() + DAY_MS)}" value="${campaign.expires_at ? isoDay(campaign.expires_at) : ''}"></label>
        <button type="submit" class="ifb-btn ifb-btn--sm">שמירה</button></form></details>`
    : '';
  return `<article class="ifb-slot" data-slot="${slot.key}" data-campaign="${id}">
    <div class="ifb-slot__head">${title}${statusChip(campaign)}</div>
    ${meta}
    <div class="ifb-slot__actions">${actions}</div>
    ${extendForm}
  </article>`;
}

function metricTilesHtml(population, metricKeys, emptyText) {
  if (!population.n) return `<p class="ifb-muted">${esc(emptyText)}</p>`;
  const tiles = metricKeys
    .filter((key) => population.byMetric[key])
    .map((key) => {
      const s = population.byMetric[key];
      return `<button type="button" class="ifb-score" data-ifb-drill="${esc(key)}" title="לחצו לפירוט השאלות">
        <span class="ifb-score__label">${esc(metricLabel(key))}</span>
        <strong class="ifb-score__value">${s.score ?? '—'}</strong>
        <span class="ifb-score__hint">ממוצע ${s.avg ?? '—'} · N=${s.n}</span>
      </button>`;
    }).join('');
  return `<div class="ifb-scores">${tiles || '<p class="ifb-muted">אין שאלות דירוג במדדים אלו</p>'}</div>`;
}

function drillHtml(population, metricKey) {
  if (!metricKey) return '';
  const questions = population.byQuestion.filter((q) => q.metric_key === metricKey);
  if (!questions.length) return '';
  return `<div class="ifb-drill"><h4>${esc(metricLabel(metricKey))} – השאלות שהרכיבו את המדד</h4><ul>
    ${questions.map((q) => `<li><span>${esc(q.text)}</span><strong>${q.avg ?? '—'}</strong><span class="ifb-muted">N=${q.n}</span></li>`).join('')}
  </ul></div>`;
}

function prePostTableHtml(comparison) {
  if (!comparison.nPre && !comparison.nPost) return '<p class="ifb-muted">טרם התקבלו תשובות תלמידים.</p>';
  const note = !comparison.nPre ? '<p class="ifb-note">יש רק נתוני סיום – אין השוואה לפתיחה.</p>'
    : !comparison.nPost ? '<p class="ifb-note">יש רק נתוני פתיחה – ההשוואה תוצג לאחר משוב הסיום.</p>' : '';
  return `${note}
    <p class="ifb-note">השוואה בין ממוצע הקבוצה בפתיחה לממוצע הקבוצה בסיום (אין התאמה בין תלמידים). N פתיחה: ${comparison.nPre} · N סיום: ${comparison.nPost}</p>
    <div class="ifb-table-wrap"><table class="ifb-table ifb-table--compact">
      <thead><tr><th>מדד</th><th>PRE</th><th>POST</th><th>Δ</th><th>Δ%</th><th>N פתיחה</th><th>N סיום</th><th>מגמה</th></tr></thead>
      <tbody>${comparison.rows.map((r) => `
        <tr>
          <td data-label="מדד"><strong>${esc(r.label)}</strong></td>
          <td data-label="PRE">${r.preAvg ?? '—'}</td>
          <td data-label="POST">${r.postAvg ?? '—'}</td>
          <td data-label="Δ" class="${r.delta > 0 ? 'ifb-up' : r.delta < 0 ? 'ifb-down' : ''}">${r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}`}</td>
          <td data-label="Δ%">${r.deltaPct === null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`}</td>
          <td data-label="N פתיחה">${r.nPre}</td>
          <td data-label="N סיום">${r.nPost}</td>
          <td data-label="מגמה">${esc(describeGroupChange(r.preAvg, r.postAvg))}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function distributionHtml(facts, title) {
  const multi = facts.filter((f) => f.question_type === 'multi_select');
  if (!multi.length) return '';
  const { responses, counts } = multiSelectDistribution(multi);
  const labels = {};
  for (const f of multi) for (const o of f.question_options || []) labels[o.value] = o.label;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return `<div class="ifb-dist"><h4>${esc(title)}</h4><ul>${rows.map(([value, count]) => `
    <li><span>${esc(labels[value] || metricLabel(value))}</span><span class="ifb-bar"><span style="width:${Math.round((count / responses) * 100)}%"></span></span><strong>${count}/${responses}</strong></li>`).join('')}</ul></div>`;
}

function singleSelectHtml(facts) {
  const selects = facts.filter((f) => f.question_type === 'single_select');
  if (!selects.length) return '';
  const byQuestion = new Map();
  for (const f of selects) {
    if (!byQuestion.has(f.question_id)) byQuestion.set(f.question_id, { text: f.question_text, options: f.question_options || [], counts: new Map(), n: 0 });
    const q = byQuestion.get(f.question_id);
    q.n += 1;
    for (const v of f.value_options || []) q.counts.set(v, (q.counts.get(v) || 0) + 1);
  }
  return [...byQuestion.values()].map((q) => `<div class="ifb-dist"><h4>${esc(q.text)}</h4><ul>${q.options.map((o) => {
    const count = q.counts.get(o.value) || 0;
    return `<li><span>${esc(o.label)}</span><span class="ifb-bar"><span style="width:${q.n ? Math.round((count / q.n) * 100) : 0}%"></span></span><strong>${count}</strong></li>`;
  }).join('')}</ul></div>`).join('');
}

function alignmentHtml(perspectives, { includeInstructor = true } = {}) {
  const impact = ui.metrics.filter((m) => m.kind === 'impact');
  const rows = impact.map((m) => {
    const s = perspectives.students.post.byMetric[m.key]?.score ?? null;
    const st = perspectives.staff.byMetric[m.key]?.score ?? null;
    const ins = includeInstructor ? (perspectives.instructor.byMetric[m.key]?.score ?? null) : null;
    if (s === null && st === null && ins === null) return '';
    const scores = includeInstructor ? [s, st, ins] : [s, st];
    const gap = perspectiveGap(scores);
    return `<tr>
      <td data-label="מדד"><strong>${esc(m.label)}</strong></td>
      <td data-label="קול התלמידים">${s ?? '—'}</td>
      <td data-label="צוות חינוכי">${st ?? '—'}</td>
      ${includeInstructor ? `<td data-label="מדריך">${ins ?? '—'}</td>` : ''}
      <td data-label="התאמה">${gap ? `<span class="ifb-chip ifb-chip--${gap.key === 'aligned' ? 'success' : gap.key === 'partial' ? 'info' : 'warning'}">${esc(gap.label)} (${gap.gap})</span>` : '<span class="ifb-muted">אין מספיק זוויות</span>'}</td>
    </tr>`;
  }).join('');
  if (!rows) return '';
  return `<section class="ifb-panel"><h3>${includeInstructor ? 'האם שלוש הזוויות מצביעות על אותה מגמה?' : 'האם התלמידים והצוות החינוכי מצביעים על אותה מגמה?'}</h3>
    <p class="ifb-note">ציוני 0–100 של כל אוכלוסייה בנפרד. אין ממוצע משולב בין האוכלוסיות.</p>
    <div class="ifb-table-wrap"><table class="ifb-table ifb-table--compact"><thead><tr><th>מדד</th><th>קול התלמידים</th><th>צוות חינוכי</th>${includeInstructor ? '<th>מדריך</th>' : ''}<th>התאמה</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function perspectivesHtml(facts, scopeKey, { includeInstructor = true } = {}) {
  const perspectives = threePerspectives(facts, ui.metrics);
  const impactKeys = ui.metrics.filter((m) => m.kind === 'impact').map((m) => m.key);
  const programKeys = ui.metrics.filter((m) => m.kind === 'program').map((m) => m.key);
  const drill = ui.results.drill && ui.results.drill.startsWith(`${scopeKey}|`) ? ui.results.drill.split('|') : [];
  const drillFor = (who, population) => (drill[1] === who ? drillHtml(population, drill[2]) : '');
  return `
    <div class="ifb-angles${includeInstructor ? '' : ' ifb-angles--two'}" data-ifb-scope="${esc(scopeKey)}">
      <section class="ifb-panel ifb-angle ifb-angle--students" data-ifb-who="students">
        <h3>🎒 קול התלמידים</h3>
        ${prePostTableHtml(perspectives.students.comparison)}
        <h4>ציוני מדדים – משוב סיום</h4>
        ${metricTilesHtml(perspectives.students.post, impactKeys, 'טרם התקבלו תשובות סיום.')}
        ${drillFor('students', perspectives.students.post)}
      </section>
      <section class="ifb-panel ifb-angle ifb-angle--staff" data-ifb-who="staff">
        <h3>🏫 הערכת הצוות החינוכי</h3>
        ${metricTilesHtml(perspectives.staff, [...impactKeys, ...programKeys], 'טרם התקבל משוב מהצוות החינוכי.')}
        ${drillFor('staff', perspectives.staff)}
        ${distributionHtml(factsFor(facts, 'educational_staff'), 'באילו תחומים הבחינו בשינוי')}
      </section>
      ${includeInstructor ? `<section class="ifb-panel ifb-angle ifb-angle--instructor" data-ifb-who="instructor">
        <h3>🧑‍🏫 הערכת המדריך</h3>
        ${metricTilesHtml(perspectives.instructor, [...programKeys, ...impactKeys], 'טרם התקבל משוב מהמדריך.')}
        ${drillFor('instructor', perspectives.instructor)}
        ${singleSelectHtml(factsFor(facts, 'instructor'))}
      </section>` : ''}
    </div>
    ${alignmentHtml(perspectives, { includeInstructor })}`;
}

function openAnswersListHtml(items, { showContext = true } = {}) {
  if (!items.length) return '<p class="ifb-muted">אין תשובות פתוחות.</p>';
  return `<ul class="ifb-answers">${items.map((a) => `
    <li class="ifb-answer">
      <p class="ifb-answer__text">${esc(a.text)}</p>
      <p class="ifb-answer__meta">
        <span class="ifb-chip ifb-chip--muted">${esc(AUDIENCE_LABELS[a.audience] || '')}${a.audience === 'student' ? ` · ${a.stage === 'pre' ? 'פתיחה' : 'סיום'}` : ''}</span>
        <span>${esc(a.question_text)}</span>
        ${showContext ? `<span>${esc(programTitle(a.program_key))}${a.school_name ? ` · ${esc(a.school_name)}` : ''}${a.grade ? ` · ${esc(a.grade)}` : ''}</span>` : ''}
        ${a.respondent_name ? `<span>${esc(a.respondent_name)}</span>` : ''}
        <span>${fmtDate(a.submitted_at)}</span>
      </p>
    </li>`).join('')}</ul>`;
}

function exportButtonsHtml(scope) {
  return `<div class="ifb-export">
    <button type="button" class="ifb-btn" data-ifb-export="xlsx" data-scope="${esc(scope)}">⬇ Excel (נתונים + סיכום)</button>
    <button type="button" class="ifb-btn" data-ifb-export="raw" data-scope="${esc(scope)}">⬇ CSV נתונים גולמיים</button>
    <button type="button" class="ifb-btn" data-ifb-export="summary" data-scope="${esc(scope)}">⬇ CSV סיכום</button>
  </div>`;
}

function groupViewHtml(group) {
  if (!group) return errorHtml('הקבוצה לא נמצאה בשנת הפעילות שנבחרה');
  const facts = ui.groupFacts.get(group.row_id);
  return `
    <button type="button" class="ifb-back" data-ifb-back>→ חזרה לכל הקבוצות</button>
    <section class="ifb-group-head">
      <div>
        <p class="ifb-kicker">${group.program_key ? esc(programTitle(group.program_key)) : 'תוכנית לא זוהתה'}</p>
        <h2 class="ifb-group-head__title">${esc(group.school || '—')}${group.grade ? ` · שכבה ${esc(group.grade)}` : ''}</h2>
        <p class="ifb-muted">${esc(group.activity_name)}</p>
      </div>
      <dl class="ifb-meta ifb-meta--head">
        <div><dt>רשות</dt><dd>${esc(group.authority || '—')}</dd></div>
        <div><dt>מדריך</dt><dd>${esc(group.instructor_name || 'לא משובץ')}</dd></div>
        <div><dt>איש קשר</dt><dd>${esc(group.contact_name || (group.has_contact ? 'מוגדר' : 'לא מוגדר'))}</dd></div>
        <div><dt>שנת פעילות</dt><dd>${esc(academicYearLabel(group.academic_year))}</dd></div>
        <div><dt>התחלה</dt><dd>${fmtDate(group.start_date)}</dd></div>
        <div><dt>סיום</dt><dd>${fmtDate(group.end_date)}</dd></div>
        <div><dt>שכבת גיל לניסוח</dt><dd>${esc(ageBandLabel(group.age_band) || 'ברירת מחדל')}</dd></div>
      </dl>
    </section>
    ${programCardHtml(group)}
    <div class="ifb-slots">${GROUP_SLOTS.map((slot) => slotCardHtml(group, slot)).join('')}</div>
    <section class="ifb-section">
      <div class="ifb-section__head"><h2>תלמידים וצוות חינוכי</h2>${facts ? exportButtonsHtml(`group:${group.row_id}`) : ''}</div>
      ${facts ? perspectivesHtml(facts, `group:${group.row_id}`, { includeInstructor: false }) : loadingHtml('טוען תוצאות…')}
    </section>
    ${facts ? `<section class="ifb-section"><h2>תשובות פתוחות</h2>${openAnswersListHtml(openAnswers(facts), { showContext: false })}</section>` : ''}`;
}

// ---------------------------------------------------------------------------
// Instructor feedback — once per instructor + program + academic year
// ---------------------------------------------------------------------------

function instructorAssignmentKey(row) {
  return `${row.instructor_emp_id}|${row.program_key}|${row.academic_year}`;
}

function instructorCampaignActionsHtml(row) {
  const campaign = row.campaign;
  const key = instructorAssignmentKey(row);
  if (!campaign) {
    if (!ui.instructorOpenForms.has(key)) {
      return `<button type="button" class="ifb-btn ifb-btn--primary ifb-btn--sm" data-ifb-instructor-open="${esc(key)}">צור משוב</button>`;
    }
    return `
      <form class="ifb-instructor-open-form" data-ifb-instructor-open-form
        data-emp="${esc(row.instructor_emp_id)}" data-program="${esc(row.program_key)}" data-year="${esc(row.academic_year)}" data-key="${esc(key)}">
        <label class="ifb-field"><span>פתיחה</span><input type="date" name="opens" value="${isoDay(Date.now())}" required></label>
        <label class="ifb-field"><span>תוקף עד</span><input type="date" name="expires" value="${isoDay(Date.now() + (14 * DAY_MS))}" min="${isoDay(Date.now() + DAY_MS)}"></label>
        <div class="ifb-slot__actions">
          <button type="submit" class="ifb-btn ifb-btn--primary ifb-btn--sm">יצירת קישור</button>
          <button type="button" class="ifb-btn ifb-btn--ghost ifb-btn--sm" data-ifb-instructor-cancel="${esc(key)}">ביטול</button>
        </div>
      </form>`;
  }

  const status = campaignUiStatus(campaign);
  if (status.key === 'completed') return '<span class="ifb-muted">המשוב הושלם ונעול</span>';
  const links = personalShareLinks(campaign, { programTitle: programTitle(row.program_key), schoolName: '' });
  const live = status.key === 'active' || status.key === 'collecting' || status.key === 'scheduled';
  return `<div class="ifb-slot__actions">
    <a class="ifb-btn ifb-btn--whatsapp ifb-btn--sm${live ? '' : ' is-disabled'}" href="${esc(links.whatsapp)}" target="_blank" rel="noopener" data-ifb-share="whatsapp" data-campaign="${esc(campaign.id)}">WhatsApp</a>
    <a class="ifb-btn ifb-btn--sm${live && links.hasEmail ? '' : ' is-disabled'}" href="${esc(links.email)}" data-ifb-share="email" data-campaign="${esc(campaign.id)}">מייל</a>
    <button type="button" class="ifb-btn ifb-btn--sm" data-ifb-copy="${esc(campaign.id)}">העתק קישור</button>
    ${campaign.status === 'active'
      ? `<button type="button" class="ifb-btn ifb-btn--danger ifb-btn--sm" data-ifb-close="${esc(campaign.id)}">סגור</button>`
      : `<button type="button" class="ifb-btn ifb-btn--sm" data-ifb-reopen="${esc(campaign.id)}">פתח מחדש</button>`}
  </div>`;
}

function instructorAssignmentsHtml() {
  const all = ui.instructorAssignments || [];
  const filters = ui.instructorFilters;
  const search = filters.search.trim().toLowerCase();
  const rows = all.filter((row) => {
    if (filters.program && row.program_key !== filters.program) return false;
    const status = campaignUiStatus(row.campaign).key;
    if (filters.status === 'not_opened' && row.campaign) return false;
    if (filters.status === 'pending' && !['active', 'collecting', 'scheduled'].includes(status)) return false;
    if (filters.status === 'completed' && status !== 'completed') return false;
    if (filters.status === 'expired' && status !== 'expired') return false;
    if (search) {
      const hay = `${row.instructor_name || ''} ${programTitle(row.program_key)} ${row.instructor_emp_id || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const totalPrograms = all.length;
  const opened = all.filter((row) => row.campaign).length;
  const completed = all.filter((row) => row.campaign?.recipient?.status === 'completed').length;
  return `
    <section class="ifb-panel ifb-instructor-intro">
      <div>
        <h2>משובי מדריכים</h2>
        <p class="ifb-note">כל מדריך ממלא משוב אחד בלבד לכל תוכנית שבה הוא משובץ בשנת הפעילות — לא משוב נפרד לכל קבוצה.</p>
      </div>
      <div class="ifb-inline-stats">
        <span><strong>${totalPrograms}</strong> צירופי מדריך–תוכנית</span>
        <span><strong>${opened}</strong> נפתחו</span>
        <span><strong>${completed}</strong> הושלמו</span>
      </div>
    </section>
    <section class="ifb-filter-panel">
      <div class="ifb-filters ifb-filters--instructors">
        <label class="ifb-field ifb-field--search"><span>חיפוש מדריך</span><input type="search" data-i="search" value="${esc(filters.search)}" placeholder="שם מדריך…"></label>
        <label class="ifb-field"><span>תוכנית</span><select data-i="program">${optionList(ui.programs.map((p) => p.key), filters.program, 'כל התוכניות', programTitle)}</select></label>
        <label class="ifb-field"><span>סטטוס</span><select data-i="status">
          ${[['', 'הכל'], ['not_opened', 'טרם נפתח'], ['pending', 'ממתין למילוי'], ['completed', 'הושלם'], ['expired', 'פג תוקף']]
            .map(([v, l]) => `<option value="${v}"${v === filters.status ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-clear="instructors">ניקוי</button>
      </div>
    </section>
    <div class="ifb-list-head"><h2>מדריכים <span class="ifb-list-count">(${rows.length})</span></h2></div>
    ${rows.length ? `<div class="ifb-table-wrap">
      <table class="ifb-table ifb-instructor-table">
        <thead><tr><th>מדריך</th><th>תוכנית</th><th>שיבוצים</th><th>בתי ספר</th><th>תקופה</th><th>סטטוס</th><th>פעולות</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr data-instructor-feedback="${esc(instructorAssignmentKey(row))}">
            <td data-label="מדריך"><strong>${esc(row.instructor_name || row.instructor_emp_id)}</strong><span class="ifb-muted ifb-cell-sub">#${esc(row.instructor_emp_id)}</span></td>
            <td data-label="תוכנית">${esc(programTitle(row.program_key))}</td>
            <td data-label="שיבוצים" class="ifb-center"><strong>${Number(row.assignment_count) || 0}</strong></td>
            <td data-label="בתי ספר" class="ifb-center">${Number(row.school_count) || 0}</td>
            <td data-label="תקופה" class="ifb-nowrap">${fmtDate(row.first_start_date)}–${fmtDate(row.last_end_date)}</td>
            <td data-label="סטטוס">${tableStatusHtml(row.campaign)}</td>
            <td data-label="פעולות">${instructorCampaignActionsHtml(row)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : '<div class="ifb-empty"><p>לא נמצאו שיבוצי מדריכים התואמים לסינון.</p></div>'}
  `;
}

// ---------------------------------------------------------------------------
// Results dashboard
// ---------------------------------------------------------------------------

function resultsFilteredFacts() {
  return filterFacts(ui.facts || [], ui.results);
}

function resultsHtml() {
  const facts = ui.facts || [];
  const r = ui.results;
  const groups = ui.groups || [];
  const filtered = resultsFilteredFacts();
  const groupOptions = uniqueSorted(facts.map((f) => f.activity_row_id));
  const groupLabel = (rowId) => {
    const sample = facts.find((f) => f.activity_row_id === rowId) || groups.find((g) => g.row_id === rowId);
    return sample ? `${sample.school_name || sample.school} · ${sample.grade || ''} · ${programTitle(sample.program_key)}` : rowId;
  };
  return `
    <div class="ifb-filters" data-ifb-filters="results">
      <label class="ifb-field"><span>מתאריך</span><input type="date" data-r="from" value="${esc(r.from)}"></label>
      <label class="ifb-field"><span>עד תאריך</span><input type="date" data-r="to" value="${esc(r.to)}"></label>
      <label class="ifb-field"><span>תוכנית</span><select data-r="program">${optionList(ui.programs.map((p) => p.key), r.program, 'כל התוכניות', programTitle)}</select></label>
      <label class="ifb-field"><span>רשות</span><select data-r="authority">${optionList(uniqueSorted(facts.map((f) => f.authority_name)), r.authority, 'כל הרשויות')}</select></label>
      <label class="ifb-field"><span>בית ספר</span><select data-r="school">${optionList(uniqueSorted(facts.map((f) => f.school_name)), r.school, 'כל בתי הספר')}</select></label>
      <label class="ifb-field"><span>שכבה</span><select data-r="ageBand">${optionList(AGE_BANDS.map((b) => b.key), r.ageBand, 'כל השכבות', ageBandLabel)}</select></label>
      <label class="ifb-field"><span>קבוצה</span><select data-r="group">${optionList(groupOptions, r.group, 'כל הקבוצות', groupLabel)}</select></label>
      <label class="ifb-field"><span>מדריך</span><select data-r="instructor">${optionList(uniqueSorted(facts.map((f) => f.instructor_name)), r.instructor, 'כל המדריכים')}</select></label>
      <button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-clear="results">ניקוי</button>
    </div>
    <div class="ifb-section__head">
      <p class="ifb-muted">${new Set(filtered.map((f) => f.response_id)).size} משובים · ${new Set(filtered.map((f) => f.activity_row_id).filter(Boolean)).size} קבוצות · ${new Set(filtered.filter((f) => f.audience === 'instructor').map((f) => f.instructor_name).filter(Boolean)).size} מדריכים</p>
      ${exportButtonsHtml('results')}
    </div>
    ${filtered.length ? perspectivesHtml(filtered, 'results') : '<div class="ifb-empty"><p>אין עדיין תשובות התואמות לסינון.</p></div>'}`;
}

// ---------------------------------------------------------------------------
// Open answers
// ---------------------------------------------------------------------------

function answersHtml() {
  const a = ui.answers;
  const all = openAnswers(ui.facts || []);
  const search = a.search.trim().toLowerCase();
  const items = all.filter((item) =>
    (!a.program || item.program_key === a.program)
    && (!a.audience || item.audience === a.audience)
    && (!a.question || item.question_text === a.question)
    && (!a.school || item.school_name === a.school)
    && (!search || item.text.toLowerCase().includes(search)))
    .sort((x, y) => String(y.submitted_at).localeCompare(String(x.submitted_at)));
  return `
    <div class="ifb-filters" data-ifb-filters="answers">
      <label class="ifb-field ifb-field--search"><span>חיפוש בטקסט</span><input type="search" data-a="search" value="${esc(a.search)}"></label>
      <label class="ifb-field"><span>תוכנית</span><select data-a="program">${optionList(ui.programs.map((p) => p.key), a.program, 'כל התוכניות', programTitle)}</select></label>
      <label class="ifb-field"><span>קהל</span><select data-a="audience">${optionList(Object.keys(AUDIENCE_LABELS), a.audience, 'כל הקהלים', (k) => AUDIENCE_LABELS[k])}</select></label>
      <label class="ifb-field"><span>שאלה</span><select data-a="question">${optionList(uniqueSorted(all.map((x) => x.question_text)), a.question, 'כל השאלות')}</select></label>
      <label class="ifb-field"><span>בית ספר</span><select data-a="school">${optionList(uniqueSorted(all.map((x) => x.school_name)), a.school, 'כל בתי הספר')}</select></label>
    </div>
    <p class="ifb-muted">${items.length} תשובות · ניתוח AI (סיכום, נושאים, סנטימנט) ייתמך בהמשך – מבנה הנתונים כבר מוכן לכך.</p>
    ${openAnswersListHtml(items)}`;
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
  if (scope.startsWith('group:')) return ui.groupFacts.get(scope.slice(6)) || [];
  return resultsFilteredFacts();
}

function runExport(kind, scope) {
  const facts = exportFacts(scope);
  if (!facts.length) {
    showToast('אין נתונים לייצוא', 'info');
    return;
  }
  const raw = rawExportRows(facts, { programs: ui.programs, metrics: ui.metrics });
  const summary = summaryExportRows(threePerspectives(facts, ui.metrics), ui.metrics);
  const stamp = isoDay(Date.now());
  const base = scope.startsWith('group:')
    ? `משובים-${(facts[0]?.school_name || 'קבוצה').replace(/[\\/?%*:|"<>]/g, '_')}-${stamp}`
    : `משובים-${stamp}`;
  if (kind === 'raw') downloadBlob(new Blob([buildCsv(RAW_EXPORT_HEADERS, raw)], { type: 'text/csv;charset=utf-8' }), `${base}-raw.csv`);
  else if (kind === 'summary') downloadBlob(new Blob([buildCsv(SUMMARY_EXPORT_HEADERS, summary)], { type: 'text/csv;charset=utf-8' }), `${base}-summary.csv`);
  else {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const rawSheet = XLSX.utils.aoa_to_sheet([RAW_EXPORT_HEADERS, ...raw]);
    const summarySheet = XLSX.utils.aoa_to_sheet([SUMMARY_EXPORT_HEADERS, ...summary]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(wb, rawSheet, 'Raw data');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`);
  }
}

// ---------------------------------------------------------------------------
// Render + events
// ---------------------------------------------------------------------------

function viewHtml() {
  if (ui.error) return errorHtml(ui.error);
  if (ui.tab === 'templates') return renderTemplatesView(ui);
  if (ui.loading || !ui.groups || !ui.instructorAssignments || ((ui.tab === 'results' || ui.tab === 'answers') && !ui.facts)) return loadingHtml();
  if (ui.tab === 'overview' && ui.groupRowId) return groupViewHtml(findGroup(ui.groupRowId));
  if (ui.tab === 'instructors') return instructorAssignmentsHtml();
  if (ui.tab === 'results') return resultsHtml();
  if (ui.tab === 'answers') return answersHtml();
  return overviewHtml();
}

function paint(host) {
  if (!host.isConnected) return;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  const focusKey = active && host.contains(active)
    ? ['data-f', 'data-i', 'data-r', 'data-a'].map((attr) => active.getAttribute(attr) && `[${attr}="${active.getAttribute(attr)}"]`).find(Boolean)
    : null;
  host.innerHTML = shellHtml(viewHtml());
  if (focusKey) {
    const el = host.querySelector(focusKey);
    if (el) {
      el.focus();
      if (el.type === 'search') el.setSelectionRange?.(el.value.length, el.value.length);
    }
  }
  window.scrollTo({ top: scrollY });
  if (ui.tab === 'templates') bindTemplatesView(host, ui, () => paint(host));
}

async function load(host, { force = false } = {}) {
  ui.error = '';
  ui.loading = true;
  paint(host);
  try {
    await ensureDefinitions();
    if (ui.tab !== 'templates') {
      await Promise.all([ensureGroups(force), ensureInstructorAssignments(force)]);
    }
    if (ui.tab === 'results' || ui.tab === 'answers') await ensureFacts(force);
    if (ui.tab === 'overview' && ui.groupRowId) {
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
    paint(host);
  }
}

function campaignById(id) {
  for (const group of ui.groups || []) {
    const campaign = (group.campaigns || []).find((c) => c.id === id);
    if (campaign) return { group, instructorAssignment: null, campaign };
  }
  for (const row of ui.instructorAssignments || []) {
    if (row.campaign?.id === id) return { group: null, instructorAssignment: row, campaign: row.campaign };
  }
  return { group: null, instructorAssignment: null, campaign: null };
}

async function afterCampaignChange(host, rowId) {
  await refreshGroup(rowId);
  ui.facts = null;
  paint(host);
}

async function afterInstructorCampaignChange(host) {
  await ensureInstructorAssignments(true);
  ui.facts = null;
  paint(host);
}

async function handleClick(host, event) {
  const t = event.target;
  const tab = t.closest('[data-ifb-tab]');
  if (tab) {
    ui.tab = tab.dataset.ifbTab;
    if (ui.tab !== 'overview') ui.groupRowId = null;
    await load(host, { force: true });
    return;
  }
  if (t.closest('[data-ifb-retry]') || t.closest('[data-ifb-refresh]')) { await load(host, { force: true }); return; }
  const openGroup = t.closest('[data-ifb-open-group]');
  if (openGroup) {
    ui.groupRowId = openGroup.dataset.ifbOpenGroup;
    window.scrollTo({ top: 0 });
    await load(host);
    return;
  }
  const resultsGroup = t.closest('[data-ifb-results-group]');
  if (resultsGroup) {
    ui.groupRowId = resultsGroup.dataset.ifbResultsGroup;
    await load(host);
    host.querySelector('.ifb-angles')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (t.closest('[data-ifb-back]')) { ui.groupRowId = null; await load(host, { force: true }); return; }
  const unresolvedFilter = t.closest('[data-ifb-show-unresolved]');
  if (unresolvedFilter) {
    ui.filters.status = 'unresolved';
    paint(host);
    return;
  }
  const clear = t.closest('[data-ifb-clear]');
  if (clear) {
    const target = clear.dataset.ifbClear === 'overview'
      ? ui.filters
      : clear.dataset.ifbClear === 'instructors'
        ? ui.instructorFilters
        : ui.results;
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
  const drill = t.closest('[data-ifb-drill]');
  if (drill) {
    const scope = drill.closest('[data-ifb-scope]')?.dataset.ifbScope || 'results';
    const who = drill.closest('[data-ifb-who]')?.dataset.ifbWho || 'students';
    const key = `${scope}|${who}|${drill.dataset.ifbDrill}`;
    ui.results.drill = ui.results.drill === key ? '' : key;
    paint(host);
    return;
  }
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
  const auto = t.closest('[data-ifb-program-auto]');
  const exclude = t.closest('[data-ifb-program-exclude]');
  if (auto || exclude) {
    const rowId = (auto || exclude).closest('[data-ifb-set-program]')?.dataset.ifbSetProgram;
    if (!rowId) return;
    if (exclude && !window.confirm('להסתיר את הפעילות ממודול המשובים? ניתן להחזיר דרך הסינון "הוסתרו".')) return;
    await saveProgram(host, rowId, null, { excluded: Boolean(exclude) });
    return;
  }
  const exp = t.closest('[data-ifb-export]');
  if (exp) { runExport(exp.dataset.ifbExport, exp.dataset.scope); }
}

async function saveProgram(host, rowId, programKey, options = {}) {
  try {
    await setActivityProgram(rowId, programKey, options);
    showToast(options.excluded ? 'הפעילות הוסתרה ממודול המשובים' : programKey ? 'התוכנית נשמרה' : 'הוחזר זיהוי אוטומטי');
    await refreshGroup(rowId);
    if (options.applyToName) await ensureGroups(true);
    paint(host);
  } catch (error) {
    showToast(translateFeedbackError(error), 'error', 5000);
  }
}

async function handleSubmit(host, event) {
  const form = event.target;
  if (form.matches('[data-ifb-set-program]')) {
    event.preventDefault();
    const data = new FormData(form);
    const program = String(data.get('program') || '');
    if (!program) return;
    await saveProgram(host, form.dataset.ifbSetProgram, program, { applyToName: data.get('apply_to_name') === 'on' });
    return;
  }
  if (form.matches('[data-ifb-instructor-open-form]')) {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await openInstructorCampaign(form.dataset.emp, form.dataset.program, form.dataset.year, {
        opensAt: openingIso(String(data.get('opens') || '')),
        expiresAt: expiryIso(String(data.get('expires') || ''))
      });
      ui.instructorOpenForms.delete(form.dataset.key);
      showToast('נוצר משוב חד־פעמי למדריך עבור התוכנית');
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

function handleFilterInput(host, event) {
  const el = event.target;
  if (el.matches('[data-ifb-year]')) {
    ui.year = el.value;
    ui.groupRowId = null;
    ui.groupFacts.clear();
    ui.instructorAssignments = null;
    ui.instructorAssignmentsYear = null;
    ui.instructorOpenForms.clear();
    load(host);
    return;
  }
  if (el.matches('[data-ifb-show-all]')) { ui.showAll = el.checked; paint(host); return; }
  const map = [['f', ui.filters], ['i', ui.instructorFilters], ['r', ui.results], ['a', ui.answers]];
  for (const [attr, target] of map) {
    const key = el.getAttribute(`data-${attr}`);
    if (key) {
      target[key] = el.value;
      paint(host);
      return;
    }
  }
}

function mount(host, state) {
  if (!isAdmin(state)) {
    host.innerHTML = '<div class="ifb-empty ifb-empty--error" role="alert"><p>מודול המשובים זמין לאדמין בלבד.</p></div>';
    return;
  }
  const entry = state.impactFeedback;
  if (entry?.groupRowId) {
    ui.tab = 'overview';
    ui.groupRowId = entry.groupRowId;
    if (entry.academicYear && YEAR_OPTIONS.includes(entry.academicYear)) ui.year = entry.academicYear;
    state.impactFeedback = null;
  }
  host.addEventListener('click', (event) => { handleClick(host, event); });
  host.addEventListener('submit', (event) => { handleSubmit(host, event); });
  host.addEventListener('change', (event) => {
    if (event.target.matches('input[type="search"]')) return;
    if (event.target.closest('[data-ifb-templates]')) return;
    handleFilterInput(host, event);
  });
  host.addEventListener('input', (event) => {
    if (event.target.matches('input[type="search"]')) handleFilterInput(host, event);
  });
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
