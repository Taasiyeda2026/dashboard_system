/**
 * mini-calendar.js — premium compact month calendar.
 * Used by My Reports. Shows activity summaries inside day cells,
 * highlights TODAY, and supports clicking empty days to add a report.
 */

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * @param {number}   year
 * @param {number}   month          1-based
 * @param {Array}    records        full attendance records for this month
 * @param {Function} [onDayClick]   (dateStr) => void — day with records clicked
 * @param {Function} [onEmptyDayClick] (dateStr) => void — empty day clicked
 * @param {string}   [variant]      extra modifier class
 * @returns {{ wrap: HTMLElement, clearSelection: () => void }}
 */
export function createMiniCalendar({ year, month, records = [], onDayClick, onEmptyDayClick, variant = '' } = {}) {
  const pad = (n) => String(n).padStart(2, '0');

  // Today's date string
  const td = new Date();
  const todayStr = `${td.getFullYear()}-${pad(td.getMonth() + 1)}-${pad(td.getDate())}`;

  // Group + sort records by date
  const byDate = new Map();
  for (const r of records) {
    if (!byDate.has(r.report_date)) byDate.set(r.report_date, []);
    byDate.get(r.report_date).push(r);
  }
  for (const dayRecs of byDate.values()) {
    dayRecs.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
  }

  const wrap = document.createElement('div');
  wrap.className = 'av2-cal' + (variant ? ` av2-cal--${variant}` : '');

  // Day-name header row
  const header = document.createElement('div');
  header.className = 'av2-cal__header';
  for (const d of DAY_NAMES) {
    const cell = document.createElement('div');
    cell.className = 'av2-cal__day-name';
    cell.textContent = d;
    header.append(cell);
  }

  const grid = document.createElement('div');
  grid.className = 'av2-cal__grid';

  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const startDow = firstDay.getDay(); // 0 = Sun

  // Empty lead cells
  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement('div');
    empty.className = 'av2-cal__cell av2-cal__cell--empty';
    grid.append(empty);
  }

  let selectedCell = null;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const dayRecs = byDate.get(dateStr) || [];
    const count   = dayRecs.length;
    const isToday = dateStr === todayStr;

    const cell = document.createElement('div');
    cell.className = 'av2-cal__cell' +
      (isToday ? ' av2-cal__cell--today' : '') +
      (count ? ' av2-cal__cell--has-record' : '');

    // Day number row
    const numRow = document.createElement('div');
    numRow.className = 'av2-cal__day-row';
    const num = document.createElement('span');
    num.className = 'av2-cal__day-num';
    num.textContent = String(day);
    numRow.append(num);
    if (isToday) {
      const todayBadge = document.createElement('span');
      todayBadge.className = 'av2-cal__today-badge';
      todayBadge.textContent = 'היום';
      numRow.append(todayBadge);
    }
    cell.append(numRow);

    if (count > 0) {
      // Event pills
      const eventsWrap = document.createElement('div');
      eventsWrap.className = 'av2-cal__events';

      const visibleRecs = dayRecs.slice(0, 2);
      for (const r of visibleRecs) {
        const pill = buildEventPill(r);
        eventsWrap.append(pill);
      }
      if (count > 2) {
        const more = document.createElement('div');
        more.className = 'av2-cal__event-more';
        more.textContent = `+${count - 2} נוספ${count - 2 === 1 ? 'ים' : 'ות'}`;
        eventsWrap.append(more);
      }
      cell.append(eventsWrap);

      if (onDayClick) {
        cell.classList.add('av2-cal__cell--clickable');
        cell.tabIndex = 0;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `${day} — ${count} דיווחים`);
        const select = () => {
          if (selectedCell) selectedCell.classList.remove('av2-cal__cell--selected');
          cell.classList.add('av2-cal__cell--selected');
          selectedCell = cell;
          onDayClick(dateStr);
        };
        cell.addEventListener('click', select);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
        });
      }
    } else if (onEmptyDayClick) {
      cell.classList.add('av2-cal__cell--empty-clickable');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${day} — אין דיווחים, לחץ להוספה`);
      cell.addEventListener('click', () => onEmptyDayClick(dateStr));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEmptyDayClick(dateStr); }
      });
    }

    grid.append(cell);
  }

  wrap.append(header, grid);

  return {
    wrap,
    clearSelection() {
      if (selectedCell) {
        selectedCell.classList.remove('av2-cal__cell--selected');
        selectedCell = null;
      }
    },
  };
}

function buildEventPill(record) {
  const pill = document.createElement('div');
  pill.className = 'av2-cal__event-pill';

  const name = record.activity_name_snapshot || record.activity_type || 'דיווח';
  const nameEl = document.createElement('span');
  nameEl.className = 'av2-cal__event-name';
  nameEl.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
  pill.append(nameEl);

  const s = String(record.start_time || '').slice(0, 5);
  const e = String(record.end_time   || '').slice(0, 5);
  if (s) {
    const timeEl = document.createElement('span');
    timeEl.className = 'av2-cal__event-time';
    timeEl.textContent = e ? `${s}–${e}` : s;
    pill.append(timeEl);
  }

  return pill;
}
