import { createIcon } from './icon.js';

export function formatTravelMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatDate(value) {
  return String(value || '').split('-').reverse().join('.');
}

function formatTime(value) {
  return String(value || '').slice(0, 5) || '—';
}

function addDetail(container, label, value, { wide = false } = {}) {
  const item = document.createElement('div');
  item.className = `av2-report-summary-row__detail${wide ? ' av2-report-summary-row__detail--wide' : ''}`;

  const labelEl = document.createElement('span');
  labelEl.className = 'av2-report-summary-row__detail-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('strong');
  valueEl.className = 'av2-report-summary-row__detail-value';
  valueEl.textContent = String(value ?? '').trim() || '—';

  item.append(labelEl, valueEl);
  container.append(item);
}

export function createReportSummaryRow(record, _options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'av2-report-summary-row';
  if (record?.id != null) wrapper.dataset.recordId = String(record.id);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'av2-report-summary-row__toggle';
  toggle.setAttribute('aria-expanded', 'false');

  const dateEl = document.createElement('span');
  dateEl.className = 'av2-report-summary-row__date';
  dateEl.textContent = formatDate(record.report_date);

  const main = document.createElement('span');
  main.className = 'av2-report-summary-row__main';
  const activity = document.createElement('strong');
  activity.textContent = record.activity_name_snapshot || record.activity_type || 'פעילות';
  const school = document.createElement('small');
  school.textContent = record.school_name_snapshot || record.authority_name_snapshot || '';
  main.append(activity, school);

  const hours = document.createElement('span');
  hours.className = 'av2-report-summary-row__hours';
  hours.textContent = `${Number(record.total_hours || 0).toFixed(2)} שעות`;

  const compensation = record.travel_compensation;
  const travel = document.createElement('span');
  travel.className = 'av2-report-summary-row__travel';
  if (compensation?.calculation_status === 'resolved' && Number(compensation.final_cancellation_minutes) > 0) {
    travel.textContent = `ביטול זמן ${formatTravelMinutes(compensation.final_cancellation_minutes)}`;
  } else if (compensation && compensation.calculation_status !== 'resolved') {
    travel.classList.add('av2-report-summary-row__pending');
    travel.textContent = 'חישוב נסיעה ממתין';
  } else {
    travel.hidden = true;
  }

  const chevron = document.createElement('span');
  chevron.className = 'av2-report-summary-row__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.append(createIcon('chevron-left', { size: 14 }));

  toggle.append(dateEl, main, hours, travel, chevron);

  const details = document.createElement('div');
  details.className = 'av2-report-summary-row__details';
  details.hidden = true;

  addDetail(details, 'תאריך', formatDate(record.report_date));
  addDetail(details, 'שעות', `${formatTime(record.start_time)}–${formatTime(record.end_time)}`);
  addDetail(details, 'סה״כ שעות', Number(record.total_hours || 0).toFixed(2));
  addDetail(
    details,
    'ביטול זמן',
    compensation?.calculation_status === 'resolved'
      ? formatTravelMinutes(compensation.final_cancellation_minutes)
      : compensation
        ? 'ממתין לחישוב'
        : '—'
  );
  addDetail(details, 'סוג פעילות', record.activity_type || '—');
  addDetail(details, 'שם פעילות', record.activity_name_snapshot || '—', { wide: true });
  addDetail(details, 'בית ספר', record.school_name_snapshot || '—');
  addDetail(details, 'רשות', record.authority_name_snapshot || '—');
  if (record.meeting_no != null) addDetail(details, 'מפגש', record.meeting_no);
  addDetail(details, 'ק״מ', Number(record.roundtrip_km || 0).toFixed(0));
  addDetail(details, 'תחבורה ציבורית', record.public_transport ? 'כן' : 'לא');
  if (Number(record.public_transport_cost || 0) > 0) {
    addDetail(details, 'עלות תחבורה ציבורית', `₪${Number(record.public_transport_cost || 0).toFixed(2)}`);
  }
  addDetail(details, 'הוצאות', `₪${Number(record.expenses || 0).toFixed(2)}`);
  if (record.expense_details) addDetail(details, 'פירוט הוצאות', record.expense_details, { wide: true });
  if (record.notes) addDetail(details, 'הערות', record.notes, { wide: true });

  toggle.addEventListener('click', () => {
    const expanded = details.hidden;
    details.hidden = !expanded;
    wrapper.classList.toggle('is-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
  });

  wrapper.append(toggle, details);
  return wrapper;
}
