import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsCard, dsInteractiveCard } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityRowDetailHtml } from './shared/activity-detail-html.js';

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר'
];

/** כותרות ימים — עמודה ראשונה = יום ראשון (תואם ל־getDay()). */
const HEBREW_WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function localYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYm(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) };
}

function inferMonthSpec(data) {
  const parsed = parseYm(data?.month);
  if (parsed) return parsed;
  const first = data?.cells?.[0]?.date;
  if (first && /^\d{4}-\d{2}-\d{2}$/.test(String(first))) {
    return { y: Number(first.slice(0, 4)), mo: Number(first.slice(5, 7)) };
  }
  const d = new Date();
  return { y: d.getFullYear(), mo: d.getMonth() + 1 };
}

function daysInMonth1Based(y, mo) {
  return new Date(y, mo, 0).getDate();
}

function monthTitleHebrew(spec) {
  if (!spec || spec.mo < 1 || spec.mo > 12) return 'חודש';
  return `${HEBREW_MONTHS[spec.mo - 1]} ${spec.y}`;
}

function cellMapFromCells(cells) {
  const map = {};
  for (const c of cells) {
    const d = Number(c?.day);
    if (!Number.isFinite(d)) continue;
    map[d] = c;
  }
  return map;
}

function padDayKey(y, mo, dayNum) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
}

function dayNeedsAttention(items) {
  const list = Array.isArray(items) ? items : [];
  return list.some((it) => {
    const id1 = String(it?.emp_id || '').trim();
    const id2 = String(it?.emp_id_2 || '').trim();
    return !id1 && !id2;
  });
}

function activityDotsMeta(n) {
  if (n <= 0) return '';
  if (n <= 5) return '●'.repeat(n);
  return `●●●●● +${n - 5}`;
}

function monthDayDrawerBody(cell, hideEmpIds) {
  const items = Array.isArray(cell?.items) ? cell.items : [];
  if (!items.length) {
    return `<p class="ds-muted">אין פעילויות מתמשכות ביום זה.</p><p class="ds-muted">תאריך: ${escapeHtml(cell?.date || '')}</p>`;
  }
  const blocks = items
    .map(
      (it) => `
    <section class="ds-cal-drawer-block" aria-label="${escapeHtml(it.activity_name || 'פעילות')}">
      <h3 class="ds-cal-drawer-block__title">${escapeHtml(it.activity_name || 'פעילות')}</h3>
      ${activityRowDetailHtml(it, { privateNote: null, hideEmpIds: !!hideEmpIds })}
    </section>`
    )
    .join('');
  return `<div class="ds-cal-drawer-stack">${blocks}</div>`;
}

function shiftMonthYm(ym, delta) {
  const d = ym && /^\d{4}-\d{2}$/.test(ym) ? new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1) : new Date();
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const monthScreen = {
  load: ({ api, state }) => {
    const ym = state.monthYm && /^\d{4}-\d{2}$/.test(state.monthYm) ? state.monthYm : '';
    return api.month(ym ? { ym } : {});
  },
  render(data, { state }) {
    const spec = inferMonthSpec(data || {});
    const y = spec.y;
    const mo = spec.mo;
    const dim = daysInMonth1Based(y, mo);
    const first = new Date(y, mo - 1, 1);
    const firstWeekday = first.getDay();
    const totalUsed = firstWeekday + dim;
    const rowCount = Math.ceil(totalUsed / 7);
    const slotCount = rowCount * 7;

    const safeCells = Array.isArray(data?.cells) ? data.cells : [];
    const byDay = cellMapFromCells(safeCells);
    const todayIso = localYmd();
    const hideSaturday = !!data?.hide_saturday;
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    const weekdayRow = HEBREW_WEEKDAY_SHORT.map(
      (label) => `<div class="ds-cal-wd" role="columnheader">${escapeHtml(label)}</div>`
    ).join('');

    const slots = [];
    for (let i = 0; i < slotCount; i += 1) {
      if (i < firstWeekday || i >= firstWeekday + dim) {
        slots.push('<div class="ds-cal-slot ds-cal-slot--empty" aria-hidden="true"></div>');
        continue;
      }
      const dayNum = i - firstWeekday + 1;
      const cellDate = new Date(y, mo - 1, dayNum);
      if (hideSaturday && cellDate.getDay() === 6) {
        slots.push('<div class="ds-cal-slot ds-cal-slot--shabbat-off" aria-hidden="true"></div>');
        continue;
      }
      const cell = byDay[dayNum] || {
        day: dayNum,
        date: padDayKey(y, mo, dayNum),
        items: []
      };
      const n = Array.isArray(cell.items) ? cell.items.length : 0;
      const isToday = cell.date === todayIso;
      const warn = dayNeedsAttention(cell.items);
      const extra = [isToday ? 'is-cal-today' : '', warn ? 'is-month-warn' : ''].filter(Boolean).join(' ');
      const subtitle = n > 0 ? activityDotsMeta(n) : '';
      const meta = n > 0 ? `${n} פעילויות` : 'ללא';
      const hay = (Array.isArray(cell.items) ? cell.items : [])
        .map((it) =>
          [it.activity_name, it.RowID, it.emp_id, it.emp_id_2, it.instructor_name, it.instructor_name_2].filter(Boolean).join(' ')
        )
        .join(' ');
      slots.push(
        `<div class="ds-cal-slot-hit" data-list-item data-search="${escapeHtml(hay)}" data-filter="">
        ${dsInteractiveCard({
          variant: 'day-cell',
          action: `monthcell|${dayNum}`,
          title: String(dayNum),
          subtitle,
          meta,
          extraClass: extra.trim()
        })}
      </div>`
      );
    }

    const gridHtml = `
      <div class="ds-cal-wrap${hideSaturday ? ' ds-cal-wrap--hide-shabbat' : ''}" dir="rtl">
        <div class="ds-cal-weekdays" role="row">${weekdayRow}</div>
        <div class="ds-cal-grid" role="grid" aria-label="לוח חודש">${slots.join('')}</div>
      </div>`;

    const currentYm = data?.month || `${y}-${String(mo).padStart(2, '0')}`;
    const monthTitle = monthTitleHebrew(spec);

    return dsScreenStack(`
      ${dsPageHeader('חודש', 'לוח חודש — לחיצה על יום לפתיחת פירוט')}
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט חודשי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-month-prev aria-label="חודש קודם">→ חודש קודם</button>
        <span class="ds-cal-nav__label">${escapeHtml(monthTitle)}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-month-next aria-label="חודש הבא">חודש הבא ←</button>
      </nav>
      ${dsPageListToolsBar({ searchPlaceholder: 'חיפוש לפי שם פעילות ביום…', filters: [] })}
      ${dsCard({
        title: 'לוח חודשי',
        badge: `${dim} ימים · ${escapeHtml(currentYm)}`,
        body: gridHtml,
        padded: false
      })}
    `);
  },
  bind({ root, ui, data, state, rerender }) {
    bindPageListTools(root, { mode: 'dim' });
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    const currentYm = data?.month || '';
    root.querySelector('[data-month-prev]')?.addEventListener('click', () => {
      state.monthYm = shiftMonthYm(currentYm || state.monthYm, -1);
      rerender?.();
    });
    root.querySelector('[data-month-next]')?.addEventListener('click', () => {
      state.monthYm = shiftMonthYm(currentYm || state.monthYm, 1);
      rerender?.();
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('monthcell|')) return;
      const dayNum = action.split('|')[1];
      const cells = Array.isArray(data?.cells) ? data.cells : [];
      const spec = inferMonthSpec(data || {});
      const dim = daysInMonth1Based(spec.y, spec.mo);
      const d = Number(dayNum);
      if (!Number.isFinite(d) || d < 1 || d > dim) return;

      const byDay = cellMapFromCells(cells);
      const cell = byDay[d] || {
        day: d,
        date: padDayKey(spec.y, spec.mo, d),
        items: []
      };
      const n = Array.isArray(cell.items) ? cell.items.length : 0;
      ui.openDrawer({
        title: `יום ${d} · ${cell.date || ''}`,
        content: `<p class="ds-muted">${n} פעילויות ביום זה</p>${monthDayDrawerBody(cell, hideEmpIds)}`
      });
    });
  }
};
