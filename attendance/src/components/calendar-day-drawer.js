import { createIcon } from './icon.js';

function text(value) {
  return String(value ?? '').trim();
}

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `₪${amount.toFixed(2)}` : '₪0.00';
}

function formatDateHeb(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return String(dateStr || '');
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

function makeSection(title, className = '') {
  const section = document.createElement('section');
  section.className = `av2-calendar-day__section ${className}`.trim();
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading);
  return section;
}

function makeMeta(label, value) {
  const row = document.createElement('div');
  const dt = document.createElement('span');
  dt.className = 'av2-calendar-day__meta-label';
  dt.textContent = label;
  const dd = document.createElement('strong');
  dd.textContent = text(value) || '—';
  row.append(dt, dd);
  return row;
}

function activitySchool(activity = {}) {
  return text(activity.single_school_name)
    || (Array.isArray(activity.linked_schools_json) && activity.linked_schools_json.length === 1
      ? text(activity.linked_schools_json[0]?.name)
      : '');
}

function renderActivity(activity) {
  const details = document.createElement('details');
  details.className = 'av2-calendar-day__activity';

  const summary = document.createElement('summary');
  const title = document.createElement('strong');
  title.textContent = text(activity.activity_name) || text(activity.program_name) || 'פעילות';
  const meta = document.createElement('span');
  const time = [text(activity.start_time), text(activity.end_time)].filter(Boolean).join('–');
  const meeting = activity.meeting_no ? `מפגש ${activity.meeting_no}` : '';
  meta.textContent = [time, meeting].filter(Boolean).join(' · ');
  summary.append(title, meta);

  const body = document.createElement('div');
  body.className = 'av2-calendar-day__activity-body';
  body.append(
    makeMeta('סוג', activity.activity_type),
    makeMeta('תוכנית', activity.program_name),
    makeMeta('רשות', activity.authority_name),
    makeMeta('בית ספר', activitySchool(activity)),
  );

  details.append(summary, body);
  return details;
}

function renderAttendance(record) {
  const card = document.createElement('article');
  card.className = 'av2-calendar-day__attendance';

  const title = document.createElement('h4');
  title.textContent = text(record.activity_name_snapshot)
    || text(record.program_name_snapshot)
    || text(record.activity_type)
    || 'דיווח נוכחות';

  const grid = document.createElement('div');
  grid.className = 'av2-calendar-day__attendance-grid';
  const time = [text(record.start_time), text(record.end_time)].filter(Boolean).join('–');
  grid.append(
    makeMeta('שעות', time || record.total_hours),
    makeMeta('בית ספר', record.school_name_snapshot),
    makeMeta('רשות', record.authority_name_snapshot),
    makeMeta('ק״מ', Number(record.roundtrip_km || 0).toFixed(0)),
    makeMeta('תחבורה ציבורית', record.public_transport ? money(record.public_transport_cost) : 'לא'),
    makeMeta('הוצאות', money(record.expenses)),
  );

  const notes = text(record.notes);
  if (notes) {
    const note = document.createElement('p');
    note.className = 'av2-calendar-day__notes';
    note.textContent = notes;
    card.append(title, grid, note);
  } else {
    card.append(title, grid);
  }
  return card;
}

export function openAttendanceCalendarDay({
  dateStr,
  activities = [],
  schoolEvents = [],
  birthdays = [],
  records = [],
  canAddReport = false,
  onNewReport,
} = {}) {
  document.querySelector('.av2-calendar-day-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'av2-calendar-day-overlay';

  const drawer = document.createElement('div');
  drawer.className = 'av2-calendar-day';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', `פרטי יום ${formatDateHeb(dateStr)}`);

  const header = document.createElement('header');
  const headingWrap = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.textContent = 'לוח יום';
  const heading = document.createElement('h2');
  heading.textContent = formatDateHeb(dateStr);
  headingWrap.append(eyebrow, heading);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'av2-btn av2-btn--icon av2-calendar-day__close';
  close.setAttribute('aria-label', 'סגירה');
  close.append(createIcon('x'));
  header.append(headingWrap, close);

  const body = document.createElement('div');
  body.className = 'av2-calendar-day__body';

  if (schoolEvents.length) {
    const section = makeSection('חופשות ואירועים', 'is-school');
    for (const event of schoolEvents) {
      const item = document.createElement('div');
      item.className = 'av2-calendar-day__event';
      const title = document.createElement('strong');
      title.textContent = text(event.title);
      item.append(title);
      if (event.resume_date) {
        const resume = document.createElement('span');
        resume.textContent = `חזרה: ${String(event.resume_date).slice(0, 10)}`;
        item.append(resume);
      }
      section.append(item);
    }
    body.append(section);
  }

  if (birthdays.length) {
    const section = makeSection('ימי הולדת', 'is-birthday');
    for (const birthday of birthdays) {
      const item = document.createElement('div');
      item.className = 'av2-calendar-day__event';
      item.textContent = `🎂 יום הולדת ל${text(birthday.employee_name)}`;
      section.append(item);
    }
    body.append(section);
  }

  if (activities.length) {
    const section = makeSection('פעילויות משובצות', 'is-activity');
    activities.forEach((activity) => section.append(renderActivity(activity)));
    body.append(section);
  }

  if (records.length) {
    const section = makeSection('דיווחי נוכחות', 'is-attendance');
    records.forEach((record) => section.append(renderAttendance(record)));
    body.append(section);
  }

  if (!schoolEvents.length && !birthdays.length && !activities.length && !records.length) {
    const empty = document.createElement('p');
    empty.className = 'av2-calendar-day__empty';
    empty.textContent = 'אין אירועים או דיווחים ביום זה.';
    body.append(empty);
  }

  const footer = document.createElement('footer');
  if (canAddReport && typeof onNewReport === 'function') {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'av2-btn av2-btn--primary av2-calendar-day__add';
    add.append(createIcon('file-plus-2', { size: 17 }));
    const label = document.createElement('span');
    label.textContent = 'דיווח חדש ליום זה';
    add.append(label);
    add.addEventListener('click', () => {
      overlay.remove();
      onNewReport(dateStr);
    });
    footer.append(add);
  }

  const closeDrawer = () => overlay.remove();
  close.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeDrawer();
  });
  drawer.addEventListener('click', (event) => event.stopPropagation());

  drawer.append(header, body, footer);
  overlay.append(drawer);
  document.body.append(overlay);
  close.focus();

  return { close: closeDrawer };
}
