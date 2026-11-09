import { sourceAttendanceRecords } from './travel-compensation.js';

export function monthRange(key) {
  const [year, month] = String(key || '').split('-').map(Number);
  if (!year || month < 1 || month > 12) throw new Error('חודש לא תקין');
  return { year, month, from: key + '-01',
    to: key + '-' + String(new Date(year, month, 0).getDate()).padStart(2, '0') };
}
export function isHistoricTravelMonth(key) {
  return key < '2026-11';
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


/** Display documented historical values without modifying saved payroll data. */
export function historicalTravelReports(rows = [], dailyReports = []) {
  const byDate = new Map();
  for (const report of dailyReports) {
    const date=String(report?.travel_date||'');
    if(date&&!byDate.has(date))byDate.set(date,report);
  }
  for (const day of groupHistoricalActivityDays(rows)) {
    if(byDate.has(day.date))continue;
    const originals=sourceAttendanceRecords(day.records);
    const sum=(field)=>originals.reduce((total,row)=>total+(Number(row?.[field])||0),0);
    const km=sum('roundtrip_km');
    const fare=sum('public_transport_cost');
    const generatedMinutes=day.records
      .filter(row=>row.generation_kind==='travel_time_cancellation')
      .reduce((total,row)=>total+Math.round((Number(row.total_hours)||0)*60),0);
    const hasOriginalCancellation=originals.some(row=>
      row.cancellation_before_minutes!=null||row.cancellation_after_minutes!=null);
    const originalMinutes=originals.reduce((total,row)=>total+
      (Number(row.cancellation_before_minutes)||0)+(Number(row.cancellation_after_minutes)||0),0);
    const cancellationMinutes=generatedMinutes>0?generatedMinutes:
      hasOriginalCancellation?originalMinutes:null;
    if(km<=0 && fare<=0 && !(cancellationMinutes>0))continue;
    byDate.set(day.date,{
      travel_date:day.date,legs:[],no_travel:false,total_km:km,
      cancellation_minutes:cancellationMinutes,public_transport_cost:fare,
      historical:true
    });
  }
  return [...byDate.values()].sort((a,b)=>
    String(b.travel_date).localeCompare(String(a.travel_date)));
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
    if(!items.has(key))items.set(key,{...row,source:'independent'});
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
