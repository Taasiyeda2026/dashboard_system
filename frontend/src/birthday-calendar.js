import './styles/birthday-calendar.css';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const HEBREW_MONTH_INDEX = new Map([
  ['ינואר', 1], ['פברואר', 2], ['מרץ', 3], ['אפריל', 4], ['מאי', 5], ['יוני', 6],
  ['יולי', 7], ['אוגוסט', 8], ['ספטמבר', 9], ['אוקטובר', 10], ['נובמבר', 11], ['דצמבר', 12]
]);

let cachedBirthdays = null;
let birthdaysPromise = null;
let decorationTimer = null;

async function loadActiveBirthdays() {
  if (cachedBirthdays) return cachedBirthdays;
  if (birthdaysPromise) return birthdaysPromise;

  birthdaysPromise = (async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('employee_birthdays')
      .select('employee_name,birth_day,birth_month,display_order')
      .eq('is_active', true)
      .order('birth_month', { ascending: true })
      .order('birth_day', { ascending: true })
      .order('display_order', { ascending: true })
      .order('employee_name', { ascending: true });

    if (error) {
      console.warn('[birthday-calendar] read failed', {
        code: error.code || '',
        message: error.message || ''
      });
      return [];
    }

    cachedBirthdays = Array.isArray(data) ? data : [];
    return cachedBirthdays;
  })().finally(() => {
    birthdaysPromise = null;
  });

  return birthdaysPromise;
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

function birthdaysForDate(rows, month, day) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    Number(row.birth_month) === Number(month) && Number(row.birth_day) === Number(day)
  ));
}

function birthdayLabel(rows) {
  const names = rows.map((row) => String(row.employee_name || '').trim()).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `🎂 יום הולדת ל${names[0]}`;
  return `🎂 ימי הולדת: ${names.join(' · ')}`;
}

function setMonthBirthdayLabel(card, rows) {
  let label = card.querySelector('[data-birthday-calendar-label="month"]');
  if (!rows.length) {
    label?.remove();
    card.classList.remove('is-birthday-calendar-day');
    return;
  }

  if (!label) {
    label = document.createElement('span');
    label.className = 'birthday-calendar-label birthday-calendar-label--month';
    label.dataset.birthdayCalendarLabel = 'month';
    const meta = card.querySelector('.ds-interactive-card__meta');
    if (meta) card.insertBefore(label, meta);
    else card.appendChild(label);
  }

  const text = birthdayLabel(rows);
  if (label.textContent !== text) label.textContent = text;
  label.title = rows.map((row) => `יום הולדת ל${row.employee_name}`).join('\n');
  card.classList.add('is-birthday-calendar-day');
}

function decorateMonth(rows) {
  const spec = displayedMonthSpec();
  if (!spec) return;

  document.querySelectorAll('#app .ds-cal-grid .ds-cal-slot-hit:not(.is-other-month)').forEach((slot) => {
    const card = slot.querySelector('.ds-interactive-card--day-cell');
    const day = Number(card?.querySelector('.ds-interactive-card__title')?.textContent || '');
    if (!card || !Number.isInteger(day) || day < 1 || day > 31) return;
    setMonthBirthdayLabel(card, birthdaysForDate(rows, spec.month, day));
  });
}

function setWeekBirthdayLabel(header, rows) {
  let label = header.querySelector('[data-birthday-calendar-label="week"]');
  if (!rows.length) {
    label?.remove();
    return;
  }

  if (!label) {
    label = document.createElement('span');
    label.className = 'birthday-calendar-label birthday-calendar-label--week ds-week-col__birthday';
    label.dataset.birthdayCalendarLabel = 'week';
    header.appendChild(label);
  }

  const text = birthdayLabel(rows);
  if (label.textContent !== text) label.textContent = text;
  label.title = rows.map((row) => `יום הולדת ל${row.employee_name}`).join('\n');
}

function decorateWeek(rows) {
  document.querySelectorAll('#app .ds-week-col[aria-label]').forEach((column) => {
    const isoDate = String(column.getAttribute('aria-label') || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;

    const [, month, day] = isoDate.split('-').map(Number);
    const header = column.querySelector('.ds-week-col__head');
    if (!header) return;
    setWeekBirthdayLabel(header, birthdaysForDate(rows, month, day));
  });
}

function clearBirthdayCalendarLabels() {
  document.querySelectorAll('#app [data-birthday-calendar-label]').forEach((label) => label.remove());
  document.querySelectorAll('#app .is-birthday-calendar-day').forEach((card) => {
    card.classList.remove('is-birthday-calendar-day');
  });
}

async function decorateBirthdayCalendarViews() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) return;
  const rows = await loadActiveBirthdays();
  decorateMonth(rows);
  decorateWeek(rows);
}

function scheduleDecoration() {
  clearTimeout(decorationTimer);
  decorationTimer = setTimeout(() => {
    decorationTimer = null;
    void decorateBirthdayCalendarViews();
  }, 50);
}

export function startBirthdayCalendarUi() {
  if (!supabase || globalThis.__BIRTHDAY_CALENDAR_UI_STARTED__) return;
  globalThis.__BIRTHDAY_CALENDAR_UI_STARTED__ = true;

  waitForSupabaseAuthSession({ timeoutMs: 3000 })
    .then((session) => {
      if (session?.user?.id) scheduleDecoration();
    })
    .catch(() => {});

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user?.id) {
      cachedBirthdays = null;
      clearBirthdayCalendarLabels();
      return;
    }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      scheduleDecoration();
    }
  });

  new MutationObserver(scheduleDecoration).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

startBirthdayCalendarUi();