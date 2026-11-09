import { supabase } from '../api/client.js';
import { getMonthRecords, getMonthApproval } from './attendance.service.js';
import { formatMonthLabel } from './month-gate.service.js';
import { monthRange } from './historical-display-model.js';

export {
  monthRange,isHistoricTravelMonth,groupHistoricalActivityDays,
  historicalTravelDays,historicalTravelReports,historicalExpenses,monthStatusLabel
} from './historical-display-model.js';

export const HISTORICAL_TRAVEL_CUTOFF = '2026-11-01';
export const monthFromDate = value => String(value || '').slice(0, 7);
export function monthLabel(key) {
  const {year, month} = monthRange(key);
  return formatMonthLabel(year, month);
}

/** Display-only read of existing months and approval records. */
export async function listInstructorDisplayMonths(empId) {
  const now = new Date();
  const current = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const [records, approvals, travelMonths] = await Promise.all([
    supabase.from('attendance_records').select('report_date').eq('emp_id', empId)
      .order('report_date', {ascending:false}),
    supabase.from('attendance_month_approvals').select('month_key,status')
      .eq('emp_id', empId),
    supabase.rpc('av2_list_instructor_saved_travel_months')
  ]);
  if(records.error)throw new Error('לא ניתן לטעון חודשים קודמים');
  if(approvals.error)throw new Error('לא ניתן לטעון סטטוס חודשים');
  if(travelMonths.error)throw new Error('לא ניתן לטעון חודשי נסיעות שמורים');
  const valid = /^20\d{2}-(0[1-9]|1[0-2])$/;
  const months = [...new Set([current,
    ...(records.data||[]).map(row=>monthFromDate(row.report_date)),
    ...(approvals.data||[]).map(row=>row.month_key),
    ...(Array.isArray(travelMonths.data)?travelMonths.data:[])
  ].filter(month=>valid.test(month) && month <= current))];
  return months.sort((a,b)=>b.localeCompare(a));
}

export async function readHistoricalAttendance(empId,key) {
  const {year,month}=monthRange(key);
  const [rows,approval]=await Promise.all([
    getMonthRecords(empId,year,month),
    getMonthApproval(empId,key)
  ]);
  return {rows,approval};
}
