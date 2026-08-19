import { getMonthRecords } from './services/attendance.service.js';

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

let scheduled = false;

export function initRound3Ui(root = document.getElementById('app')) {
  if (!root) return;

  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  scheduleEnhancement();

  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceHome(root).catch(() => {});
      enhanceReports(root);
      enhanceTimePickers(root);
      enhanceOpenModals();
    });
  }
}

async function enhanceHome(root) {
  const home = root.querySelector('.av2-home');
  if (!home) return;

  home.classList.add('av2-round3-screen');
  enhanceHomeTitle(home);

  const context = readHomeContext(home);
  if (!context) return;

  const key = `${context.empId}:${context.year}-${context.month}`;
  if (home.dataset.round3Key === key) {
    refreshHomeStatus(home);
    return;
  }

  home.dataset.round3Key = key;
  const inner = home.querySelector('.av2-home__inner');
  const approvalCard = home.querySelector('.av2-approval-card');
  const stats = home.querySelector('.av2-stats-grid');
  if (!inner || !approvalCard || !stats) return;

  let workspace = home.querySelector('.av2-home__workspace');
  if (!workspace) {
    workspace = document.createElement('div');
    workspace.className = 'av2-home__workspace';
    const calendarCard = document.createElement('section');
    calendarCard.className = 'av2-dashboard-card av2-home-calendar';
    calendarCard.innerHTML = '<div class="av2-round3-loading">טוען לוח שנה…</div>';
    workspace.append(calendarCard, approvalCard);
    stats.insertAdjacentElement('afterend', workspace);

    const recentCard = document.createElement('section');
    recentCard.className = 'av2-dashboard-card av2-home-recent';
    recentCard.innerHTML = '<div class="av2-round3-loading">טוען דיווחים…</div>';
    workspace.insertAdjacentElement('afterend', recentCard);
  }

  const calendarCard = workspace.querySelector('.av2-home-calendar');
  const recentCard = home.querySelector('.av2-home-recent');

  try {
    const records = await getMonthRecords(context.empId, context.year, context.month);
    renderHomeCalendar(calendarCard, recentCard, records, context);
    renderRecentReports(recentCard, records, context, null);
  } catch (error) {
    if (calendarCard) calendarCard.innerHTML = '<p class="av2-round3-muted">לוח השנה אינו זמין כרגע.</p>';
    if (recentCard) recentCard.innerHTML = '<p class="av2-round3-muted">לא ניתן לטעון את רשימת הדיווחים.</p>';
  }

  refreshHomeStatus(home);
}

function enhanceHomeTitle(home) {
  const title = home.querySelector('.av2-home__page-title');
  if (!title || title.closest('.av2-home__title-band')) return;
  const band = document.createElement('div');
  band.className = 'av2-home__title-band';
  title.replaceWith(band);
  band.append(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'av2-home__subtitle';
  subtitle.textContent = 'ריכוז הדיווחים והמצב החודשי שלך';
  band.append(subtitle);
}

function refreshHomeStatus(home) {
  const band = home.querySelector('.av2-home__title-band');
  const sourceBadge = home.querySelector('.av2-approval-card .av2-badge');
  if (!band || !sourceBadge) return;
  let chip = band.querySelector('.av2-home__status-chip');
  if (!chip) {
    chip = document.createElement('span');
    chip.className = 'av2-home__status-chip';
    band.append(chip);
  }
  chip.textContent = sourceBadge.textContent || '';
  chip.className = `av2-home__status-chip ${sourceBadge.classList.contains('av2-badge--success') ? 'is-success' : sourceBadge.classList.contains('av2-badge--warning') ? 'is-warning' : ''}`;
}

function readHomeContext(home) {
  const empText = home.querySelector('.av2-home__emp')?.textContent || '';
  const label = home.querySelector('.av2-month-nav__label')?.textContent?.trim() || '';
  const empId = (empText.match(/\d+/) || [])[0];
  const yearMatch = label.match(/(20\d{2})/);
  const month = HEBREW_MONTHS.findIndex((name) => label.includes(name)) + 1;
  if (!empId || !yearMatch || month < 1) return null;
  return { empId, year: Number(yearMatch[1]), month, label };
}

function renderHomeCalendar(card, recentCard, records, context) {
  if (!card) return;
  card.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'av2-card-heading';
  const text = document.createElement('div');
  text.innerHTML = `<h2>לוח חודש</h2><p>${escapeHtml(context.label)}</p>`;
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'av2-btn av2-btn--link av2-calendar-clear';
  clearBtn.textContent = 'כל החודש';
  clearBtn.hidden = true;
  header.append(text, clearBtn);

  const calendar = document.createElement('div');
  calendar.className = 'av2-round3-calendar';
  const names = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  names.forEach((name) => {
    const el = document.createElement('div');
    el.className = 'av2-round3-calendar__weekday';
    el.textContent = name;
    calendar.append(el);
  });

  const counts = new Map();
  records.forEach((record) => counts.set(record.report_date, (counts.get(record.report_date) || 0) + 1));
  const first = new Date(context.year, context.month - 1, 1);
  const last = new Date(context.year, context.month, 0).getDate();
  for (let i = 0; i < first.getDay(); i += 1) {
    const spacer = document.createElement('span');
    spacer.className = 'av2-round3-calendar__spacer';
    calendar.append(spacer);
  }

  for (let day = 1; day <= last; day += 1) {
    const date = `${context.year}-${String(context.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = counts.get(date) || 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `av2-round3-calendar__day${count ? ' has-reports' : ''}`;
    btn.dataset.date = date;
    btn.innerHTML = `<span>${day}</span>${count ? `<small>${count}</small>` : ''}`;
    btn.setAttribute('aria-label', count ? `${day}, ${count} דיווחים` : `${day}, ללא דיווחים`);
    btn.addEventListener('click', () => {
      card.querySelectorAll('.av2-round3-calendar__day.is-selected').forEach((el) => el.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      clearBtn.hidden = false;
      renderRecentReports(recentCard, records, context, date);
    });
    calendar.append(btn);
  }

  clearBtn.addEventListener('click', () => {
    card.querySelectorAll('.av2-round3-calendar__day.is-selected').forEach((el) => el.classList.remove('is-selected'));
    clearBtn.hidden = true;
    renderRecentReports(recentCard, records, context, null);
  });

  card.append(header, calendar);
}

function renderRecentReports(card, records, context, selectedDate) {
  if (!card) return;
  card.innerHTML = '';

  const filtered = selectedDate ? records.filter((r) => r.report_date === selectedDate) : [...records];
  filtered.sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)) || String(b.start_time || '').localeCompare(String(a.start_time || '')));
  const visible = selectedDate ? filtered : filtered.slice(0, 5);

  const header = document.createElement('div');
  header.className = 'av2-card-heading';
  const titleBox = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = selectedDate ? `דיווחים ל-${formatDate(selectedDate)}` : 'הדיווחים האחרונים';
  const subtitle = document.createElement('p');
  subtitle.textContent = selectedDate ? `${filtered.length} דיווחים ביום שנבחר` : `${records.length} דיווחים בחודש`;
  titleBox.append(title, subtitle);

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'av2-btn av2-btn--link';
  allBtn.textContent = 'לכל הדיווחים ←';
  allBtn.addEventListener('click', () => {
    const source = document.querySelector('.av2-approval-inner .av2-btn--link');
    source?.click();
  });
  header.append(titleBox, allBtn);

  const list = document.createElement('div');
  list.className = 'av2-home-report-list';
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'av2-round3-empty';
    empty.textContent = selectedDate ? 'אין דיווחים ביום הזה.' : `אין עדיין דיווחים ב${context.label}.`;
    list.append(empty);
  } else {
    visible.forEach((record) => list.append(buildHomeReportRow(record)));
  }

  card.append(header, list);
}

function buildHomeReportRow(record) {
  const row = document.createElement('div');
  row.className = 'av2-home-report-row';
  const activity = record.activity_name_snapshot || record.activity_type || 'דיווח';
  const place = record.school_name_snapshot || record.authority_name_snapshot || '';
  row.innerHTML = `
    <div class="av2-home-report-row__date"><strong>${escapeHtml(formatDate(record.report_date))}</strong><span>${escapeHtml(dayName(record.report_date))}</span></div>
    <div class="av2-home-report-row__main"><strong>${escapeHtml(activity)}</strong><span>${escapeHtml(place)}</span></div>
    <div class="av2-home-report-row__time"><strong>${escapeHtml(formatTime(record.start_time))}–${escapeHtml(formatTime(record.end_time))}</strong><span>${formatHours(record.total_hours)} שעות</span></div>
    <div class="av2-home-report-row__meta">${Number(record.roundtrip_km || 0) > 0 ? `${Number(record.roundtrip_km).toFixed(0)} ק״מ` : ''}</div>
  `;
  return row;
}

function enhanceReports(root) {
  const reports = root.querySelector('.av2-reports');
  if (!reports) return;
  reports.classList.add('av2-round3-screen');

  const table = reports.querySelector('.av2-reports__table');
  const calendar = reports.querySelector('.av2-cal');
  if (!table || !calendar) return;

  table.classList.add('av2-reports__cards');
  const rows = [...table.querySelectorAll('tbody > tr:not(.av2-reports__total-row)')];
  rows.forEach((row) => enhanceReportRow(row));
  enhanceReportsCalendar(reports, calendar, table, rows);
}

function enhanceReportRow(row) {
  if (row.dataset.round3Enhanced === '1') return;
  row.dataset.round3Enhanced = '1';
  row.classList.add('av2-report-card-row');
  const cells = [...row.cells];
  const labels = ['תאריך', 'התחלה', 'סיום', 'שעות', 'סוג פעילות', 'פעילות', 'בית ספר', 'רשות', 'ק״מ', 'הוצאות', 'פעולות'];
  cells.forEach((cell, index) => {
    cell.dataset.label = labels[index] || '';
    cell.classList.add(`av2-report-card-row__cell-${index + 1}`);
  });

  const dateText = cells[0]?.textContent || '';
  const match = dateText.match(/(\d{2})[./](\d{2})/);
  if (match) row.dataset.reportDay = String(Number(match[1]));

  row.tabIndex = 0;
  row.setAttribute('aria-expanded', 'false');
  const toggle = () => {
    const expanded = row.classList.toggle('is-expanded');
    row.setAttribute('aria-expanded', String(expanded));
  };
  row.addEventListener('click', (event) => {
    if (event.target.closest('button,a,input,select,label')) return;
    toggle();
  });
  row.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button,a,input,select')) {
      event.preventDefault();
      toggle();
    }
  });
}

function enhanceReportsCalendar(reports, calendar, table, rows) {
  if (calendar.dataset.round3Enhanced === '1') return;
  calendar.dataset.round3Enhanced = '1';

  const tableWrap = table.closest('.av2-reports__table-wrap');
  const filterBar = document.createElement('div');
  filterBar.className = 'av2-reports__day-filter';
  filterBar.hidden = true;
  const filterText = document.createElement('span');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'av2-btn av2-btn--link';
  clear.textContent = 'הצג את כל החודש';
  filterBar.append(filterText, clear);
  tableWrap?.insertAdjacentElement('beforebegin', filterBar);

  const apply = (day) => {
    rows.forEach((row) => { row.hidden = day ? row.dataset.reportDay !== String(day) : false; });
    const total = table.querySelector('.av2-reports__total-row');
    if (total) total.hidden = Boolean(day);
    filterBar.hidden = !day;
    filterText.textContent = day ? `דיווחים ליום ${day} בחודש` : '';
  };

  calendar.querySelectorAll('.av2-cal__cell--has-record').forEach((cell) => {
    const day = Number(cell.querySelector('.av2-cal__day-num')?.textContent || 0);
    if (!day) return;
    cell.classList.add('is-clickable');
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', `הצג דיווחים ליום ${day}`);
    const select = () => {
      calendar.querySelectorAll('.av2-cal__cell.is-selected').forEach((el) => el.classList.remove('is-selected'));
      cell.classList.add('is-selected');
      apply(day);
      tableWrap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    cell.addEventListener('click', select);
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    });
  });

  clear.addEventListener('click', () => {
    calendar.querySelectorAll('.av2-cal__cell.is-selected').forEach((el) => el.classList.remove('is-selected'));
    apply(null);
  });
}

function enhanceTimePickers(root) {
  root.querySelectorAll('.av2-report .av2-time-picker__min').forEach((select) => ensureAllMinutes(select));
  root.querySelectorAll('.av2-report .av2-time-picker').forEach((picker) => picker.classList.add('av2-time-picker--round3'));
}

function enhanceOpenModals() {
  document.querySelectorAll('.av2-modal').forEach((modal) => {
    modal.classList.add('av2-modal--round3');
    const start = modal.querySelector('#edit-start-time[type="time"]');
    const end = modal.querySelector('#edit-end-time[type="time"]');
    if (start) replaceNativeTimeInput(start);
    if (end) replaceNativeTimeInput(end);
  });
}

function replaceNativeTimeInput(input) {
  if (input.dataset.round3Enhanced === '1') return;
  input.dataset.round3Enhanced = '1';
  input.classList.add('av2-time-native-source');

  const picker = document.createElement('div');
  picker.className = 'av2-time-picker av2-time-picker--round3 av2-time-picker--edit';
  const hour = document.createElement('select');
  hour.className = 'av2-time-picker__sel av2-time-picker__hour';
  const sep = document.createElement('span');
  sep.className = 'av2-time-picker__sep';
  sep.textContent = ':';
  const minute = document.createElement('select');
  minute.className = 'av2-time-picker__sel av2-time-picker__min';

  const current = String(input.value || '').slice(0, 5).split(':');
  populateSelect(hour, 24, 'שע׳', current[0]);
  populateSelect(minute, 60, 'דק׳', current[1]);

  const sync = () => {
    if (hour.value === '' || minute.value === '') input.value = '';
    else input.value = `${String(hour.value).padStart(2, '0')}:${String(minute.value).padStart(2, '0')}`;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  hour.addEventListener('change', sync);
  minute.addEventListener('change', sync);

  picker.append(hour, sep, minute);
  input.insertAdjacentElement('afterend', picker);
}

function ensureAllMinutes(select) {
  if (select.dataset.round3Minutes === '1') return;
  select.dataset.round3Minutes = '1';
  const current = select.value;
  populateSelect(select, 60, 'דק׳', current);
}

function populateSelect(select, count, placeholder, current) {
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  ph.disabled = true;
  select.append(ph);
  for (let value = 0; value < count; value += 1) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value).padStart(2, '0');
    select.append(option);
  }
  const normalized = current == null || current === '' ? '' : String(Number(current));
  select.value = normalized;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function dayName(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('he-IL', { weekday: 'short' });
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : '—';
}

function formatHours(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
