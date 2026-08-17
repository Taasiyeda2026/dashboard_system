import { createIcon } from '../components/icon.js';

const STATUS_TONE = {
  'אושר': 'success',
  'ממתין לאישור': 'warning',
  'טיוטה': 'neutral'
};

export function renderMyReportsScreen(container, { reports = [], onBack } = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-reports';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-reports__inner';

  const header = document.createElement('div');
  header.className = 'av2-reports__header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'av2-btn av2-btn--icon';
  backBtn.setAttribute('aria-label', 'חזרה');
  backBtn.append(createIcon('chevron-right'));
  backBtn.addEventListener('click', () => onBack?.());
  const title = document.createElement('h1');
  title.className = 'av2-reports__title';
  title.textContent = 'הדיווחים שלי';
  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = 'av2-btn av2-btn--icon';
  filterBtn.setAttribute('aria-label', 'סינון');
  filterBtn.append(createIcon('filter'));
  header.append(backBtn, title, filterBtn);

  const list = document.createElement('div');
  list.className = 'av2-reports__list';

  if (!reports.length) {
    const empty = document.createElement('p');
    empty.className = 'av2-reports__empty';
    empty.textContent = 'אין עדיין דיווחים.';
    list.append(empty);
  } else {
    for (const report of reports) list.append(buildReportRow(report));
  }

  inner.append(header, list);
  wrap.append(inner);
  container.append(wrap);
}

function buildReportRow(report) {
  const row = document.createElement('div');
  row.className = 'av2-row av2-report-row';

  const main = document.createElement('div');
  main.className = 'av2-report-row__main';

  const line1 = document.createElement('div');
  line1.className = 'av2-report-row__line1';
  const typeEl = document.createElement('span');
  typeEl.className = 'av2-report-row__type';
  typeEl.textContent = report.activityType;
  const badge = document.createElement('span');
  const tone = STATUS_TONE[report.status] || 'neutral';
  badge.className = `av2-badge av2-badge--${tone}`;
  badge.textContent = report.status;
  line1.append(typeEl, badge);

  const line2 = document.createElement('p');
  line2.className = 'av2-report-row__meta';
  line2.textContent = `${formatDate(report.date)} · ${report.place} · ${report.hours} שעות`;

  main.append(line1, line2);

  const actions = document.createElement('div');
  actions.className = 'av2-report-row__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'av2-btn av2-btn--icon';
  editBtn.setAttribute('aria-label', 'עריכה');
  editBtn.append(createIcon('edit', { size: 16 }));
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'av2-btn av2-btn--icon';
  deleteBtn.setAttribute('aria-label', 'מחיקה');
  deleteBtn.append(createIcon('trash', { size: 16 }));
  actions.append(editBtn, deleteBtn);

  row.append(main, actions);
  return row;
}

function formatDate(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}
