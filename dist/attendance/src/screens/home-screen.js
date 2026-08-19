/**
 * home-screen.js  —  Dashboard (summary only, no report list)
 * Shows month navigator, 4 compact KPI cards, and a compact action strip.
 */

import { createIcon } from '../components/icon.js';
import { getMonthRecords, calcMonthSummary, getMonthApproval, submitMonth } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel, shouldShowSubmitReminder } from '../services/month-gate.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';

const STATUS_MAP = {
  open:                { label: 'פתוח לדיווח',                         tone: 'neutral'  },
  submitted:           { label: 'אושר על ידי העובד / בבקרת מנהל',     tone: 'warning'  },
  locked:              { label: 'אושר על ידי המנהל',                   tone: 'success'  },
  reopened:            { label: 'הוחזר לתיקון — פתוח לדיווח',          tone: 'neutral'  },
  approved_for_payroll:{ label: 'אושר סופית',                          tone: 'success'  }
};

export function renderHomeScreen(container, {
  instructor = {},
  year,
  month,
  onNewReport,
  onMyReports,
  onPrevMonth,
  onNextMonth,
  onLogout
} = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-home';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-home__inner';

  // ── Mobile header: identity + logout ─────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'av2-home__header';

  const identity = document.createElement('div');
  identity.className = 'av2-home__identity';
  const identityText = document.createElement('div');
  identityText.className = 'av2-home__identity-text';
  const nameEl = document.createElement('p');
  nameEl.className = 'av2-home__name';
  nameEl.textContent = instructor.name || '';
  const empEl = document.createElement('p');
  empEl.className = 'av2-home__emp';
  empEl.textContent = instructor.empId ? `מס' עובד ${instructor.empId}` : '';
  identityText.append(nameEl, empEl);
  identity.append(createIcon('user', { size: 16 }), identityText);

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'av2-btn av2-btn--icon';
  logoutBtn.setAttribute('aria-label', 'התנתקות');
  logoutBtn.append(createIcon('log-out'));
  logoutBtn.addEventListener('click', () => onLogout?.());

  header.append(identity, logoutBtn);

  // ── Title band ────────────────────────────────────────────────────────────
  const titleBand = document.createElement('div');
  titleBand.className = 'av2-home__title-band';
  const pageTitleEl = document.createElement('h1');
  pageTitleEl.className = 'av2-home__page-title';
  pageTitleEl.textContent = 'דיווחי נוכחות';
  const statusChip = document.createElement('span');
  statusChip.className = 'av2-home__status-chip';
  statusChip.hidden = true;
  titleBand.append(pageTitleEl, statusChip);

  // ── Month navigator + primary action ──────────────────────────────────────
  const monthNav = buildMonthNav(year, month, onPrevMonth, onNextMonth);

  const newReportBtn = document.createElement('button');
  newReportBtn.type = 'button';
  newReportBtn.className = 'av2-btn av2-btn--primary av2-home__primary';
  const newReportLabel = document.createElement('span');
  newReportLabel.textContent = 'הוספת דיווח';
  newReportBtn.append(createIcon('plus'), newReportLabel);
  newReportBtn.addEventListener('click', () => onNewReport?.());

  const actionRow = document.createElement('div');
  actionRow.className = 'av2-home__action-row';
  actionRow.append(monthNav, newReportBtn);

  // ── KPI skeleton ──────────────────────────────────────────────────────────
  const statsEl = document.createElement('div');
  statsEl.className = 'av2-stats-grid';
  statsEl.innerHTML = buildStatSkeletons();

  // ── Status area (approval card + action strip) ────────────────────────────
  const statusArea = document.createElement('div');
  statusArea.className = 'av2-home__status-area';

  const actionStripEl = document.createElement('div');
  actionStripEl.className = 'av2-home__action-strip';
  actionStripEl.innerHTML = '<p class="av2-home__strip-loading">טוען…</p>';
  statusArea.append(actionStripEl);

  inner.append(header, titleBand, actionRow, statsEl, statusArea);
  wrap.append(inner);
  container.append(wrap);

  loadAndRender({ instructor, year, month, statsEl, actionStripEl, newReportBtn, statusChip, onMyReports });
}

async function loadAndRender({ instructor, year, month, statsEl, actionStripEl, newReportBtn, statusChip, onMyReports }) {
  const monthKey = getMonthKey(year, month);
  try {
    const [records, approval] = await Promise.all([
      getMonthRecords(instructor.empId, year, month),
      getMonthApproval(instructor.empId, monthKey)
    ]);

    const summary  = calcMonthSummary(records);
    const editable = canEditMonth(year, month, approval);

    // KPI cards
    statsEl.innerHTML = '';
    statsEl.append(
      buildStat(summary.recordsCount,                     'דיווחים',  'list'),
      buildStat(summary.totalHours.toFixed(2),            'שעות',     'clock'),
      buildStat(summary.totalKm.toFixed(0) + '\u00a0ק"מ','נסיעות',   'map-pin'),
      buildStat('₪' + summary.totalExpenses.toFixed(0),  'הוצאות',   'dollar-sign')
    );

    // Disable add-report when month is locked
    newReportBtn.disabled = !editable;
    if (!editable) {
      newReportBtn.title   = editBlockReason(year, month, approval);
      newReportBtn.style.opacity = '0.5';
    }

    // Status chip (title band)
    const { label: statusLabel, tone } = STATUS_MAP[approval?.status ?? 'open'] || STATUS_MAP.open;
    statusChip.hidden = false;
    statusChip.textContent = statusLabel;
    statusChip.dataset.tone = tone;

    // Action strip
    actionStripEl.innerHTML = '';
    if (shouldShowSubmitReminder(year, month, approval)) {
      actionStripEl.append(buildSubmitReminderBanner({ year, month }));
    }
    actionStripEl.append(
      buildActionStrip({ approval, year, month, instructor, records, summary, editable, onMyReports })
    );

  } catch (err) {
    statsEl.innerHTML = `<p class="av2-error">${err.message}</p>`;
    actionStripEl.innerHTML = '';
  }
}

// ── Compact action strip (no duplicated stats) ────────────────────────────────

function buildActionStrip({ approval, year, month, instructor, records, summary, editable, onMyReports }) {
  const strip = document.createElement('div');
  strip.className = 'av2-home__action-strip';

  const status = approval?.status ?? 'open';
  const { label: statusLabel, tone } = STATUS_MAP[status] || STATUS_MAP.open;

  const badge = document.createElement('span');
  badge.className = `av2-badge av2-badge--${tone}`;
  badge.textContent = statusLabel;
  strip.append(badge);

  // "View all" link
  const viewLink = document.createElement('button');
  viewLink.type = 'button';
  viewLink.className = 'av2-btn av2-btn--link av2-home__view-all';
  viewLink.textContent = 'לכל הדיווחים ←';
  viewLink.addEventListener('click', () => onMyReports?.());
  strip.append(viewLink);

  const actions = document.createElement('div');
  actions.className = 'av2-home__strip-actions';

  // Excel button
  if (records.length > 0) {
    const xlBtn = document.createElement('button');
    xlBtn.type = 'button';
    xlBtn.className = 'av2-btn av2-btn--secondary av2-home__excel-btn';
    xlBtn.append(createIcon('download', { size: 14 }));
    const xlLabel = document.createElement('span');
    xlLabel.textContent = 'Excel';
    xlBtn.append(xlLabel);
    xlBtn.addEventListener('click', () => exportMonthToExcel(records, instructor, year, month));
    actions.append(xlBtn);
  }

  // Submit button
  if ((status === 'open' || status === 'reopened') && editable && records.length > 0) {
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'av2-btn av2-btn--primary av2-home__month-submit';
    const submitLabel = document.createElement('span');
    submitLabel.textContent = status === 'reopened' ? 'הגשה מחדש' : 'סיום ואישור';
    submitBtn.append(createIcon('check-circle', { size: 14 }), submitLabel);
    submitBtn.addEventListener('click', () => handleSubmit({ submitBtn, instructor, year, month, records, strip }));
    actions.append(submitBtn);
  }

  // Status messages for non-editable states
  if (status === 'submitted' && approval?.submitted_at) {
    const meta = document.createElement('span');
    meta.className = 'av2-home__strip-meta';
    const byName = String(approval?.submitted_by_name || instructor?.name || '').trim();
    meta.textContent = `✓ הוגש${byName ? ` על ידי ${byName}` : ''} ב-${new Date(approval.submitted_at).toLocaleDateString('he-IL')}`;
    actions.append(meta);
  } else if (status === 'locked') {
    const meta = document.createElement('span');
    meta.className = 'av2-home__strip-meta';
    const when = approval?.manager_approved_at
      ? ` ב-${new Date(approval.manager_approved_at).toLocaleDateString('he-IL')}`
      : '';
    const who = String(approval?.manager_approved_by_name || '').trim();
    meta.textContent = `✓ אושר על ידי המנהל${who ? ` (${who})` : ''}${when}`;
    actions.append(meta);
  } else if (status === 'approved_for_payroll') {
    const meta = document.createElement('span');
    meta.className = 'av2-home__strip-meta';
    meta.textContent = `✓ אושר סופית לשכר`;
    actions.append(meta);
  } else if (!editable && (status === 'open' || status === 'reopened')) {
    const meta = document.createElement('span');
    meta.className = 'av2-home__strip-meta av2-home__strip-meta--muted';
    meta.textContent = editBlockReason(year, month, approval);
    actions.append(meta);
  }

  strip.append(actions);
  return strip;
}

async function handleSubmit({ submitBtn, instructor, year, month, records, strip }) {
  if (!records.length) return;
  const confirmed = confirm(
    `להגיש את דיווח ${formatMonthLabel(year, month)}?\n` +
    `יש ${records.length} רשומות. לאחר ההגשה לא ניתן יהיה לערוך עד אישור מנהל.`
  );
  if (!confirmed) return;

  submitBtn.disabled = true;
  const submitLabel = submitBtn.querySelector('span');
  if (submitLabel) submitLabel.textContent = 'מגיש…';
  try {
    await submitMonth(instructor.empId, getMonthKey(year, month), instructor?.name || '');
    const badge = strip.querySelector('.av2-badge');
    if (badge) {
      badge.className = 'av2-badge av2-badge--warning';
      badge.textContent = 'אושר על ידי העובד / בבקרת מנהל';
    }
    submitBtn.remove();
    const meta = document.createElement('span');
    meta.className = 'av2-home__strip-meta';
    meta.textContent = `✓ הוגש בהצלחה ב-${new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`;
    const actions = strip.querySelector('.av2-home__strip-actions');
    if (actions) actions.append(meta);
  } catch (err) {
    submitBtn.disabled = false;
    if (submitLabel) submitLabel.textContent = 'סיום ואישור';
    alert(`שגיאה: ${err.message}`);
  }
}

function buildSubmitReminderBanner({ year, month }) {
  const banner = document.createElement('div');
  banner.className = 'av2-submit-reminder';

  const icon = document.createElement('span');
  icon.className = 'av2-submit-reminder__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⏰';

  const body = document.createElement('div');
  body.className = 'av2-submit-reminder__body';

  const title = document.createElement('p');
  title.className = 'av2-submit-reminder__title';
  title.textContent = 'תזכורת: הגש את הדיווח החודשי';

  const text = document.createElement('p');
  text.className = 'av2-submit-reminder__text';
  text.textContent = `נותרו ימים ספורים לסיום ${formatMonthLabel(year, month)}. יש לסיים ולהגיש.`;

  body.append(title, text);
  banner.append(icon, body);
  return banner;
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildMonthNav(year, month, onPrev, onNext) {
  const nav = document.createElement('div');
  nav.className = 'av2-month-nav';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'av2-btn av2-btn--icon av2-month-nav__btn';
  prevBtn.setAttribute('aria-label', 'חודש קודם');
  prevBtn.append(createIcon('chevron-right'));
  prevBtn.addEventListener('click', () => onPrev?.());

  const label = document.createElement('span');
  label.className = 'av2-month-nav__label';
  label.textContent = formatMonthLabel(year, month);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'av2-btn av2-btn--icon av2-month-nav__btn';
  nextBtn.setAttribute('aria-label', 'חודש הבא');
  const now = new Date();
  if (year >= now.getFullYear() && month >= now.getMonth() + 1) {
    nextBtn.disabled = true;
    nextBtn.style.opacity = '0.3';
  }
  nextBtn.append(createIcon('chevron-left'));
  nextBtn.addEventListener('click', () => onNext?.());

  nav.append(prevBtn, label, nextBtn);
  return nav;
}

function buildStatSkeletons() {
  return Array(4).fill(0).map(() =>
    `<div class="av2-stat-card av2-stat-card--skeleton"></div>`
  ).join('');
}

function buildStat(value, label, iconName) {
  const card = document.createElement('div');
  card.className = 'av2-stat-card';
  const ico = createIcon(iconName, { size: 20 });
  ico.style.color = 'var(--av2-color-accent)';
  const val = document.createElement('p');
  val.className = 'av2-stat-card__value';
  val.textContent = value != null ? String(value) : '–';
  const lab = document.createElement('p');
  lab.className = 'av2-stat-card__label';
  lab.textContent = label;
  card.append(ico, val, lab);
  return card;
}
