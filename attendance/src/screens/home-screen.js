/**
 * home-screen.js  —  Dashboard
 * Loads real data from Supabase on mount.
 * Month navigation kept in sync with app.js state.
 */

import { createIcon } from '../components/icon.js';
import { createMiniCalendar } from '../components/mini-calendar.js';
import { getMonthRecords, calcMonthSummary, getMonthApproval, submitMonth } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel, shouldShowSubmitReminder } from '../services/month-gate.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';

const DAY_NAMES_SHORT = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\''];

const STATUS_MAP = {
  open:     { label: 'פתוח לדיווח', tone: 'neutral' },
  submitted:{ label: 'אושר על ידי העובד / בבקרת מנהל', tone: 'warning' },
  locked:   { label: 'אושר על ידי המנהל', tone: 'success' },
  reopened: { label: 'הוחזר לתיקון — פתוח לדיווח', tone: 'neutral' },
  approved_for_payroll: { label: 'אושר סופית', tone: 'success' }
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

  // ── Header: identity + logout ──────────────────────────────────────────
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

  // ── Title band: page title + month status chip (filled after load) ─────
  const titleBand = document.createElement('div');
  titleBand.className = 'av2-home__title-band';
  const pageTitleEl = document.createElement('h1');
  pageTitleEl.className = 'av2-home__page-title';
  pageTitleEl.textContent = 'דיווחי נוכחות';
  const statusChip = document.createElement('span');
  statusChip.className = 'av2-home__status-chip';
  statusChip.hidden = true;
  titleBand.append(pageTitleEl, statusChip);

  // ── Month navigator ────────────────────────────────────────────────────
  const monthNav = buildMonthNav(year, month, onPrevMonth, onNextMonth);

  // ── Primary action ─────────────────────────────────────────────────────
  const newReportBtn = document.createElement('button');
  newReportBtn.type = 'button';
  newReportBtn.className = 'av2-btn av2-btn--primary av2-home__primary';
  const newReportLabel = document.createElement('span');
  newReportLabel.textContent = 'הוספת דיווח';
  newReportBtn.append(createIcon('plus'), newReportLabel);
  newReportBtn.addEventListener('click', () => onNewReport?.());

  // Month nav + add button share one compact action row
  const actionRow = document.createElement('div');
  actionRow.className = 'av2-home__action-row';
  actionRow.append(monthNav, newReportBtn);

  // ── Stat cards placeholder (filled after load) ─────────────────────────
  const statsEl = document.createElement('div');
  statsEl.className = 'av2-stats-grid';
  statsEl.innerHTML = buildStatSkeletons();

  // ── Workspace: calendar + monthly approval side by side ────────────────
  const workspace = document.createElement('div');
  workspace.className = 'av2-home__workspace';

  const calendarSection = document.createElement('section');
  calendarSection.className = 'av2-home__calendar';
  calendarSection.innerHTML = '<p class="av2-home__section-loading">טוען לוח שנה…</p>';

  const approvalCard = document.createElement('div');
  approvalCard.className = 'av2-approval-card';
  approvalCard.innerHTML = '<p class="av2-approval-card__loading">טוען מצב חודש…</p>';

  workspace.append(calendarSection, approvalCard);

  // ── Recent reports (compact list) ───────────────────────────────────────
  const recentSection = document.createElement('section');
  recentSection.className = 'av2-home__recent';
  recentSection.innerHTML = '<p class="av2-home__section-loading">טוען דיווחים…</p>';

  inner.append(header, titleBand, actionRow, statsEl, workspace, recentSection);
  wrap.append(inner);
  container.append(wrap);

  // ── Load real data (single fetch — feeds stats, calendar and recent list) ─
  loadAndRender({ instructor, year, month, statsEl, approvalCard, newReportBtn, onMyReports, statusChip, calendarSection, recentSection });
}

async function loadAndRender({ instructor, year, month, statsEl, approvalCard, newReportBtn, onMyReports, statusChip, calendarSection, recentSection }) {
  const monthKey = getMonthKey(year, month);
  try {
    const [records, approval] = await Promise.all([
      getMonthRecords(instructor.empId, year, month),
      getMonthApproval(instructor.empId, monthKey)
    ]);

    const summary = calcMonthSummary(records);
    const editable = canEditMonth(year, month, approval);

    // Update stat cards
    statsEl.innerHTML = '';
    statsEl.append(
      buildStat(summary.recordsCount, 'דיווחים', 'list'),
      buildStat(summary.totalHours.toFixed(2), 'שעות', 'clock'),
      buildStat(summary.totalKm.toFixed(0) + ' ק"מ', 'נסיעות', 'map-pin'),
      buildStat('₪' + summary.totalExpenses.toFixed(0), 'הוצאות', 'dollar-sign')
    );

    // Disable new report if month is locked/submitted
    newReportBtn.disabled = !editable;
    if (!editable) {
      newReportBtn.title = editBlockReason(year, month, approval);
      newReportBtn.style.opacity = '0.5';
    }

    // Status chip (title band)
    const { label: statusLabel, tone } = STATUS_MAP[approval?.status ?? 'open'] || STATUS_MAP.open;
    statusChip.hidden = false;
    statusChip.textContent = statusLabel;
    statusChip.dataset.tone = tone;

    // Update approval card
    approvalCard.innerHTML = '';
    // Submit reminder banner: shown from the 25th when month is still open/reopened
    if (shouldShowSubmitReminder(year, month, approval)) {
      approvalCard.append(buildSubmitReminderBanner({ year, month }));
    }
    approvalCard.append(buildApprovalCard({ approval, year, month, instructor, records, summary, editable, onMyReports }));

    // Excel export button (if there are records)
    if (records.length > 0) {
      const xlBtn = document.createElement('button');
      xlBtn.type = 'button';
      xlBtn.className = 'av2-btn av2-btn--secondary av2-home__excel-btn';
      xlBtn.append(createIcon('download', { size: 15 }));
      const xlLabel = document.createElement('span');
      xlLabel.textContent = 'ייצוא Excel';
      xlBtn.append(xlLabel);
      xlBtn.addEventListener('click', () => exportMonthToExcel(records, instructor, year, month));
      approvalCard.append(xlBtn);
    }

    // Calendar + recent list — both sourced from the single `records` fetch above.
    renderCalendarSection(calendarSection, recentSection, records, year, month, onMyReports);

  } catch (err) {
    statsEl.innerHTML = `<p class="av2-error">${err.message}</p>`;
    approvalCard.innerHTML = '';
    calendarSection.innerHTML = '';
    recentSection.innerHTML = '';
  }
}

// ── Calendar + recent list ──────────────────────────────────────────────────

function renderCalendarSection(calendarSection, recentSection, records, year, month, onMyReports) {
  calendarSection.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'av2-home__section-heading';
  const titleBox = document.createElement('div');
  titleBox.innerHTML = `<h2>לוח חודש</h2><p>${formatMonthLabel(year, month)}</p>`;
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'av2-btn av2-btn--link';
  clearBtn.textContent = 'כל החודש';
  clearBtn.hidden = true;
  heading.append(titleBox, clearBtn);

  const { wrap: calWrap, clearSelection } = createMiniCalendar({
    year, month, records,
    variant: 'home',
    onDayClick: (dateStr) => {
      clearBtn.hidden = false;
      renderRecentList(recentSection, records, year, month, dateStr, onMyReports);
    }
  });

  clearBtn.addEventListener('click', () => {
    clearBtn.hidden = true;
    clearSelection();
    renderRecentList(recentSection, records, year, month, null, onMyReports);
  });

  calendarSection.append(heading, calWrap);

  renderRecentList(recentSection, records, year, month, null, onMyReports);
}

function renderRecentList(recentSection, records, year, month, selectedDate, onMyReports) {
  recentSection.innerHTML = '';

  const filtered = selectedDate ? records.filter((r) => r.report_date === selectedDate) : [...records];
  filtered.sort((a, b) =>
    String(b.report_date).localeCompare(String(a.report_date)) ||
    String(b.start_time || '').localeCompare(String(a.start_time || ''))
  );
  const visible = selectedDate ? filtered : filtered.slice(0, 5);

  const heading = document.createElement('div');
  heading.className = 'av2-home__section-heading';
  const titleBox = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = selectedDate ? `דיווחים ל-${formatDateShort(selectedDate)}` : 'הדיווחים האחרונים';
  const p = document.createElement('p');
  p.textContent = selectedDate ? `${filtered.length} דיווחים ביום שנבחר` : `${records.length} דיווחים בחודש`;
  titleBox.append(h2, p);
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'av2-btn av2-btn--link';
  allBtn.textContent = 'לכל הדיווחים ←';
  allBtn.addEventListener('click', () => onMyReports?.());
  heading.append(titleBox, allBtn);

  const list = document.createElement('div');
  list.className = 'av2-home__report-list';
  const tableHead = document.createElement('div');
  tableHead.className = 'av2-home__report-table-head';
  for (const label of ['תאריך', 'פעילות', 'בית ספר', 'שעות', 'סה״כ שעות', 'נסיעות']) {
    const cell = document.createElement('span');
    cell.textContent = label;
    tableHead.append(cell);
  }
  list.append(tableHead);
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'av2-home__empty';
    empty.textContent = selectedDate ? 'אין דיווחים ביום הזה.' : `אין עדיין דיווחים ב${formatMonthLabel(year, month)}.`;
    list.append(empty);
  } else {
    visible.forEach((record) => list.append(buildReportRow(record)));
  }

  recentSection.append(heading, list);
}

function buildReportRow(record) {
  const row = document.createElement('div');
  row.className = 'av2-home__report-row';

  const dateCol = document.createElement('div');
  dateCol.className = 'av2-home__report-row-date';
  const dStrong = document.createElement('strong');
  dStrong.textContent = formatDateShort(record.report_date);
  const dSpan = document.createElement('span');
  dSpan.textContent = dayNameShort(record.report_date);
  dateCol.append(dStrong, dSpan);

  const mainCol = document.createElement('div');
  mainCol.className = 'av2-home__report-row-main';
  const mStrong = document.createElement('strong');
  mStrong.textContent = record.activity_name_snapshot || record.activity_type || 'דיווח';
  const mSpan = document.createElement('span');
  mSpan.textContent = record.school_name_snapshot || record.authority_name_snapshot || '';
  mainCol.append(mStrong, mSpan);

  const schoolCol = document.createElement('div');
  schoolCol.className = 'av2-home__report-row-school';
  schoolCol.textContent = record.school_name_snapshot || record.authority_name_snapshot || '—';

  const timeCol = document.createElement('div');
  timeCol.className = 'av2-home__report-row-time';
  const tStrong = document.createElement('strong');
  tStrong.textContent = `${formatTimeShort(record.start_time)}–${formatTimeShort(record.end_time)}`;
  const tSpan = document.createElement('span');
  tSpan.textContent = `${Number(record.total_hours || 0).toFixed(2)} שעות · ${Number(record.roundtrip_km || 0).toFixed(0)} ק״מ`;
  timeCol.append(tStrong, tSpan);

  const hoursCol = document.createElement('div');
  hoursCol.className = 'av2-home__report-row-hours';
  hoursCol.textContent = `${Number(record.total_hours || 0).toFixed(2)} ש`;

  const kmCol = document.createElement('div');
  kmCol.className = 'av2-home__report-row-km';
  kmCol.textContent = `${Number(record.roundtrip_km || 0).toFixed(0)} ק״מ`;

  row.append(dateCol, mainCol, schoolCol, timeCol, hoursCol, kmCol);
  return row;
}

// ── Builders ───────────────────────────────────────────────────────────────

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

  // Disable next if we're already at the current month
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
  const ico = createIcon(iconName, { size: 18 });
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

function buildApprovalCard({ approval, year, month, instructor, records, summary, editable, onMyReports }) {
  const wrap = document.createElement('div');
  wrap.className = 'av2-approval-inner';

  const status = approval?.status ?? 'open';
  const { label: statusLabel, tone } = STATUS_MAP[status] || STATUS_MAP.open;

  // ── Title row: label + status badge ──────────────────────────────────────
  const titleRow = document.createElement('div');
  titleRow.className = 'av2-approval-inner__title-row';
  const title = document.createElement('span');
  title.className = 'av2-approval-inner__title';
  title.textContent = `דיווח חודשי — ${formatMonthLabel(year, month)}`;
  const badge = document.createElement('span');
  badge.className = `av2-badge av2-badge--${tone}`;
  badge.textContent = statusLabel;
  titleRow.append(title, badge);

  // ── Stats row: 3 numbers in a compact grid ────────────────────────────────
  const statsGrid = document.createElement('div');
  statsGrid.className = 'av2-approval-inner__stats';
  [
    { value: summary.recordsCount,              unit: 'דיווחים' },
    { value: summary.totalHours.toFixed(2),     unit: 'שעות'    },
    { value: summary.totalKm.toFixed(0) + ' ק"מ', unit: 'נסיעות' },
  ].forEach(({ value, unit }) => {
    const cell = document.createElement('div');
    cell.className = 'av2-approval-inner__stat';
    const v = document.createElement('strong');
    v.textContent = value;
    const u = document.createElement('span');
    u.textContent = unit;
    cell.append(v, u);
    statsGrid.append(cell);
  });

  // ── "View all reports" link ───────────────────────────────────────────────
  const myReportsLink = document.createElement('button');
  myReportsLink.type = 'button';
  myReportsLink.className = 'av2-btn av2-btn--link';
  myReportsLink.textContent = 'לצפייה בכל הדיווחים ←';
  myReportsLink.addEventListener('click', () => onMyReports?.());

  wrap.append(titleRow, statsGrid, myReportsLink);

  // ── Bottom action strip ───────────────────────────────────────────────────
  if (status === 'open' || status === 'reopened') {
    if (status === 'reopened') {
      const strip = document.createElement('div');
      strip.className = 'av2-approval-inner__strip av2-approval-inner__strip--info';
      const msg = document.createElement('span');
      msg.textContent = 'החודש הוחזר אליך לתיקון — ניתן לערוך ולהגיש מחדש.';
      strip.append(msg);
      wrap.append(strip);
    }
    if (editable && records.length > 0) {
      const strip = document.createElement('div');
      strip.className = 'av2-approval-inner__strip';
      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'av2-btn av2-btn--primary av2-home__month-submit';
      const submitLabel = document.createElement('span');
      submitLabel.textContent = 'סיום דיווח ואישור';
      submitBtn.append(createIcon('check-circle', { size: 15 }), submitLabel);
      submitBtn.addEventListener('click', () => handleSubmit({ submitBtn, instructor, year, month, records, wrap }));
      strip.append(submitBtn);
      wrap.append(strip);
    } else if (!editable) {
      const msg = document.createElement('p');
      msg.className = 'av2-approval-inner__locked-msg';
      msg.textContent = editBlockReason(year, month, approval);
      wrap.append(msg);
    }
  } else if (status === 'submitted') {
    if (approval?.submitted_at) {
      const strip = document.createElement('div');
      strip.className = 'av2-approval-inner__strip av2-approval-inner__strip--info';
      const msg = document.createElement('span');
      const byName = String(approval?.submitted_by_name || instructor?.name || '').trim();
      msg.textContent = `✓ אושר על ידי העובד ${byName ? `(${byName}) ` : ''}ב-${new Date(approval.submitted_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`;
      strip.append(msg);
      wrap.append(strip);
    }
  } else if (status === 'locked') {
    const strip = document.createElement('div');
    strip.className = 'av2-approval-inner__strip av2-approval-inner__strip--info';
    const when = approval?.manager_approved_at
      ? ` ב-${new Date(approval.manager_approved_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`
      : '';
    const who = String(approval?.manager_approved_by_name || '').trim();
    const msg = document.createElement('span');
    msg.textContent = `✓ אושר על ידי המנהל${who ? ` (${who})` : ''}${when}`;
    strip.append(msg);
    wrap.append(strip);
  } else if (status === 'approved_for_payroll') {
    const strip = document.createElement('div');
    strip.className = 'av2-approval-inner__strip av2-approval-inner__strip--info';
    const when = approval?.payroll_approved_at
      ? ` ב-${new Date(approval.payroll_approved_at).toLocaleDateString('he-IL')}`
      : '';
    const msg = document.createElement('span');
    msg.textContent = `✓ החודש אושר סופית${when}`;
    strip.append(msg);
    wrap.append(strip);
  }

  return wrap;
}

async function handleSubmit({ submitBtn, instructor, year, month, records, wrap }) {
  if (!records.length) return;
  const confirmed = confirm(
    `להגיש את דיווח ${formatMonthLabel(year, month)}?\n` +
    `יש ${records.length} רשומות. לאחר ההגשה לא ניתן יהיה לערוך עד אישור מנהל.`
  );
  if (!confirmed) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'מגיש…';
  try {
    await submitMonth(instructor.empId, getMonthKey(year, month), instructor?.name || '');
    const badge = wrap.querySelector('.av2-badge');
    if (badge) {
      badge.className = 'av2-badge av2-badge--warning';
      badge.textContent = 'אושר על ידי העובד / בבקרת מנהל';
    }
    submitBtn.remove();
    const msg = document.createElement('p');
    msg.className = 'av2-approval-inner__meta';
    msg.style.color = 'var(--av2-color-success-text)';
    msg.textContent = `✓ אישור העובד נשמר בהצלחה ב-${new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`;
    wrap.append(msg);
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'סיום דיווח ואישור';
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
  text.textContent = `נותרו ימים ספורים לסיום ${formatMonthLabel(year, month)}. יש לסיים ולהגיש את הדיווח החודשי.`;

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'av2-submit-reminder__action';
  actionBtn.textContent = 'לסגירת החודש ↓';
  actionBtn.addEventListener('click', () => {
    // Scroll to the approval card's submit button (or the card itself)
    const submitBtn = document.querySelector('.av2-approval-inner .av2-btn--primary');
    const target = submitBtn || document.querySelector('.av2-approval-inner');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (submitBtn) submitBtn.focus();
    }
  });

  body.append(title, text, actionBtn);
  banner.append(icon, body);
  return banner;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatDateShort(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function dayNameShort(isoDate) {
  const d = isoDate ? new Date(`${isoDate}T12:00:00`) : null;
  return !d || Number.isNaN(d.getTime()) ? '' : DAY_NAMES_SHORT[d.getDay()];
}

function formatTimeShort(t) {
  return t ? String(t).slice(0, 5) : '—';
}
