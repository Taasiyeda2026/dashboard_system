import { supabase } from '../api/client.js';
import { getMonthRecords, getMonthApproval, sourceAttendanceRecords } from './attendance.service.js';
import { getDailyTravelReports } from './daily-travel.service.js';
import { formatMonthLabel } from './month-gate.service.js';

export const HISTORICAL_TRAVEL_CUTOFF = '2026-11-04';
export const monthFromDate = value => String(value || '').slice(0, 7);
export function monthRange(key) {
  const [year, month] = String(key || '').split('-').map(Number);
  if (!year || month < 1 || month > 12) throw new Error('חודש לא תקין');
  return { year, month, from: key + '-01',
    to: key + '-' + String(new Date(year, month, 0).getDate()).padStart(2, '0') };
}
export function monthLabel(key) {
  const {year, month} = monthRange(key);
  return formatMonthLabel(year, month);
}
export function isHistoricTravelMonth(key) {
  // A November 2026 month may contain legacy records from Nov 1–3.
  return key < '2026-11';
}

/** Find readable months only. Existing approvals do not grant write permission. */
export async function listInstructorDisplayMonths(empId) {
  const current = monthFromDate(new Date().getFullYear() + '-' +
    String(new Date().getMonth() + 1).padStart(2, '0') + '-01');
  const [records, approvals] = await Promise.all([
    supabase.from('attendance_records').select('report_date').eq('emp_id', empId)
      .order('report_date', {ascending:false}),
    supabase.from('attendance_month_approvals').select('month_key,status')
      .eq('emp_id', empId)
  ]);
  if(records.error)throw new Error('לא ניתן לטעון חודשים קודמים');
  if(approvals.error)throw new Error('לא ניתן לטעון סטטוס חודשים');
  const valid = /^20\d{2}-(0[1-9]|1[0-2])$/;
  const months = [...new Set([current,
    ...(records.data||[]).map(row=>monthFromDate(row.report_date)),
    ...(approvals.data||[]).map(row=>row.month_key)
  ].filter(month=>valid.test(month) && month <= current))];
  return months.sort((a,b)=>b.localeCompare(a));
}

export async function readHistoricalAttendance(empId, key) {
  const {year, month}=monthRange(key);
  const [rows, approval]=await Promise.all([
    getMonthRecords(empId,year,month),
    getMonthApproval(empId,key)
  ]);
  return {rows,approval};
}

export function groupHistoricalActivityDays(rows = []) {
  const byDate=new Map();
  const seen=new Set();
  for(const row of rows){
    if(!row?.id || seen.has(row.id))continue;
    seen.add(row.id);
    const day=String(row.report_date||'');
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(day))continue;
    if(!byDate.has(day))byDate.set(day,[]);
    byDate.get(day).push(row);
  }
  return [...byDate.entries()].sort(([a],[b])=>b.localeCompare(a))
    .map(([date,records])=>({date,records}));
}

/** Preserve the original attendance data. No synthesis of travel legs. */
export function historicalTravelDays(rows=[], dailyReports=[]) {
  const reportByDate=new Map();
  for(const report of dailyReports){
    const date=String(report.travel_date||'');
    if(date&&!reportByDate.has(date))reportByDate.set(date,report);
  }
  const days=groupHistoricalActivityDays(rows);
  for(const date of reportByDate.keys()){
    if(!days.some(day=>day.date===date))days.push({date,records:[]});
  }
  return days.sort((a,b)=>b.date.localeCompare(a.date)).map(day=>({
    ...day,
    dailyReport: reportByDate.get(day.date)||null
  }));
}

/** A legacy expense is identified by its attendance record id, not by amount. */
export function historicalExpenses(rows = [], independent = []) {
  const items = new Map();
  for(const row of sourceAttendanceRecords(rows)){
    const amount=Number(row.expenses||0);
    if(!(amount>0))continue;
    const key='attendance:'+row.id;
    if(!items.has(key))items.set(key,{
      id:key,recordId:row.id,expense_date:row.report_date,amount,
      details:row.expense_details||'',
      attachments:Array.isArray(row.attendance_record_attachments)?row.attendance_record_attachments:[],
      source:'legacy'
    });
  }
  for(const row of independent){
    const key='independent:'+row.id;
    if(!items.has(key))items.set(key,{...row,id:key,source:'independent'});
  }
  return [...items.values()].sort((a,b)=>String(b.expense_date).localeCompare(String(a.expense_date)));
}

export function monthStatusLabel(approval) {
  const value=approval?.status;
  if(value==='locked')return 'נעול';
  if(value==='approved_for_payroll')return 'אושר לשכר';
  if(value==='reopened')return 'נפתח מחדש';
  if(value==='submitted')return 'הוגש לאישור';
  return 'דיווח פתוח';
}
