import { resolveInstructorIdentity } from './auth/identity.service.js';
import { getMonthRecords } from './services/attendance.service.js';

const DESKTOP_QUERY = '(min-width: 768px)';
const monthFormatter = new Intl.DateTimeFormat('he-IL', { month: 'long' });
const identityPromise = resolveInstructorIdentity().catch(() => null);
let scheduled = false;
let homeRequestKey = '';
let homeRequestSeq = 0;

function isDesktop() {
  return globalThis.matchMedia?.(DESKTOP_QUERY)?.matches ?? true;
}

function text(node) {
  return String(node?.textContent || '').trim();
}

function numberFrom(value) {
  const normalized = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const number = normalized ? Number(normalized[0]) : 0;
  return Number.isFinite(number) ? number : 0;
}

function formatHours(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function monthFromLabel(label) {
  const value = String(label || '').trim();
  const yearMatch = value.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  for (let month = 1; month <= 12; month += 1) {
    const monthName = monthFormatter.format(new Date(year, month - 1, 1));
    if (value.includes(monthName)) return { year, month };
  }
  return null;
}

function installStyles() {
  if (document.getElementById('av2-reference-data-layout-style')) return;
  const style = document.createElement('style');
  style.id = 'av2-reference-data-layout-style';
  style.textContent = `
    .av2-reference-home-summary,
    .av2-reference-reports-table { display: none; }

    @media (min-width: 768px) {
      .av2-home__inner.has-reference-summary > .av2-home__recent { display: none !important; }
      .av2-reference-home-summary {
        display: block;
        width: min(100%, 1180px);
        margin-inline: auto;
        background: #fff;
        border: 1px solid var(--av2-color-border);
        border-radius: 10px;
        overflow: hidden;
      }
      .av2-reference-home-summary__title {
        margin: 0;
        padding: 13px 16px;
        font-size: .78rem;
        font-weight: 800;
        color: var(--av2-color-text);
        border-bottom: 1px solid #eef2f6;
      }
      .av2-reference-home-summary__head,
      .av2-reference-home-summary__row,
      .av2-reference-home-summary__total {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: center;
        text-align: center;
      }
      .av2-reference-home-summary__head {
        min-height: 34px;
        background: #f8fafc;
        color: #718096;
        font-size: .66rem;
        font-weight: 700;
        border-bottom: 1px solid var(--av2-color-border);
      }
      .av2-reference-home-summary__row {
        min-height: 34px;
        font-size: .7rem;
        color: var(--av2-color-text);
        border-bottom: 1px solid #eef2f6;
      }
      .av2-reference-home-summary__row > span,
      .av2-reference-home-summary__head > span,
      .av2-reference-home-summary__total > span {
        min-width: 0;
        padding: 6px 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .av2-reference-home-summary__total {
        min-height: 36px;
        background: #f8fafc;
        color: #1d4ed8;
        font-size: .7rem;
        font-weight: 800;
      }
      .av2-reference-home-summary__empty {
        margin: 0;
        padding: 18px;
        text-align: center;
        color: var(--av2-color-text-muted);
        font-size: .72rem;
      }

      .av2-reports__calendar-wrap { max-width: 690px !important; }
      .av2-reference-reports-table {
        display: block;
        width: min(100%, 1180px);
        margin-inline: auto;
        background: #fff;
        border: 1px solid var(--av2-color-border);
        border-radius: 9px;
        overflow: hidden;
      }
      .av2-reference-reports-table + .av2-report-list { display: none !important; }
      .av2-reference-reports-table ~ .av2-report-list__totals { display: none !important; }
      .av2-reference-reports-table__head,
      .av2-reference-reports-table__row,
      .av2-reference-reports-table__total {
        display: grid;
        grid-template-columns: repeat(9, minmax(0, 1fr));
        align-items: center;
      }
      .av2-reference-reports-table__head {
        min-height: 34px;
        background: #f8fafc;
        color: #718096;
        font-size: .62rem;
        font-weight: 700;
        border-bottom: 1px solid var(--av2-color-border);
      }
      .av2-reference-reports-table__row {
        min-height: 36px;
        font-size: .68rem;
        color: var(--av2-color-text);
        border-bottom: 1px solid #eef2f6;
      }
      .av2-reference-reports-table__head > span,
      .av2-reference-reports-table__row > span,
      .av2-reference-reports-table__total > span,
      .av2-reference-reports-table__actions {
        min-width: 0;
        padding: 6px 7px;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .av2-reference-reports-table__row:hover { background: #fbfdff; }
      .av2-reference-reports-table__hours { color: #1d4ed8; font-weight: 800; }
      .av2-reference-reports-table__actions {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 2px;
        overflow: visible;
      }
      .av2-reference-reports-table__actions .av2-btn--icon {
        width: 25px;
        height: 25px;
        padding: 0;
      }
      .av2-reference-reports-table__total {
        min-height: 38px;
        background: #f8fafc;
        font-size: .68rem;
        font-weight: 800;
        border-top: 2px solid var(--av2-color-accent);
      }
      .av2-reference-reports-table__total .is-total {
        color: #1d4ed8;
      }
    }
  `;
  document.head.append(style);
}

function updateHomeHoursKpi(records) {
  const totalHours = records.reduce((sum, record) => sum + Number(record.total_hours || 0), 0);
  for (const card of document.querySelectorAll('.av2-home .av2-stat-card')) {
    if (text(card.querySelector('.av2-stat-card__label')) !== 'שעות') continue;
    const value = card.querySelector('.av2-stat-card__value');
    if (value) value.textContent = formatHours(totalHours);
  }
}

function renderHomeSummary(root, records, key) {
  const existing = root.querySelector('.av2-reference-home-summary');
  existing?.remove();

  const groups = new Map();
  for (const record of records) {
    const activityType = String(record.activity_type || record.activity_name_snapshot || 'אחר').trim() || 'אחר';
    const current = groups.get(activityType) || { activityType, hours: 0, km: 0 };
    current.hours += Number(record.total_hours || 0);
    current.km += Number(record.roundtrip_km || 0);
    groups.set(activityType, current);
  }

  const summary = document.createElement('section');
  summary.className = 'av2-reference-home-summary';
  summary.dataset.monthKey = key;

  const title = document.createElement('h2');
  title.className = 'av2-reference-home-summary__title';
  title.textContent = 'סיכום פעילויות';
  summary.append(title);

  const head = document.createElement('div');
  head.className = 'av2-reference-home-summary__head';
  ['סוג פעילות', 'סה״כ שעות', 'סה״כ קילומטר'].forEach((label) => {
    const cell = document.createElement('span');
    cell.textContent = label;
    head.append(cell);
  });
  summary.append(head);

  const rows = [...groups.values()].sort((a, b) => a.activityType.localeCompare(b.activityType, 'he'));
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'av2-reference-home-summary__empty';
    empty.textContent = 'אין דיווחים בחודש זה.';
    summary.append(empty);
  } else {
    for (const item of rows) {
      const row = document.createElement('div');
      row.className = 'av2-reference-home-summary__row';
      const activity = document.createElement('span');
      activity.textContent = item.activityType;
      const hours = document.createElement('span');
      hours.textContent = formatHours(item.hours);
      const km = document.createElement('span');
      km.textContent = item.km.toFixed(1);
      row.append(activity, hours, km);
      summary.append(row);
    }

    const total = document.createElement('div');
    total.className = 'av2-reference-home-summary__total';
    const label = document.createElement('span');
    label.textContent = 'סה״כ כולל';
    const hours = document.createElement('span');
    hours.textContent = formatHours(rows.reduce((sum, item) => sum + item.hours, 0));
    const km = document.createElement('span');
    km.textContent = rows.reduce((sum, item) => sum + item.km, 0).toFixed(1);
    total.append(label, hours, km);
    summary.append(total);
  }

  const recent = root.querySelector('.av2-home__recent');
  recent?.after(summary);
  root.classList.add('has-reference-summary');
  updateHomeHoursKpi(records);
}

async function enhanceHome() {
  if (!isDesktop()) return;
  const root = document.querySelector('.av2-home__inner');
  const label = root?.querySelector('.av2-month-nav__label');
  const period = monthFromLabel(text(label));
  if (!root || !period) return;
  const key = `${period.year}-${String(period.month).padStart(2, '0')}`;
  if (root.querySelector(`.av2-reference-home-summary[data-month-key="${key}"]`)) return;
  if (homeRequestKey === key) return;

  homeRequestKey = key;
  const requestId = ++homeRequestSeq;
  try {
    const instructor = await identityPromise;
    if (!instructor?.empId) return;
    const records = await getMonthRecords(instructor.empId, period.year, period.month);
    if (requestId !== homeRequestSeq || !document.contains(root)) return;
    renderHomeSummary(root, records, key);
  } catch (error) {
    console.warn('[Attendance reference layout] home summary failed', error);
  } finally {
    if (homeRequestKey === key) homeRequestKey = '';
  }
}

function detailValue(row, label) {
  for (const field of row.querySelectorAll('.av2-report-row__detail-field')) {
    if (text(field.querySelector('span')) === label) return text(field.querySelector('strong'));
  }
  return '';
}

function extractReportRow(row) {
  const timeText = text(row.querySelector('.av2-report-row__time strong'));
  const [start = '—', end = '—'] = timeText.split(/[–—-]/).map((value) => value.trim());
  const hours = numberFrom(text(row.querySelector('.av2-report-row__time span')));
  const km = numberFrom(detailValue(row, 'ק"מ'));
  return {
    date: String(row.dataset.reportDate || text(row.querySelector('.av2-report-row__date strong')) || '—'),
    start,
    end,
    hours,
    activity: text(row.querySelector('.av2-report-row__main strong')) || '—',
    school: text(row.querySelector('.av2-report-row__school strong')) || text(row.querySelector('.av2-report-row__main span')) || '—',
    authority: detailValue(row, 'רשות') || '—',
    km,
    actions: [...row.querySelectorAll('.av2-report-row__actions button')]
  };
}

function buildCell(value, className = '') {
  const cell = document.createElement('span');
  if (className) cell.className = className;
  cell.textContent = value;
  return cell;
}

function cloneActions(originalButtons) {
  const actions = document.createElement('span');
  actions.className = 'av2-reference-reports-table__actions';
  for (const original of originalButtons) {
    const clone = original.cloneNode(true);
    clone.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      original.click();
    });
    actions.append(clone);
  }
  return actions;
}

function enhanceReportsTable() {
  if (!isDesktop()) return;
  const content = document.querySelector('.av2-reports__content');
  const source = content?.querySelector('.av2-report-list:not(.av2-reference-reports-table)');
  if (!content || !source) return;

  const sourceRows = [...source.querySelectorAll('.av2-report-row')];
  const signature = sourceRows.map((row) => `${row.dataset.recordId || ''}:${row.hidden ? '0' : '1'}:${text(row.querySelector('.av2-report-row__summary'))}`).join('|');
  const existing = content.querySelector('.av2-reference-reports-table');
  if (existing?.dataset.signature === signature) return;
  existing?.remove();

  const visibleRows = sourceRows.filter((row) => !row.hidden).map(extractReportRow);
  const table = document.createElement('div');
  table.className = 'av2-reference-reports-table';
  table.dataset.signature = signature;

  const head = document.createElement('div');
  head.className = 'av2-reference-reports-table__head';
  ['תאריך', 'שעת התחלה', 'שעת סיום', 'סה״כ שעות', 'פעילות', 'בית ספר', 'רשות', 'ק״מ', 'פעולות'].forEach((label) => head.append(buildCell(label)));
  table.append(head);

  let totalHours = 0;
  let totalKm = 0;
  for (const item of visibleRows) {
    totalHours += item.hours;
    totalKm += item.km;
    const row = document.createElement('div');
    row.className = 'av2-reference-reports-table__row';
    row.append(
      buildCell(item.date),
      buildCell(item.start),
      buildCell(item.end),
      buildCell(formatHours(item.hours), 'av2-reference-reports-table__hours'),
      buildCell(item.activity),
      buildCell(item.school),
      buildCell(item.authority),
      buildCell(item.km.toFixed(1)),
      cloneActions(item.actions)
    );
    table.append(row);
  }

  const total = document.createElement('div');
  total.className = 'av2-reference-reports-table__total';
  const cells = [
    buildCell('סה״כ:'),
    buildCell(''),
    buildCell(''),
    buildCell(formatHours(totalHours), 'is-total'),
    buildCell(''),
    buildCell(''),
    buildCell(''),
    buildCell(totalKm.toFixed(1), 'is-total'),
    buildCell('')
  ];
  total.append(...cells);
  table.append(total);
  source.before(table);
}

function runEnhancements() {
  scheduled = false;
  installStyles();
  void enhanceHome();
  enhanceReportsTable();
}

function scheduleEnhancements() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(runEnhancements);
}

export function startReferenceDataLayout() {
  installStyles();
  scheduleEnhancements();
  const observer = new MutationObserver(scheduleEnhancements);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  globalThis.matchMedia?.(DESKTOP_QUERY)?.addEventListener?.('change', scheduleEnhancements);
}
