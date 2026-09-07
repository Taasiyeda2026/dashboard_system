import { createIcon } from './icon.js';

export function formatTravelMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function createReportSummaryRow(record, { onOpen } = {}) {
  const row = document.createElement('button');
  row.type = 'button'; row.className = 'av2-report-summary-row';
  row.addEventListener('click', () => onOpen?.(record));
  const date = String(record.report_date || '').split('-').reverse().join('.');
  const compensation = record.travel_compensation;
  row.innerHTML = `<span class="av2-report-summary-row__date">${date}</span><span class="av2-report-summary-row__main"><strong>${record.activity_name_snapshot || record.activity_type || 'פעילות'}</strong><small>${record.school_name_snapshot || record.authority_name_snapshot || ''}</small></span><span>${Number(record.total_hours || 0).toFixed(2)} שעות</span>`;
  if (compensation?.calculation_status === 'resolved' && Number(compensation.final_cancellation_minutes) > 0) {
    const extra = document.createElement('span'); extra.className = 'av2-report-summary-row__travel';
    extra.textContent = `ביטול זמן ${formatTravelMinutes(compensation.final_cancellation_minutes)}`; row.append(extra);
  } else if (compensation && compensation.calculation_status !== 'resolved') {
    const pending = document.createElement('span'); pending.className = 'av2-report-summary-row__pending'; pending.textContent = 'חישוב נסיעה ממתין'; row.append(pending);
  }
  row.append(createIcon('chevron-left', { size: 14 }));
  return row;
}
