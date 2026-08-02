import { loadTeamCalendarRows } from './team-calendar-data.js';

const HEBREW_MONTH_INDEX = new Map([
  ['ינואר', 1], ['פברואר', 2], ['מרץ', 3], ['אפריל', 4], ['מאי', 5], ['יוני', 6],
  ['יולי', 7], ['אוגוסט', 8], ['ספטמבר', 9], ['אוקטובר', 10], ['נובמבר', 11], ['דצמבר', 12]
]);

const TYPE_ICON = Object.freeze({
  task: '✓',
  vacation: 'חופש',
  event: 'אירוע',
  training: 'הכשרה',
  milestone: 'יעד'
});

let decorationTimer = null;

function ensureStyles() {
  if (document.getElementById('team-calendar-style')) return;
  const style = document.createElement('style');
  style.id = 'team-calendar-style';
  style.textContent = `
    #app .team-calendar-list {
      display: grid;
      gap: 2px;
      width: 100%;
      margin-top: 3px;
      min-width: 0;
    }
    #app .team-calendar-item {
      display: block;
      min-width: 0;
      padding: 2px 4px;
      border-radius: 5px;
      font-size: .56rem;
      line-height: 1.2;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
      background: rgba(14, 116, 144, .08);
      border-inline-start: 3px solid rgba(14, 116, 144, .55);
    }
    #app .team-calendar-item[data-event-type="vacation"] {
      background: rgba(217, 119, 6, .09);
      border-inline-start-color: rgba(217, 119, 6, .65);
    }
    #app .team-calendar-item[data-event-type="event"],
    #app .team-calendar-item[data-event-type="training"] {
      background: rgba(124, 58, 237, .08);
      border-inline-start-color: rgba(124, 58, 237, .58);
    }
    #app .team-calendar-more {
      font-size: .55rem;
      font-weight: 700;
      padding-inline: 4px;
    }
    #app .ds-week-col__head .team-calendar-list {
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);
}

function displayedMonthSpec() {
  const label = document.querySelector('#app nav[aria-label="ניווט חודשי"] .ds-cal-nav__label');
  const labelText = String(label?.textContent || '').replace(/\s+/g, ' ').trim();
  for (const [monthName, month] of HEBREW_MONTH_INDEX.entries()) {
    const match = new RegExp(`${monthName}\\s+(\\d{4})`).exec(labelText);
    if (match) return { year: Number(match[1]), month };
  }
  return null;
}

function eventsForDate(rows, isoDate) {
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row.event_date || '') === isoDate);
}

function eventLine(row) {
  const title = String(row.title || '').trim();
  const owner = String(row.owner_name || '').trim();
  const type = String(row.event_type || 'task').trim();
  const icon = TYPE_ICON[type] || TYPE_ICON.task;
  const ownerAlreadyShown = owner && title.includes(owner);
  return `${icon} ${title}${owner && !ownerAlreadyShown ? ` · ${owner}` : ''}`.trim();
}

function eventSignature(rows, maxVisible) {
  return JSON.stringify({
    lines: rows.slice(0, maxVisible).map((row) => [eventLine(row), String(row.event_type || 'task')]),
    remaining: Math.max(rows.length - maxVisible, 0)
  });
}

function renderEventList(container, rows, { maxVisible = 4, scope = 'month' } = {}) {
  let list = container.querySelector(`[data-team-calendar-label="${scope}"]`);
  if (!rows.length) {
    list?.remove();
    return;
  }

  if (!list) {
    list = document.createElement('div');
    list.className = 'team-calendar-list';
    list.dataset.teamCalendarLabel = scope;
    const meta = container.querySelector?.('.ds-interactive-card__meta');
    if (meta) container.insertBefore(list, meta);
    else container.appendChild(list);
  }

  const signature = eventSignature(rows, maxVisible);
  if (list.dataset.teamCalendarSignature === signature) return;
  list.dataset.teamCalendarSignature = signature;

  const visibleRows = rows.slice(0, maxVisible);
  const fragment = document.createDocumentFragment();
  visibleRows.forEach((row) => {
    const item = document.createElement('span');
    item.className = 'team-calendar-item';
    item.dataset.eventType = String(row.event_type || 'task');
    item.textContent = eventLine(row);
    fragment.appendChild(item);
  });

  const remaining = rows.length - visibleRows.length;
  if (remaining > 0) {
    const more = document.createElement('span');
    more.className = 'team-calendar-more';
    more.textContent = `ועוד ${remaining}`;
    fragment.appendChild(more);
  }

  list.replaceChildren(fragment);
  list.title = rows.map(eventLine).join('\n');
}

function decorateMonth(rows) {
  const spec = displayedMonthSpec();
  if (!spec) return;

  document.querySelectorAll('#app .ds-cal-grid .ds-cal-slot-hit:not(.is-other-month)').forEach((slot) => {
    const card = slot.querySelector('.ds-interactive-card--day-cell');
    const day = Number(card?.querySelector('.ds-interactive-card__title')?.textContent || '');
    if (!card || !Number.isInteger(day) || day < 1 || day > 31) return;
    const isoDate = `${spec.year}-${String(spec.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    renderEventList(card, eventsForDate(rows, isoDate), { maxVisible: 4, scope: 'month' });
  });
}

function decorateWeek(rows) {
  document.querySelectorAll('#app .ds-week-col[aria-label]').forEach((column) => {
    const isoDate = String(column.getAttribute('aria-label') || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;
    const header = column.querySelector('.ds-week-col__head');
    if (!header) return;
    renderEventList(header, eventsForDate(rows, isoDate), { maxVisible: 6, scope: 'week' });
  });
}

async function decorateTeamCalendarViews() {
  ensureStyles();
  const rows = await loadTeamCalendarRows();
  decorateMonth(rows);
  decorateWeek(rows);
}

function scheduleDecoration() {
  clearTimeout(decorationTimer);
  decorationTimer = setTimeout(() => {
    decorationTimer = null;
    void decorateTeamCalendarViews();
  }, 60);
}

export function startTeamCalendarUi() {
  if (globalThis.__TEAM_CALENDAR_UI_STARTED__) return;
  globalThis.__TEAM_CALENDAR_UI_STARTED__ = true;
  ensureStyles();
  scheduleDecoration();
  new MutationObserver(scheduleDecoration).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
