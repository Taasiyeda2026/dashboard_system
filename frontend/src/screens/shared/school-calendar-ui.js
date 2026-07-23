import { formatDateHe } from './format-date.js';
import { compactSchoolCalendarLabel, schoolCalendarEventsForDate } from './school-calendar-logic.js';
import { loadSchoolCalendarRows } from './school-calendar-data.js';

const HEBREW_MONTH_INDEX = new Map([
  ['ינואר', 1], ['פברואר', 2], ['מרץ', 3], ['אפריל', 4], ['מאי', 5], ['יוני', 6],
  ['יולי', 7], ['אוגוסט', 8], ['ספטמבר', 9], ['אוקטובר', 10], ['נובמבר', 11], ['דצמבר', 12]
]);

let decorationTimer = null;

function ensureSchoolCalendarStyles() {
  if (document.getElementById('school-calendar-style')) return;
  const style = document.createElement('style');
  style.id = 'school-calendar-style';
  style.textContent = `
    #app .ds-interactive-card--day-cell.is-school-calendar-day {
      border-color: rgba(99, 102, 241, .45);
    }
    #app .ds-interactive-card--day-cell.is-school-holiday {
      background: rgba(124, 58, 237, .07);
    }
    #app .ds-interactive-card--day-cell .ds-interactive-card__subtitle[data-school-calendar-label] {
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.25;
      font-size: .74rem;
    }
    #app .ds-week-col__holiday[data-school-calendar-label] {
      display: block;
      margin-top: 4px;
      line-height: 1.25;
      font-size: .78rem;
    }
    #app .ds-week-col__holiday.is-school-holiday {
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);
}

function displayedMonthSpec() {
  const label = document.querySelector('#app nav[aria-label="ניווט חודשי"] .ds-cal-nav__label');
  const text = String(label?.textContent || '').replace(/\s+/g, ' ').trim();
  for (const [monthName, month] of HEBREW_MONTH_INDEX.entries()) {
    const match = new RegExp(`${monthName}\\s+(\\d{4})`).exec(text);
    if (match) return { year: Number(match[1]), month };
  }
  return null;
}

function setMonthSubtitle(card, label) {
  let subtitle = card.querySelector('.ds-interactive-card__subtitle');
  if (!subtitle) {
    subtitle = document.createElement('p');
    subtitle.className = 'ds-interactive-card__subtitle';
    const meta = card.querySelector('.ds-interactive-card__meta');
    if (meta) card.insertBefore(subtitle, meta);
    else card.appendChild(subtitle);
  }
  subtitle.dataset.schoolCalendarLabel = 'true';
  subtitle.textContent = label;
}

function decorateMonth(rows) {
  const spec = displayedMonthSpec();
  if (!spec) return;

  document.querySelectorAll('#app .ds-cal-grid .ds-cal-slot-hit:not(.is-other-month)').forEach((slot) => {
    const card = slot.querySelector('.ds-interactive-card--day-cell');
    const day = Number(card?.querySelector('.ds-interactive-card__title')?.textContent || '');
    if (!card || !Number.isInteger(day) || day < 1 || day > 31) return;

    const isoDate = `${spec.year}-${String(spec.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const events = schoolCalendarEventsForDate(rows, isoDate);
    if (!events.length) return;

    setMonthSubtitle(card, compactSchoolCalendarLabel(events, { maxTitles: 1 }));
    card.classList.add('is-school-calendar-day');
    card.classList.toggle('is-school-holiday', events.some((event) => event.blocks_scheduling));
    card.title = events.map((event) => {
      const resume = event.resume_date ? ` · חזרה ${formatDateHe(event.resume_date) || event.resume_date}` : '';
      return `${event.title}${resume}`;
    }).join('\n');
  });
}

function decorateWeek(rows) {
  document.querySelectorAll('#app .ds-week-col[aria-label]').forEach((column) => {
    const isoDate = String(column.getAttribute('aria-label') || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;

    const events = schoolCalendarEventsForDate(rows, isoDate);
    if (!events.length) return;

    const header = column.querySelector('.ds-week-col__head');
    if (!header) return;
    let label = header.querySelector('.ds-week-col__holiday');
    if (!label) {
      label = document.createElement('span');
      label.className = 'ds-week-col__holiday';
      header.appendChild(label);
    }

    label.dataset.schoolCalendarLabel = 'true';
    label.textContent = compactSchoolCalendarLabel(events, { maxTitles: 2 });
    label.classList.toggle('is-school-holiday', events.some((event) => event.blocks_scheduling));
    label.title = events.map((event) => event.title).join('\n');
  });
}

async function decorateSchoolCalendarViews() {
  ensureSchoolCalendarStyles();
  const rows = await loadSchoolCalendarRows();
  decorateMonth(rows);
  decorateWeek(rows);
}

function scheduleDecoration() {
  clearTimeout(decorationTimer);
  decorationTimer = setTimeout(() => {
    decorationTimer = null;
    void decorateSchoolCalendarViews();
  }, 40);
}

export function startSchoolCalendarUi() {
  ensureSchoolCalendarStyles();
  scheduleDecoration();
  new MutationObserver(scheduleDecoration).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
