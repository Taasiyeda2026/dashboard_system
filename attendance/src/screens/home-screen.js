/**
 * home-screen.js  —  Dashboard
 * Loads real data from Supabase on mount.
 * Month navigation kept in sync with app.js state.
 */

import { createIcon } from '../components/icon.js';
import { getMonthRecords, calcMonthSummary, getMonthApproval, submitMonth } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel, shouldShowSubmitReminder } from '../services/month-gate.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';

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

  // ── Stat cards placeholder (filled after load) ─────────────────────────
  const statsEl = document.createElement('div');
  statsEl.className = 'av2-stats-grid';
  statsEl.innerHTML = buildStatSkeletons();

  // ── Monthly approval card placeholder ─────────────────────────────────
  const approvalCard = document.createElement('div');
  approvalCard.className = 'av2-approval-card';
  approvalCard.innerHTML = '<p class="av2-approval-card__loading">טוען מצב חודש…</p>';

  inner.append(header, monthNav, newReportBtn, statsEl, approvalCard);
  wrap.append(inner);
  container.append(wrap);

  // ── Load real data ─────────────────────────────────────────────────────
  loadAndRender({ instructor, year, month, statsEl, approvalCard, newReportBtn, onMyReports });
}

async function loadAndRender({ instructor, year, month, statsEl, approvalCard, newReportBtn, onMyReports }) {
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
      buildStat(summary.totalHours.toFixed(1), 'שעות', 'clock'),
      buildStat(summary.totalKm.toFixed(0) + ' ק"מ', 'נסיעות', 'map-pin'),
      buildStat('₪' + summary.totalExpenses.toFixed(0), 'הוצאות', 'dollar-sign')
    );

    // Disable new report if month is locked/submitted
    newReportBtn.disabled = !editable;
    if (!editable) {
      newReportBtn.title = editBlockReason(year, month, approval);
      newReportBtn.style.opacity = '0.5';
    }

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
      xlBtn.innerHTML = '';
      xlBtn.append(createIcon('download', { size: 15 }));
      const xlLabel = document.createElement('span');
      xlLabel.textContent = 'ייצוא Excel';
      xlBtn.append(xlLabel);
      xlBtn.addEventListener('click', () => exportMonthToExcel(records, instructor, year, month));
      approvalCard.append(xlBtn);
    }

  } catch (err) {
    statsEl.innerHTML = `<p class="av2-error">${err.message}</p>`;
    approvalCard.innerHTML = '';
  }
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

  const statusMap = {
    open:     { label: 'פתוח לעריכה', tone: 'neutral' },
    submitted:{ label: 'הוגש — ממתין לאישור', tone: 'warning' },
    locked:   { label: 'נעול על ידי מנהל', tone: 'success' },
    reopened: { label: 'נפתח מחדש', tone: 'neutral' }
  };

  const { label: statusLabel, tone } = statusMap[status] || statusMap.open;

  const titleRow = document.createElement('div');
  titleRow.className = 'av2-approval-inner__title-row';
  const title = document.createElement('span');
  title.className = 'av2-approval-inner__title';
  title.textContent = `דיווח חודשי — ${formatMonthLabel(year, month)}`;
  const badge = document.createElement('span');
  badge.className = `av2-badge av2-badge--${tone}`;
  badge.textContent = statusLabel;
  titleRow.append(title, badge);

  const metaRow = document.createElement('p');
  metaRow.className = 'av2-approval-inner__meta';
  metaRow.textContent = `${summary.recordsCount} רשומות · ${summary.totalHours.toFixed(1)} שעות · ${summary.totalKm.toFixed(0)} ק"מ`;

  wrap.append(titleRow, metaRow);

  if (status === 'open' || status === 'reopened') {
    if (editable && records.length > 0) {
      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'av2-btn av2-btn--primary';
      const submitLabel = document.createElement('span');
      submitLabel.textContent = 'סיום וסגירת חודש';
      submitBtn.append(createIcon('check-circle', { size: 16 }), submitLabel);
      submitBtn.addEventListener('click', () => handleSubmit({ submitBtn, instructor, year, month, records, wrap }));
      wrap.append(submitBtn);
    } else if (!editable) {
      const msg = document.createElement('p');
      msg.className = 'av2-approval-inner__locked-msg';
      msg.textContent = editBlockReason(year, month, approval);
      wrap.append(msg);
    }
  } else if (status === 'submitted') {
    if (approval?.submitted_at) {
      const submittedEl = document.createElement('p');
      submittedEl.className = 'av2-approval-inner__meta';
      submittedEl.textContent = `הוגש: ${new Date(approval.submitted_at).toLocaleDateString('he-IL')}`;
      wrap.append(submittedEl);
    }
  }

  // "הדיווחים שלי" link
  const myReportsLink = document.createElement('button');
  myReportsLink.type = 'button';
  myReportsLink.className = 'av2-btn av2-btn--link';
  myReportsLink.textContent = 'לצפייה בכל הדיווחים ←';
  myReportsLink.addEventListener('click', () => onMyReports?.());
  wrap.append(myReportsLink);

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
    await submitMonth(instructor.empId, getMonthKey(year, month));
    const badge = wrap.querySelector('.av2-badge');
    if (badge) {
      badge.className = 'av2-badge av2-badge--warning';
      badge.textContent = 'הוגש — ממתין לאישור';
    }
    submitBtn.remove();
    const msg = document.createElement('p');
    msg.className = 'av2-approval-inner__meta';
    msg.style.color = 'var(--av2-color-success-text)';
    msg.textContent = `✓ הוגש בהצלחה ב-${new Date().toLocaleDateString('he-IL')}`;
    wrap.append(msg);
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'סיום וסגירת חודש';
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
