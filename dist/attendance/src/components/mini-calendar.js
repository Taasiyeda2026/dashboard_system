/**
 * mini-calendar.js — shared compact month calendar.
 * Used by My Reports so the day-with-records/click-to-filter behavior stays
 * in one implementation.
 */

const DAY_NAMES_SHORT = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\''];

/**
 * @param {number} year
 * @param {number} month          1-based
 * @param {Array}  records        records for this month (each has report_date)
 * @param {Function} [onDayClick] (dateStr) => void — called when a day with
 *                                 records is clicked/activated. Omit to render
 *                                 a non-interactive calendar.
 * @param {string} [variant]      appended as `av2-cal--{variant}` for sizing
 * @returns {{ wrap: HTMLElement, clearSelection: () => void }}
 */
export function createMiniCalendar({ year, month, records = [], onDayClick, variant = '' } = {}) {
  const counts = new Map();
  for (const r of records) counts.set(r.report_date, (counts.get(r.report_date) || 0) + 1);

  const wrap = document.createElement('div');
  wrap.className = 'av2-cal' + (variant ? ` av2-cal--${variant}` : '');

  const header = document.createElement('div');
  header.className = 'av2-cal__header';
  for (const d of DAY_NAMES_SHORT) {
    const cell = document.createElement('div');
    cell.className = 'av2-cal__day-name';
    cell.textContent = d;
    header.append(cell);
  }

  const grid = document.createElement('div');
  grid.className = 'av2-cal__grid';

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startDow = firstDay.getDay(); // 0=Sun

  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement('div');
    empty.className = 'av2-cal__cell av2-cal__cell--empty';
    grid.append(empty);
  }

  const pad = (n) => String(n).padStart(2, '0');
  let selectedCell = null;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const count = counts.get(dateStr) || 0;

    const cell = document.createElement('div');
    cell.className = 'av2-cal__cell' + (count ? ' av2-cal__cell--has-record' : '');

    const num = document.createElement('span');
    num.className = 'av2-cal__day-num';
    num.textContent = String(day);
    cell.append(num);

    if (count) {
      const dot = document.createElement('span');
      dot.className = 'av2-cal__dot';
      cell.append(dot);

      if (onDayClick) {
        cell.classList.add('av2-cal__cell--clickable');
        cell.tabIndex = 0;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `${day}, ${count} דיווחים`);
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
