/**
 * "משובים והערכת השפעה" — admin-only module.
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
  fetchMetrics,
  fetchPrograms,
  openCampaign,
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
  groups: null,
  groupsYear: null,
  metrics: [],
  programs: [],
  facts: null,
  factsYear: null,
  groupFacts: new Map(),
  openForms: new Set(),
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
  { key: 'overview', label: 'סקירה וקבוצות' },
  { key: 'results', label: 'תוצאות והשפעה' },
  { key: 'answers', label: 'תשובות פתוחות' },
  { key: 'templates', label: 'הגדרות · תבניות ושאלות' }
];

function shellHtml(inner) {
  return `
    <div class="ifb-admin__head">
      <div>
        <h1 class="ifb-admin__title">משובים והערכת השפעה</h1>
        <p class="ifb-admin__sub">מדידת למידה, התקדמות והשפעה של התוכניות – תלמידים, צוות חינוכי ומדריכים</p>
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

function kpiHtml(groups) {
  const k = dashboardKpis(groups);
  const items = [
    ['קבוצות עם משובים', k.withFeedback, `מתוך ${groups.length} קבוצות בתוכניות`],
    ['משובי פתיחה פעילים', k.activePre, 'תלמידים'],
    ['משובי סיום פעילים', k.activePost, 'תלמידים'],
    ['ממתינים למדריך', k.pendingInstructor, 'קישורים פעילים שטרם מולאו'],
    ['ממתינים לאיש קשר', k.pendingContact, 'קישורים פעילים שטרם מולאו'],
    ['שיעור מענה', k.responseRate === null ? '—' : `${k.responseRate}%`, `צוות ומדריכים · ${k.studentResponses} תשובות תלמידים`]
  ];
  return `<div class="ifb-kpis">${items.map(([label, value, hint]) => `
    <div class="ifb-kpi"><span class="ifb-kpi__label">${esc(label)}</span><strong class="ifb-kpi__value">${esc(String(value))}</strong><span class="ifb-kpi__hint">${esc(hint)}</span></div>`).join('')}</div>`;
}

function overviewFiltersHtml(groups) {
  const f = ui.filters;
  return `
    <div class="ifb-filters" data-ifb-filters="overview">
      <label class="ifb-field ifb-field--search"><span>חיפוש</span><input type="search" data-f="search" value="${esc(f.search)}" placeholder="בית ספר, רשות, מדריך…"></label>
      <label class="ifb-field"><span>תוכנית</span><select data-f="program">${optionList(ui.programs.map((p) => p.key), f.program, 'כל התוכניות', programTitle)}</select></label>
      <label class="ifb-field"><span>רשות</span><select data-f="authority">${optionList(uniqueSorted(groups.map((g) => g.authority)), f.authority, 'כל הרשויות')}</select></label>
      <label class="ifb-field"><span>בית ספר</span><select data-f="school">${optionList(uniqueSorted(groups.map((g) => g.school)), f.school, 'כל בתי הספר')}</select></label>
      <label class="ifb-field"><span>מדריך</span><select data-f="instructor">${optionList(uniqueSorted(groups.map((g) => g.instructor_name)), f.instructor, 'כל המדריכים')}</select></label>
      <label class="ifb-field"><span>שכבה</span><select data-f="ageBand">${optionList(AGE_BANDS.map((b) => b.key), f.ageBand, 'כל השכבות', ageBandLabel)}</select></label>
      <label class="ifb-field"><span>התחלה מ־</span><input type="date" data-f="from" value="${esc(f.from)}"></label>
      <label class="ifb-field"><span>עד</span><input type="date" data-f="to" value="${esc(f.to)}"></label>
      <label class="ifb-field"><span>סטטוס</span><select data-f="status">
        ${[['', 'הכל'], ['has_feedback', 'יש משובים'], ['no_feedback', 'ללא משובים'], ['any_live', 'משוב פעיל'], ['pending_instructor', 'ממתין למדריך'], ['pending_contact', 'ממתין לאיש קשר'], ['expired', 'פג תוקף'], ['completed_all', 'הושלם (4 משובים)']]
          .map(([v, l]) => `<option value="${v}"${v === f.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select></label>
      <button type="button" class="ifb-btn ifb-btn--ghost" data-ifb-clear="overview">ניקוי</button>
    </div>`;
}

function resultsCellHtml(group) {
  const pre = slotCampaign(group, SLOTS[0]);
  const post = slotCampaign(group, SLOTS[1]);
  const nPre = Number(pre?.responses) || 0;
  const nPost = Number(post?.responses) || 0;
  const personalDone = (group.campaigns || []).filter((c) => c.audience !== 'student' && c.recipient?.status === 'completed').length;
  if (!nPre && !nPost && !personalDone) return '<span class="ifb-muted">—</span>';
  return `<button type="button" class="ifb-link" data-ifb-results-group="${esc(group.row_id)}">פתיחה ${nPre} · סיום ${nPost}${personalDone ? ` · אישי ${personalDone}/2` : ''}</button>`;
}

function overviewTableHtml(groups) {
  if (!groups.length) {
    return `<div class="ifb-empty"><p>לא נמצאו קבוצות התואמות לסינון.</p><p class="ifb-muted">המודול מציג פעילויות של 8 התוכניות לפי שם הפעילות בשנת הפעילות שנבחרה.</p></div>`;
  }
  const rows = groups.map((g) => `
    <tr data-row="${esc(g.row_id)}">
      <td data-label="בית ספר"><strong>${esc(g.school || '—')}</strong>${g.class_group ? `<span class="ifb-muted"> · ${esc(g.class_group)}</span>` : ''}</td>
      <td data-label="רשות">${esc(g.authority || '—')}</td>
      <td data-label="תוכנית">${esc(programTitle(g.program_key))}</td>
      <td data-label="שכבה">${esc(g.grade || ageBandLabel(g.age_band) || '—')}</td>
      <td data-label="מדריך">${esc(g.instructor_name || '—')}</td>
      <td data-label="התחלה">${fmtDate(g.start_date)}</td>
      <td data-label="סיום">${fmtDate(g.end_date)}</td>
      ${SLOTS.map((slot) => `<td data-label="${esc(slot.label)}">${statusChip(slotCampaign(g, slot))}</td>`).join('')}
      <td data-label="תוצאות">${resultsCellHtml(g)}</td>
      <td data-label="פעולות"><button type="button" class="ifb-btn ifb-btn--primary ifb-btn--sm" data-ifb-open-group="${esc(g.row_id)}">משובים</button></td>
    </tr>`).join('');
  return `
    <div class="ifb-table-wrap">
      <table class="ifb-table">
        <thead><tr>
          <th>בית ספר</th><th>רשות</th><th>תוכנית</th><th>שכבה</th><th>מדריך</th><th>התחלה</th><th>סיום</th>
          ${SLOTS.map((s) => `<th>${esc(s.label)}</th>`).join('')}
          <th>תוצאות</th><th>פעולות</th>
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
  return `
    ${kpiHtml(groups)}
    ${overviewFiltersHtml(groups)}
    <div class="ifb-toolbar">
      <span class="ifb-muted">${filtered.length} קבוצות</span>
      <label class="ifb-check"><input type="checkbox" data-ifb-show-all${ui.showAll ? ' checked' : ''}> הצגת כל קבוצות התוכניות (גם ללא משובים)</label>
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

function alignmentHtml(perspectives) {
  const impact = ui.metrics.filter((m) => m.kind === 'impact');
  const rows = impact.map((m) => {
    const s = perspectives.students.post.byMetric[m.key]?.score ?? null;
    const st = perspectives.staff.byMetric[m.key]?.score ?? null;
    const ins = perspectives.instructor.byMetric[m.key]?.score ?? null;
    if (s === null && st === null && ins === null) return '';
    const gap = perspectiveGap([s, st, ins]);
    return `<tr><td data-label="מדד"><strong>${esc(m.label)}</strong></td><td data-label="קול התלמידים">${s ?? '—'}</td><td data-label="צוות חינוכי">${st ?? '—'}</td><td data-label="מדריך">${ins ?? '—'}</td>
      <td data-label="התאמה">${gap ? `<span class="ifb-chip ifb-chip--${gap.key === 'aligned' ? 'success' : gap.key === 'partial' ? 'info' : 'warning'}">${esc(gap.label)} (${gap.gap})</span>` : '<span class="ifb-muted">אין מספיק זוויות</span>'}</td></tr>`;
  }).join('');
  if (!rows) return '';
  return `<section class="ifb-panel"><h3>האם שלוש הזוויות מצביעות על אותה מגמה?</h3>
    <p class="ifb-note">ציוני 0–100 של כל אוכלוסייה בנפרד (תלמידים – משוב סיום). אין ממוצע משולב בין האוכלוסיות.</p>
    <div class="ifb-table-wrap"><table class="ifb-table ifb-table--compact"><thead><tr><th>מדד</th><th>קול התלמידים</th><th>צוות חינוכי</th><th>מדריך</th><th>התאמה</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function perspectivesHtml(facts, scopeKey) {
  const perspectives = threePerspectives(facts, ui.metrics);
  const impactKeys = ui.metrics.filter((m) => m.kind === 'impact').map((m) => m.key);
  const programKeys = ui.metrics.filter((m) => m.kind === 'program').map((m) => m.key);
  const drill = ui.results.drill && ui.results.drill.startsWith(`${scopeKey}|`) ? ui.results.drill.split('|') : [];
  const drillFor = (who, population) => (drill[1] === who ? drillHtml(population, drill[2]) : '');
  return `
    <div class="ifb-angles" data-ifb-scope="${esc(scopeKey)}">
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
      <section class="ifb-panel ifb-angle ifb-angle--instructor" data-ifb-who="instructor">
        <h3>🧑‍🏫 הערכת המדריך</h3>
        ${metricTilesHtml(perspectives.instructor, [...programKeys, ...impactKeys], 'טרם התקבל משוב מהמדריך.')}
        ${drillFor('instructor', perspectives.instructor)}
        ${singleSelectHtml(factsFor(facts, 'instructor'))}
      </section>
    </div>
    ${alignmentHtml(perspectives)}`;
}

function openAnswersListHtml(items, { showContext = true } = {}) {
  if (!items.length) return '<p class="ifb-muted">אין תשובות פתוחות.</p>';
  return `<ul class="ifb-answers">${items.map((a) => `
    <li class="ifb-answer">
      <p class="ifb-answer__text">${esc(a.text)}</p>
      <p class="ifb-answer__meta">
        <span class="ifb-chip ifb-chip--muted">${esc(AUDIENCE_LABELS[a.audience] || '')}${a.audience === 'student' ? ` · ${a.stage === 'pre' ? 'פתיחה' : 'סיום'}` : ''}</span>
        <span>${esc(a.question_text)}</span>
        ${showContext ? `<span>${esc(programTitle(a.program_key))} · ${esc(a.school_name)}${a.grade ? ` · ${esc(a.grade)}` : ''}</span>` : ''}
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
        <p class="ifb-kicker">${esc(programTitle(group.program_key))}</p>
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
    <div class="ifb-slots">${SLOTS.map((slot) => slotCardHtml(group, slot)).join('')}</div>
    <section class="ifb-section">
      <div class="ifb-section__head"><h2>שלוש נקודות מבט</h2>${facts ? exportButtonsHtml(`group:${group.row_id}`) : ''}</div>
      ${facts ? perspectivesHtml(facts, `group:${group.row_id}`) : loadingHtml('טוען תוצאות…')}
    </section>
    ${facts ? `<section class="ifb-section"><h2>תשובות פתוחות</h2>${openAnswersListHtml(openAnswers(facts), { showContext: false })}</section>` : ''}`;
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
      <p class="ifb-muted">${new Set(filtered.map((f) => f.response_id)).size} משובים · ${new Set(filtered.map((f) => f.activity_row_id)).size} קבוצות</p>
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
    : `משובים-והערכת-השפעה-${stamp}`;
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
  if (ui.loading || !ui.groups || ((ui.tab === 'results' || ui.tab === 'answers') && !ui.facts)) return loadingHtml();
  if (ui.tab === 'overview' && ui.groupRowId) return groupViewHtml(findGroup(ui.groupRowId));
  if (ui.tab === 'results') return resultsHtml();
  if (ui.tab === 'answers') return answersHtml();
  return overviewHtml();
}

function paint(host) {
  if (!host.isConnected) return;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  const focusKey = active && host.contains(active)
    ? ['data-f', 'data-r', 'data-a'].map((attr) => active.getAttribute(attr) && `[${attr}="${active.getAttribute(attr)}"]`).find(Boolean)
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
    if (ui.tab !== 'templates') await ensureGroups(force);
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
    if (campaign) return { group, campaign };
  }
  return { group: null, campaign: null };
}

async function afterCampaignChange(host, rowId) {
  await refreshGroup(rowId);
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
  const clear = t.closest('[data-ifb-clear]');
  if (clear) {
    const target = clear.dataset.ifbClear === 'overview' ? ui.filters : ui.results;
    for (const key of Object.keys(target)) target[key] = '';
    paint(host);
    return;
  }
  const showOpen = t.closest('[data-ifb-show-open]');
  if (showOpen) { ui.openForms.add(showOpen.dataset.ifbShowOpen); paint(host); return; }
  const cancelOpen = t.closest('[data-ifb-cancel-open]');
  if (cancelOpen) { ui.openForms.delete(cancelOpen.dataset.ifbCancelOpen); paint(host); return; }
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
    const { group } = campaignById(id);
    if (close && !window.confirm('לסגור את המשוב? לא יתקבלו תשובות נוספות (ניתן לפתוח מחדש).')) return;
    try {
      await updateCampaign(id, close ? 'close' : 'reopen');
      showToast(close ? 'המשוב נסגר' : 'המשוב נפתח מחדש');
      await afterCampaignChange(host, group.row_id);
    } catch (error) {
      showToast(translateFeedbackError(error), 'error', 5000);
    }
    return;
  }
  const exp = t.closest('[data-ifb-export]');
  if (exp) { runExport(exp.dataset.ifbExport, exp.dataset.scope); }
}

async function handleSubmit(host, event) {
  const form = event.target;
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
    load(host);
    return;
  }
  if (el.matches('[data-ifb-show-all]')) { ui.showAll = el.checked; paint(host); return; }
  const map = [['f', ui.filters], ['r', ui.results], ['a', ui.answers]];
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
