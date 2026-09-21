/**
 * home-screen.js  —  Dashboard (summary only, no report list)
 * Shows month navigator, instructor-only monthly totals, and a compact action strip.
 */

import { createIcon } from '../components/icon.js';
import { getMonthRecords, getMonthApproval, submitMonth, sourceAttendanceRecords, reconcileTravelCompensation } from '../services/attendance.service.js';
import { canEditMonth, getMonthKey, formatMonthLabel } from '../services/month-gate.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';
import { distinctAttendanceWorkDays } from '../components/report-summary-row.js';
import { formatDurationHours, isCancellationRecord } from '../components/monthly-report-summary.js';
import { openSubmitConfirmationDialog } from '../submit-confirmation-dialog.js';

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
  onEditReport,
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
  identity.append(createIcon('user-round', { size: 16 }), identityText);

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
  titleBand.append(pageTitleEl);

  // ── Month navigator + primary action ──────────────────────────────────────
  const monthNav = buildMonthNav(year, month, onPrevMonth, onNextMonth);

  const actionRow = document.createElement('div');
  actionRow.className = 'av2-home__action-row';
  actionRow.append(monthNav);

  // ── KPI skeleton ──────────────────────────────────────────────────────────
  const statsEl = document.createElement('div');
  statsEl.className = 'av2-stats-grid';
  statsEl.innerHTML = buildStatSkeletons(9);

  // ── Status area (approval card + action strip) ────────────────────────────
  const statusArea = document.createElement('div');
  statusArea.className = 'av2-home__status-area';

  const actionStripEl = document.createElement('div');
  actionStripEl.className = 'av2-home__status-mount';
  actionStripEl.innerHTML = '<p class="av2-home__strip-loading">טוען…</p>';
  statusArea.append(actionStripEl);

  inner.append(header, titleBand, actionRow, statsEl, statusArea);
  wrap.append(inner);
  container.append(wrap);

  loadAndRender({ instructor, year, month, statsEl, actionStripEl, onMyReports });
}

async function loadAndRender({ instructor, year, month, statsEl, actionStripEl, onMyReports }) {
  const monthKey = getMonthKey(year, month);
  try {
    const [records, approval] = await Promise.all([
      getMonthRecords(instructor.empId, year, month),
      getMonthApproval(instructor.empId, monthKey)
    ]);

    const sourceRecords = sourceAttendanceRecords(records);
    const editable = canEditMonth(year, month, approval);

    // Instructor-only monthly totals. No individual records are shown on Home.
    statsEl.innerHTML = '';
    const homeStats = buildHomeSummaryStats(records);
    statsEl.hidden = homeStats.length === 0;
    homeStats.forEach((item) => {
      statsEl.append(buildStat(item.value, item.label, item.icon));
    });

    // Action strip
    actionStripEl.innerHTML = '';
    actionStripEl.append(
      buildActionStrip({ approval, year, month, instructor, records, sourceRecords, editable, onMyReports })
    );

  } catch (err) {
    statsEl.innerHTML = `<p class="av2-error">${err.message}</p>`;
    actionStripEl.innerHTML = '';
  }
}

// ── Compact action strip (no duplicated stats) ────────────────────────────────

function buildActionStrip({ approval, year, month, instructor, records, sourceRecords, editable, onMyReports }) {
  const strip = document.createElement('div');
  strip.className = 'av2-home__action-strip';

  const status = approval?.status ?? 'open';
  const { label: statusLabel, tone } = STATUS_MAP[status] || STATUS_MAP.open;

  const heading = document.createElement('strong');
  heading.className = 'av2-home__reports-heading';
  heading.textContent = 'הדיווחים שלי';
  strip.append(heading);

  const badge = document.createElement('span');
  badge.className = `av2-badge av2-badge--${tone} av2-home__report-status`;
  badge.setAttribute('role', 'status');
  badge.textContent = statusLabel;
  strip.append(badge);

  const actions = document.createElement('div');
  actions.className = 'av2-home__strip-actions';

  // View all reports — secondary action, same geometry as the other action buttons.
  const viewLink = document.createElement('button');
  viewLink.type = 'button';
  viewLink.className = 'av2-btn av2-btn--secondary av2-home__action-btn av2-home__view-all';
  viewLink.append(createIcon('clipboard-list', { size: 14 }));
  const viewLabel = document.createElement('span');
  viewLabel.textContent = 'לכל הדיווחים';
  viewLink.append(viewLabel);
  viewLink.addEventListener('click', () => onMyReports?.());
  actions.append(viewLink);

  // Excel button
  if (sourceRecords.length > 0) {
    const xlBtn = document.createElement('button');
    xlBtn.type = 'button';
    xlBtn.className = 'av2-btn av2-btn--secondary av2-home__action-btn av2-home__excel-btn';
    xlBtn.append(createIcon('download', { size: 14 }));
    const xlLabel = document.createElement('span');
    xlLabel.textContent = 'Excel';
    xlBtn.append(xlLabel);
    xlBtn.addEventListener('click', () => exportMonthToExcel(records, instructor, year, month));
    actions.append(xlBtn);
  }

  // Submit button
  if ((status === 'open' || status === 'reopened') && editable && sourceRecords.length > 0) {
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'av2-btn av2-btn--primary av2-home__action-btn av2-home__month-submit';
    const submitLabel = document.createElement('span');
    submitLabel.textContent = status === 'reopened' ? 'הגשה מחדש' : 'סיום ואישור';
    submitBtn.append(createIcon('check-circle', { size: 14 }), submitLabel);
    submitBtn.addEventListener('click', () => handleSubmit({ submitBtn, instructor, year, month, sourceRecords, strip }));
    actions.append(submitBtn);
  }

  strip.append(actions);
  return strip;
}

async function handleSubmit({ submitBtn, instructor, year, month, sourceRecords, strip }) {
  if (!sourceRecords.length) return;
  await openSubmitConfirmationDialog({
    monthLabel: formatMonthLabel(year, month), sourceCount: sourceRecords.length, trigger: submitBtn,
    onRetry: async (issues) => {
      const ids = issues.length ? issues.map((item) => item.source_id) : sourceRecords.map((record) => record.id);
      await Promise.all(ids.map((id) => reconcileTravelCompensation(id)));
    },
    onApprove: async () => {
      await submitMonth(instructor.empId, getMonthKey(year, month), instructor?.name || '');
    const badge = strip.querySelector('.av2-badge');
    if (badge) {
      badge.className = 'av2-badge av2-badge--warning av2-home__report-status';
      badge.textContent = 'אושר על ידי העובד / בבקרת מנהל';
    }
      submitBtn.remove();
    }
  });
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

function buildStatSkeletons(count = 9) {
  return Array(count).fill(0).map(() =>
    `<div class="av2-stat-card av2-stat-card--skeleton"></div>`
  ).join('');
}

function normalizedActivityType(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function hoursForType(records, label) {
  const target = normalizedActivityType(label);
  return (Array.isArray(records) ? records : [])
    .filter((record) => !isCancellationRecord(record))
    .filter((record) => normalizedActivityType(record?.activity_type) === target)
    .reduce((sum, record) => sum + Number(record?.total_hours || 0), 0);
}

function cancellationHours(records) {
  const rows = Array.isArray(records) ? records : [];
  const explicit = rows
    .filter(isCancellationRecord)
    .reduce((sum, record) => sum + Number(record?.total_hours || 0), 0);

  const generatedSourceIds = new Set(
    rows
      .filter((record) => isCancellationRecord(record) && record?.source_attendance_record_id)
      .map((record) => String(record.source_attendance_record_id))
  );

  const linkedMinutes = rows
    .filter((record) => !isCancellationRecord(record))
    .filter((record) => !generatedSourceIds.has(String(record?.id || '')))
    .reduce((sum, record) => {
      const compensation = record?.travel_compensation;
      if (compensation?.calculation_status !== 'resolved') return sum;
      return sum + Math.max(0, Number(compensation?.final_cancellation_minutes || 0));
    }, 0);

  return explicit + linkedMinutes / 60;
}

export function buildHomeSummaryStats(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const sourceRows = sourceAttendanceRecords(rows);
  const km = sourceRows.reduce((sum, record) => sum + Number(record?.roundtrip_km || 0), 0);
  const expenses = sourceRows.reduce((sum, record) => sum + Number(record?.expenses || 0), 0);

  const items = [
    { key: 'course',       label: 'סה״כ קורס',       numericValue: hoursForType(sourceRows, 'קורס'),   icon: 'clock-3', valueType: 'hours' },
    { key: 'workshop',     label: 'סה״כ סדנה',       numericValue: hoursForType(sourceRows, 'סדנה'),   icon: 'clock-3', valueType: 'hours' },
    { key: 'training',     label: 'סה״כ הכשרות',     numericValue: hoursForType(sourceRows, 'הכשרה'), icon: 'clock-3', valueType: 'hours' },
    { key: 'operations',   label: 'סה״כ תפעול',      numericValue: hoursForType(sourceRows, 'תפעול'), icon: 'clock-3', valueType: 'hours' },
    { key: 'cancellation', label: 'סה״כ ביטול זמן',  numericValue: cancellationHours(rows),          icon: 'clock-3', valueType: 'hours' },
    { key: 'kilometers',   label: 'סה״כ קילומטר',    numericValue: km,                               icon: 'map-pin', valueType: 'kilometers' },
    { key: 'expenses',     label: 'סה״כ הוצאות',     numericValue: expenses,                         icon: 'wallet-cards', valueType: 'expenses' },
    { key: 'tour',         label: 'סה״כ סיור',       numericValue: hoursForType(sourceRows, 'סיור'), icon: 'clock-3', valueType: 'hours' },
    { key: 'workdays',     label: 'סה״כ ימי עבודה',  numericValue: distinctAttendanceWorkDays(sourceRows), icon: 'calendar-days', valueType: 'days' },
  ];

  return items
    .filter((item) => Number(item.numericValue) > 0)
    .map((item) => {
      let value = String(item.numericValue);
      if (item.valueType === 'hours') value = formatDurationHours(item.numericValue);
      if (item.valueType === 'kilometers') value = `${Math.round(item.numericValue).toLocaleString('he-IL')} ק״מ`;
      if (item.valueType === 'expenses') value = `₪${Number(item.numericValue).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
      return { ...item, value };
    });
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
