import { getMonthRecords } from './services/attendance.service.js';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
let scheduled = false;

export function initRound3Ui(root = document.getElementById('app')) {
  if (!root) return;
  const observer = new MutationObserver(() => schedule(root));
  observer.observe(document.body || root, { childList: true, subtree: true });
  schedule(root);
}

function schedule(root) {
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

async function enhanceHome(root) {
  const home = root.querySelector('.av2-home');
  if (!home) return;
  home.classList.add('av2-round3-screen');
  enhanceHomeTitle(home);
  refreshHomeStatus(home);

  const context = readHomeContext(home);
  if (!context) return;
  const key = `${context.empId}:${context.year}-${context.month}`;
  if (home.dataset.round3Key === key) return;
  home.dataset.round3Key = key;

  const stats = home.querySelector('.av2-stats-grid');
  const approvalCard = home.querySelector('.av2-approval-card');
  if (!stats || !approvalCard) return;

  let workspace = home.querySelector('.av2-home__workspace');
  if (!workspace) {
    workspace = document.createElement('div');
    workspace.className = 'av2-home__workspace';
    const calendar = document.createElement('section');
    calendar.className = 'av2-dashboard-card av2-home-calendar';
    calendar.innerHTML = '<div class="av2-round3-loading">טוען לוח שנה…</div>';
    workspace.append(calendar, approvalCard);
    stats.insertAdjacentElement('afterend', workspace);
    const recent = document.createElement('section');
    recent.className = 'av2-dashboard-card av2-home-recent';
    recent.innerHTML = '<div class="av2-round3-loading">טוען דיווחים…</div>';
    workspace.insertAdjacentElement('afterend', recent);
  }

  const calendarCard = workspace.querySelector('.av2-home-calendar');
  const recentCard = home.querySelector('.av2-home-recent');
  try {
    const records = await getMonthRecords(context.empId, context.year, context.month);
    renderHomeCalendar(calendarCard, recentCard, records, context);
    renderRecentReports(recentCard, records, context, null);
  } catch {
    if (calendarCard) calendarCard.innerHTML = '<p class="av2-round3-muted">לוח השנה אינו זמין כרגע.</p>';
    if (recentCard) recentCard.innerHTML = '<p class="av2-round3-muted">לא ניתן לטעון את רשימת הדיווחים.</p>';
  }
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
  const source = home.querySelector('.av2-approval-card .av2-badge');
  if (!band || !source) return;
  let chip = band.querySelector('.av2-home__status-chip');
  if (!chip) {
    chip = document.createElement('span');
    chip.className = 'av2-home__status-chip';
    band.append(chip);
  }
  const text = source.textContent || '';
  const tone = source.classList.contains('av2-badge--success') ? 'success' : source.classList.contains('av2-badge--warning') ? 'warning' : 'neutral';
  if (chip.textContent !== text) chip.textContent = text;
  if (chip.dataset.tone !== tone) {
    chip.dataset.tone = tone;
    chip.className = `av2-home__status-chip${tone === 'success' ? ' is-success' : tone === 'warning' ? ' is-warning' : ''}`;
  }
}

function readHomeContext(home) {
  const empText = home.querySelector('.av2-home__emp')?.textContent || '';
  const label = home.querySelector('.av2-month-nav__label')?.textContent?.trim() || '';
  const empId = (empText.match(/\d+/) || [])[0];
  const year = Number((label.match(/(20\d{2})/) || [])[1]);
  const month = HEBREW_MONTHS.findIndex((name) => label.includes(name)) + 1;
  return empId && year && month > 0 ? { empId, year, month, label } : null;
}

function renderHomeCalendar(card, recentCard, records, context) {
  if (!card) return;
  card.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'av2-card-heading';
  const text = document.createElement('div');
  text.innerHTML = `<h2>לוח חודש</h2><p>${escapeHtml(context.label)}</p>`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'av2-btn av2-btn--link av2-calendar-clear';
  clear.textContent = 'כל החודש';
  clear.hidden = true;
  header.append(text, clear);

  const calendar = document.createElement('div');
  calendar.className = 'av2-round3-calendar';
  ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'].forEach((name) => {
    const el = document.createElement('div');
    el.className = 'av2-round3-calendar__weekday';
    el.textContent = name;
    calendar.append(el);
  });

  const counts = new Map();
  records.forEach((r) => counts.set(r.report_date, (counts.get(r.report_date) || 0) + 1));
  const first = new Date(context.year, context.month - 1, 1);
  for (let i = 0; i < first.getDay(); i += 1) {
    const spacer = document.createElement('span');
    spacer.className = 'av2-round3-calendar__spacer';
    calendar.append(spacer);
  }
  const last = new Date(context.year, context.month, 0).getDate();
  for (let day = 1; day <= last; day += 1) {
    const date = `${context.year}-${String(context.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const count = counts.get(date) || 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `av2-round3-calendar__day${count ? ' has-reports' : ''}`;
    btn.innerHTML = `<span>${day}</span>${count ? `<small>${count}</small>` : ''}`;
    btn.setAttribute('aria-label', count ? `${day}, ${count} דיווחים` : `${day}, ללא דיווחים`);
    btn.addEventListener('click', () => {
      calendar.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      clear.hidden = false;
      renderRecentReports(recentCard, records, context, date);
    });
    calendar.append(btn);
  }
  clear.addEventListener('click', () => {
    calendar.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
    clear.hidden = true;
    renderRecentReports(recentCard, records, context, null);
  });
  card.append(header, calendar);
}

function renderRecentReports(card, records, context, selectedDate) {
  if (!card) return;
  card.innerHTML = '';
  const filtered = selectedDate ? records.filter((r) => r.report_date === selectedDate) : [...records];
  filtered.sort((a,b) => String(b.report_date).localeCompare(String(a.report_date)) || String(b.start_time || '').localeCompare(String(a.start_time || '')));
  const visible = selectedDate ? filtered : filtered.slice(0, 5);

  const header = document.createElement('div');
  header.className = 'av2-card-heading';
  const titleBox = document.createElement('div');
  titleBox.innerHTML = `<h2>${selectedDate ? `דיווחים ל-${formatDate(selectedDate)}` : 'הדיווחים האחרונים'}</h2><p>${selectedDate ? `${filtered.length} דיווחים ביום שנבחר` : `${records.length} דיווחים בחודש`}</p>`;
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'av2-btn av2-btn--link';
  allBtn.textContent = 'לכל הדיווחים ←';
  allBtn.addEventListener('click', () => document.querySelector('.av2-approval-inner .av2-btn--link')?.click());
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
  row.innerHTML = `<div class="av2-home-report-row__date"><strong>${escapeHtml(formatDate(record.report_date))}</strong><span>${escapeHtml(dayName(record.report_date))}</span></div><div class="av2-home-report-row__main"><strong>${escapeHtml(activity)}</strong><span>${escapeHtml(place)}</span></div><div class="av2-home-report-row__time"><strong>${escapeHtml(formatTime(record.start_time))}–${escapeHtml(formatTime(record.end_time))}</strong><span>${formatHours(record.total_hours)} שעות</span></div><div class="av2-home-report-row__meta">${Number(record.roundtrip_km || 0) > 0 ? `${Number(record.roundtrip_km).toFixed(0)} ק״מ` : ''}</div>`;
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
  rows.forEach(enhanceReportRow);
  enhanceReportsCalendar(calendar, table, rows);
}

function enhanceReportRow(row) {
  if (row.dataset.round3Enhanced === '1') return;
  row.dataset.round3Enhanced = '1';
  row.classList.add('av2-report-card-row');
  const labels = ['תאריך','התחלה','סיום','שעות','סוג פעילות','פעילות','בית ספר','רשות','ק״מ','הוצאות','פעולות'];
  [...row.cells].forEach((cell,index) => {
    cell.dataset.label = labels[index] || '';
    cell.classList.add(`av2-report-card-row__cell-${index + 1}`);
  });
  const match = (row.cells[0]?.textContent || '').match(/(\d{2})[./](\d{2})/);
  if (match) row.dataset.reportDay = String(Number(match[1]));
  row.tabIndex = 0;
  row.setAttribute('aria-expanded','false');
  const toggle = () => {
    const expanded = row.classList.toggle('is-expanded');
    row.setAttribute('aria-expanded', String(expanded));
  };
  row.addEventListener('click',(event) => { if (!event.target.closest('button,a,input,select,label')) toggle(); });
  row.addEventListener('keydown',(event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button,a,input,select')) { event.preventDefault(); toggle(); }
  });
}

function enhanceReportsCalendar(calendar, table, rows) {
  if (calendar.dataset.round3Enhanced === '1') return;
  calendar.dataset.round3Enhanced = '1';
  const tableWrap = table.closest('.av2-reports__table-wrap');
  if (!tableWrap) return;
  const bar = document.createElement('div');
  bar.className = 'av2-reports__day-filter';
  bar.hidden = true;
  const text = document.createElement('span');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'av2-btn av2-btn--link';
  clear.textContent = 'הצג את כל החודש';
  bar.append(text, clear);
  tableWrap.insertAdjacentElement('beforebegin', bar);

  const apply = (day) => {
    rows.forEach((row) => { row.hidden = day ? row.dataset.reportDay !== String(day) : false; });
    const total = table.querySelector('.av2-reports__total-row');
    if (total) total.hidden = Boolean(day);
    bar.hidden = !day;
    text.textContent = day ? `דיווחים ליום ${day} בחודש` : '';
  };
  calendar.querySelectorAll('.av2-cal__cell--has-record').forEach((cell) => {
    const day = Number(cell.querySelector('.av2-cal__day-num')?.textContent || 0);
    if (!day) return;
    cell.classList.add('is-clickable');
    cell.tabIndex = 0;
    cell.setAttribute('role','button');
    const select = () => {
      calendar.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
      cell.classList.add('is-selected');
      apply(day);
      tableWrap.scrollIntoView({ behavior:'smooth', block:'start' });
    };
    cell.addEventListener('click',select);
    cell.addEventListener('keydown',(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
  clear.addEventListener('click',() => {
    calendar.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
    apply(null);
  });
}

function enhanceTimePickers(root) {
  root.querySelectorAll('.av2-report .av2-time-picker__min').forEach(ensureAllMinutes);
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
  sep.className = 'av2-time-picker__sep'; sep.textContent = ':';
  const minute = document.createElement('select');
  minute.className = 'av2-time-picker__sel av2-time-picker__min';
  const current = String(input.value || '').slice(0,5).split(':');
  populateSelect(hour,24,'שע׳',current[0]);
  populateSelect(minute,60,'דק׳',current[1]);
  const sync = () => {
    input.value = hour.value === '' || minute.value === '' ? '' : `${String(hour.value).padStart(2,'0')}:${String(minute.value).padStart(2,'0')}`;
    input.dispatchEvent(new Event('change',{ bubbles:true }));
  };
  hour.addEventListener('change',sync);
  minute.addEventListener('change',sync);
  picker.append(hour,sep,minute);
  input.insertAdjacentElement('afterend',picker);
}

function ensureAllMinutes(select) {
  if (select.dataset.round3Minutes === '1') return;
  select.dataset.round3Minutes = '1';
  populateSelect(select,60,'דק׳',select.value);
}

function populateSelect(select,count,placeholder,current) {
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = placeholder; ph.disabled = true;
  select.append(ph);
  for (let value = 0; value < count; value += 1) {
    const option = document.createElement('option');
    option.value = String(value); option.textContent = String(value).padStart(2,'0');
    select.append(option);
  }
  select.value = current == null || current === '' ? '' : String(Number(current));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('he-IL',{ day:'2-digit', month:'2-digit' });
}
function dayName(value) {
  const date = value ? new Date(`${value}T12:00:00`) : null;
  return !date || Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('he-IL',{ weekday:'short' });
}
function formatTime(value) { return value ? String(value).slice(0,5) : '—'; }
function formatHours(value) { const n = Number(value || 0); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; }
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
