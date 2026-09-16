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

function normalizedLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

export function isBaseTrainingRecord(record = {}) {
  return normalizedLabel(record.activity_type) === normalizedLabel('הכשרה')
    && normalizedLabel(record.activity_name_snapshot || record.program_name_snapshot) === normalizedLabel('הכשרת בסיס');
}

function mobileToneForActivityType(value) {
  const type = normalizedLabel(value);
  if (type.includes('קורס')) return 'course';
  if (type.includes('סדנה')) return 'workshop';
  if (type.includes('זום') || type.includes('מקוון')) return 'online';
  if (type.includes('תפעול') || type.includes('אירוע') || type.includes('כנס') || type.includes('מטה')) return 'operations';
  return 'default';
}

export function canonicalSnapshotActivityName(record = {}) {
  let value = String(record.activity_name_snapshot || record.program_name_snapshot || record.activity_type || 'פעילות').trim();
  const metadata = [record.school_name_snapshot, record.authority_name_snapshot]
    .map((item) => String(item || '').trim()).filter(Boolean);
  const parts = value.split(/\s+[—–]\s+/u).map((part) => part.trim()).filter(Boolean);
  while (parts.length > 1 && metadata.some((item) => normalizedLabel(item) === normalizedLabel(parts.at(-1)))) parts.pop();
  value = parts.join(' — ');
  return value || 'פעילות';
}

export function reportPresentation(record = {}) {
  const activity = canonicalSnapshotActivityName(record);
  const activityKey = normalizedLabel(activity);
  const secondary = [];
  const contextValues = isBaseTrainingRecord(record)
    ? [record.program_name_snapshot]
    : [record.program_name_snapshot, record.school_name_snapshot, record.authority_name_snapshot];
  contextValues
    .map((value) => String(value || '').trim()).filter(Boolean).forEach((value) => {
      const key = normalizedLabel(value);
      if (!key || activityKey.includes(key) || key.includes(activityKey)) return;
      if (!secondary.some((existing) => normalizedLabel(existing) === key)) secondary.push(value);
    });
  return { activity, secondary: secondary.join(' · ') };
}

export function distinctAttendanceWorkDays(records = []) {
  return new Set((Array.isArray(records) ? records : [])
    .filter((record) => !record?.generation_kind && !record?.source_attendance_record_id)
    .map((record) => String(record?.report_date || '').slice(0, 10)).filter(Boolean)).size;
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

export function createReportSummaryRow(record, options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'av2-report-summary-row';
  wrapper.dataset.tone = mobileToneForActivityType(record?.activity_type);
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
  const presentation = reportPresentation(record);
  activity.textContent = presentation.activity;
  const school = document.createElement('small');
  school.textContent = presentation.secondary;
  main.append(activity, school);

  const hours = document.createElement('span');
  hours.className = 'av2-report-summary-row__hours';
  hours.textContent = Number(record.total_hours || 0).toFixed(2);
  hours.setAttribute('aria-label', `${hours.textContent} שעות עבודה`);

  const compensation = record.travel_compensation;
  const travel = document.createElement('span');
  travel.className = 'av2-report-summary-row__travel';
  if (compensation?.calculation_status === 'resolved' && Number(compensation.final_cancellation_minutes) > 0) {
    travel.textContent = formatTravelMinutes(compensation.final_cancellation_minutes);
    travel.setAttribute('aria-label', `זמן נסיעה מזכה ${travel.textContent}`);
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

  // The collapsed row already shows date, activity, location context and total hours.
  // Expanded details therefore contain only additional, meaningful information.
  addDetail(details, 'שעות', `${formatTime(record.start_time)}–${formatTime(record.end_time)}`);
  addDetail(details, 'סוג פעילות', record.activity_type || '—');
  if (record.meeting_no != null) addDetail(details, 'מפגש', record.meeting_no);

  const km = Number(record.roundtrip_km || 0);
  const publicTransportCost = Number(record.public_transport_cost || 0);
  const usesPublicTransport = record.public_transport === true || publicTransportCost > 0;
  const expenses = Number(record.expenses || 0);

  if (km > 0) addDetail(details, 'ק״מ', km.toFixed(0));
  if (usesPublicTransport) addDetail(details, 'תחבורה ציבורית', 'כן');
  if (publicTransportCost > 0) addDetail(details, 'עלות תחבורה ציבורית', `₪${publicTransportCost.toFixed(2)}`);
  if (expenses > 0) addDetail(details, 'הוצאות', `₪${expenses.toFixed(2)}`);
  if (record.expense_details) addDetail(details, 'פירוט הוצאות', record.expense_details, { wide: true });
  if (record.notes) addDetail(details, 'הערות', record.notes, { wide: true });
  if (record.attachments?.length || record.attachment_names) addDetail(details, 'קבצים', record.attachment_names || `${record.attachments.length} קבצים`, { wide: true });

  if (options.editable && typeof options.onEdit === 'function') {
    const actions = document.createElement('div');
    actions.className = 'av2-report-summary-row__actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'av2-btn av2-btn--secondary';
    edit.textContent = 'עריכה';
    edit.addEventListener('click', (event) => { event.stopPropagation(); options.onEdit(record); });
    actions.append(edit);
    details.append(actions);
  }

  toggle.addEventListener('click', () => {
    const expanded = details.hidden;
    details.hidden = !expanded;
    wrapper.classList.toggle('is-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
  });

  wrapper.append(toggle, details);
  return wrapper;
}

function isGeneratedCancellationRow(record = {}) {
  return record?.generation_kind === 'travel_time_cancellation' && !!record?.source_attendance_record_id;
}

function reportHoursLabel(record = {}) {
  return formatTravelMinutes(Number(record?.total_hours || 0) * 60);
}

export function createReportDaySummaryRow(day, options = {}) {
  const records = Array.isArray(day?.records) ? day.records : [];
  const sourceRecords = records.filter((record) => !isGeneratedCancellationRow(record));
  const wrapper = document.createElement('div');
  wrapper.className = 'av2-report-summary-row av2-report-summary-row--day';
  wrapper.dataset.reportDate = String(day?.date || '');
  wrapper.dataset.tone = mobileToneForActivityType(sourceRecords[0]?.activity_type || records[0]?.activity_type);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'av2-report-summary-row__toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', `פתיחת פירוט דיווחים ליום ${formatDate(day?.date)}`);

  const dateEl = document.createElement('span');
  dateEl.className = 'av2-report-summary-row__date';
  dateEl.textContent = formatDate(day?.date);

  const main = document.createElement('span');
  main.className = 'av2-report-summary-row__main';
  const heading = document.createElement('strong');
  const context = document.createElement('small');
  if (sourceRecords.length === 1) {
    const presentation = reportPresentation(sourceRecords[0]);
    heading.textContent = presentation.activity;
    context.textContent = presentation.secondary;
  } else {
    heading.textContent = `${sourceRecords.length || records.length} דיווחים`;
    context.textContent = [...new Set(records.map((record) => String(record?.activity_type || '').trim()).filter(Boolean))].join(' · ');
  }
  main.append(heading, context);

  const hours = document.createElement('span');
  hours.className = 'av2-report-summary-row__hours';
  hours.textContent = formatTravelMinutes(Number(day?.totalHours || 0) * 60);
  hours.setAttribute('aria-label', `סה״כ ${hours.textContent} שעות ביום זה`);

  const travel = document.createElement('span');
  travel.className = 'av2-report-summary-row__travel';
  if (Number(day?.cancellationHours || 0) > 0) {
    travel.textContent = `ביטול ${formatTravelMinutes(Number(day.cancellationHours) * 60)}`;
    travel.setAttribute('aria-label', `${travel.textContent} מתוך הסה״כ היומי`);
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

  const list = document.createElement('div');
  list.className = 'av2-report-summary-row__activity-list';
  for (const record of records) {
    const line = document.createElement('div');
    line.className = 'av2-report-summary-row__activity-line';
    if (isGeneratedCancellationRow(record)) line.classList.add('is-cancellation');

    const type = document.createElement('strong');
    type.className = 'av2-report-summary-row__activity-type';
    type.textContent = record?.activity_type || (isGeneratedCancellationRow(record) ? ['ביטול', 'זמן'].join(' ') : '—');

    const activity = document.createElement('span');
    activity.className = 'av2-report-summary-row__activity-name';
    activity.textContent = isGeneratedCancellationRow(record)
      ? (record?.activity_name_snapshot || record?.program_name_snapshot || ['ביטול', 'זמן', 'מחושב'].join(' '))
      : reportPresentation(record).activity;

    const lineHours = document.createElement('span');
    lineHours.className = 'av2-report-summary-row__activity-hours';
    lineHours.textContent = reportHoursLabel(record);
    lineHours.setAttribute('aria-label', `${lineHours.textContent} שעות`);

    line.append(type, activity, lineHours);
    if (options.editable && !isGeneratedCancellationRow(record) && typeof options.onEdit === 'function') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'av2-btn av2-btn--link av2-report-summary-row__activity-edit';
      edit.textContent = 'עריכה';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onEdit(record);
      });
      line.append(edit);
    }
    list.append(line);
  }
  details.append(list);

  toggle.addEventListener('click', () => {
    const expanded = details.hidden;
    details.hidden = !expanded;
    wrapper.classList.toggle('is-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${expanded ? 'סגירת' : 'פתיחת'} פירוט דיווחים ליום ${formatDate(day?.date)}`);
  });

  wrapper.append(toggle, details);
  return wrapper;
}
