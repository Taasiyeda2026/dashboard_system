/**
 * mini-calendar.js — compact month calendar for My Reports.
 * Calendar cells show only the day number and a small attendance indicator.
 * TODAY is highlighted without changing the cell size.
 */

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * @param {number}   year
 * @param {number}   month             1-based
 * @param {Array}    records           attendance records for this month
 * @param {Function} [onDayClick]      (dateStr) => void — day with records clicked
 * @param {Function} [onEmptyDayClick] (dateStr) => void — empty day clicked
 * @param {string}   [variant]         extra modifier class
 * @returns {{ wrap: HTMLElement, clearSelection: () => void }}
 */
export function createMiniCalendar({ year, month, records = [], onDayClick, onEmptyDayClick, variant = '' } = {}) {
  const pad = (n) => String(n).padStart(2, '0');

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const reportCountByDate = new Map();
  for (const record of records) {
    if (!record?.report_date) continue;
    reportCountByDate.set(record.report_date, (reportCountByDate.get(record.report_date) || 0) + 1);
  }

  const wrap = document.createElement('div');
  wrap.className = 'av2-cal' + (variant ? ` av2-cal--${variant}` : '');

  const header = document.createElement('div');
  header.className = 'av2-cal__header';
  for (const dayName of DAY_NAMES) {
    const cell = document.createElement('div');
    cell.className = 'av2-cal__day-name';
    if (dayName === 'שבת') cell.classList.add('av2-cal__day-name--saturday');
    cell.textContent = dayName;
    header.append(cell);
  }

  const grid = document.createElement('div');
  grid.className = 'av2-cal__grid';

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startDow = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = lastDay.getDate();

  let selectedCell = null;
  let gridIndex = 0;

  const appendBlankCell = () => {
    const empty = document.createElement('div');
    empty.className = 'av2-cal__cell av2-cal__cell--empty';
    if (gridIndex % 7 === 6) empty.classList.add('av2-cal__cell--saturday');
    grid.append(empty);
    gridIndex += 1;
  };

  for (let i = 0; i < startDow; i++) appendBlankCell();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const count = reportCountByDate.get(dateStr) || 0;
    const isToday = dateStr === todayStr;
    const isSaturday = new Date(year, month - 1, day).getDay() === 6;

    const cell = document.createElement('div');
    cell.className = 'av2-cal__cell' +
      (isToday ? ' av2-cal__cell--today' : '') +
      (count ? ' av2-cal__cell--has-record' : '') +
      (isSaturday ? ' av2-cal__cell--saturday' : '');

    if (isToday) cell.setAttribute('aria-current', 'date');

    const num = document.createElement('span');
    num.className = 'av2-cal__day-num';
    num.textContent = String(day);
    cell.append(num);

    if (count > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'av2-cal__presence-dot';
      indicator.setAttribute('aria-hidden', 'true');
      cell.append(indicator);
    }

    if (count > 0 && onDayClick) {
      cell.classList.add('av2-cal__cell--clickable');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${day} בחודש — ${count} ${count === 1 ? 'דיווח נוכחות' : 'דיווחי נוכחות'}`);

      const select = () => {
        if (selectedCell) selectedCell.classList.remove('av2-cal__cell--selected');
        cell.classList.add('av2-cal__cell--selected');
        selectedCell = cell;
        onDayClick(dateStr);
      };

      cell.addEventListener('click', select);
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
    } else if (!count && onEmptyDayClick) {
      cell.classList.add('av2-cal__cell--empty-clickable');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${day} בחודש — אין דיווח נוכחות, לחץ להוספה`);
      cell.addEventListener('click', () => onEmptyDayClick(dateStr));
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEmptyDayClick(dateStr);
        }
      });
    }

    grid.append(cell);
    gridIndex += 1;
  }

  while (gridIndex % 7 !== 0) appendBlankCell();

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
