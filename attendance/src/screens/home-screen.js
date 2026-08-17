import { createIcon } from '../components/icon.js';

export function renderHomeScreen(container, {
  instructor = {},
  summary = {},
  onNewReport,
  onMyReports,
  onSubmitMonth,
  onLogout
} = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-home';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-home__inner';

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

  const newReportBtn = document.createElement('button');
  newReportBtn.type = 'button';
  newReportBtn.className = 'av2-btn av2-btn--primary av2-home__primary';
  const newReportLabel = document.createElement('span');
  newReportLabel.textContent = 'דיווח חדש';
  newReportBtn.append(createIcon('plus'), newReportLabel);
  newReportBtn.addEventListener('click', () => onNewReport?.());

  const summaryEl = buildSummaryStrip(summary);

  const rows = document.createElement('div');
  rows.className = 'av2-home__rows';
  rows.append(
    buildNavRow({ icon: 'list', label: 'הדיווחים שלי', onClick: onMyReports }),
    buildNavRow({ icon: 'calendar', label: 'הגשת חודש', onClick: onSubmitMonth })
  );

  inner.append(header, newReportBtn, summaryEl, rows);
  wrap.append(inner);
  container.append(wrap);
}

function buildSummaryStrip(summary) {
  const el = document.createElement('div');
  el.className = 'av2-summary';
  el.append(
    buildStat(summary.reportsCount, 'דיווחים'),
    buildStat(summary.totalHours, 'שעות'),
    buildStat(summary.pendingCount, 'ממתינים')
  );
  return el;
}

function buildStat(value, label) {
  const stat = document.createElement('div');
  stat.className = 'av2-summary__stat';
  const val = document.createElement('p');
  val.className = 'av2-summary__value';
  val.textContent = value != null ? String(value) : '–';
  const lab = document.createElement('p');
  lab.className = 'av2-summary__label';
  lab.textContent = label;
  stat.append(val, lab);
  return stat;
}

function buildNavRow({ icon, label, onClick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'av2-row av2-row--nav';
  row.append(createIcon(icon));
  const text = document.createElement('span');
  text.className = 'av2-row__label';
  text.textContent = label;
  row.append(text, createIcon('chevron-left'));
  row.addEventListener('click', () => onClick?.());
  return row;
}
