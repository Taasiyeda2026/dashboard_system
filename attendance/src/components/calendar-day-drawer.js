import { createIcon } from './icon.js';
import { formatDurationHours } from './monthly-report-summary.js';

function text(value) {
  return String(value ?? '').trim();
}

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
}

function formatClock(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function formatTimeRange(start, end) {
  const startText = formatClock(start);
  const endText = formatClock(end);
  return [startText, endText].filter(Boolean).join('–');
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

function makeMeta(label, value, { direction = '', className = '' } = {}) {
  const row = document.createElement('div');
  if (className) row.className = className;
  const dt = document.createElement('span');
  dt.className = 'av2-calendar-day__meta-label';
  dt.textContent = label;
  const dd = document.createElement('strong');
  dd.textContent = text(value) || '—';
  if (direction) dd.dir = direction;
  row.append(dt, dd);
  return row;
}

function makeInlineFact(label, value, { direction = '' } = {}) {
  const fact = document.createElement('span');
  fact.className = 'av2-calendar-day__fact';
  const factLabel = document.createElement('span');
  factLabel.className = 'av2-calendar-day__fact-label';
  factLabel.textContent = `${label}:`;
  const factValue = document.createElement('strong');
  factValue.textContent = text(value) || '—';
  if (direction) factValue.dir = direction;
  fact.append(factLabel, factValue);
  return fact;
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
  const time = formatTimeRange(activity.start_time, activity.end_time);
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

  const activityType = text(record.activity_type);
  const startTime = formatClock(record.start_time);
  const endTime = formatClock(record.end_time);
  const totalHours = Number(record.total_hours || 0);
  const school = text(record.school_name_snapshot);
  const authority = text(record.authority_name_snapshot);
  const km = Number(record.roundtrip_km || 0);
  const publicTransportCost = Number(record.public_transport_cost || 0);
  const usesPublicTransport = record.public_transport === true
    || record.public_transport === 'true'
    || record.public_transport === 1
    || publicTransportCost > 0;
  const expenses = Number(record.expenses || 0);
  const expenseDetails = text(record.expense_details);

  const metaLine = document.createElement('div');
  metaLine.className = 'av2-calendar-day__attendance-meta';
  if (activityType) metaLine.append(makeInlineFact('סוג', activityType));
  if (record.meeting_no != null && text(record.meeting_no)) metaLine.append(makeInlineFact('מפגש', record.meeting_no));

  const locationLine = document.createElement('div');
  locationLine.className = 'av2-calendar-day__attendance-location';
  if (school) locationLine.append(makeInlineFact('בית ספר', school));
  if (authority) locationLine.append(makeInlineFact('רשות', authority));

  const timeStrip = document.createElement('div');
  timeStrip.className = 'av2-calendar-day__time-strip';
  if (startTime) timeStrip.append(makeMeta('התחלה', startTime, { direction: 'ltr', className: 'av2-calendar-day__time-item' }));
  if (endTime) timeStrip.append(makeMeta('סיום', endTime, { direction: 'ltr', className: 'av2-calendar-day__time-item' }));
  if (totalHours > 0) {
    timeStrip.append(makeMeta('סה״כ', formatDurationHours(totalHours), { direction: 'ltr', className: 'av2-calendar-day__time-item is-total' }));
  }

  const extras = document.createElement('div');
  extras.className = 'av2-calendar-day__attendance-extras';
  if (km > 0) extras.append(makeInlineFact('ק״מ', Math.round(km).toLocaleString('he-IL')));
  if (usesPublicTransport) {
    extras.append(makeInlineFact('תחבורה ציבורית', publicTransportCost > 0 ? `כן · ${money(publicTransportCost)}` : 'כן'));
  }
  if (expenses > 0) extras.append(makeInlineFact('הוצאות', money(expenses)));
  if (expenseDetails) extras.append(makeInlineFact('פירוט הוצאות', expenseDetails));

  card.append(title);
  if (metaLine.children.length) card.append(metaLine);
  if (locationLine.children.length) card.append(locationLine);
  if (timeStrip.children.length) card.append(timeStrip);
  if (extras.children.length) card.append(extras);

  const notes = text(record.notes);
  if (notes) {
    const note = document.createElement('p');
    note.className = 'av2-calendar-day__notes';
    note.textContent = notes;
    card.append(note);
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
