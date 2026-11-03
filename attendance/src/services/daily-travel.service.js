import { supabase } from '../api/client.js';
import { buildDailyTravelLegs, summarizeDailyTravel } from './daily-travel.js';
import { getMonthRecords } from './attendance.service.js';
import { isZoomLocationReport } from './attendance-location-policy.js';

export async function getDailyTravelReport(empId, date) {
  const rows = await getDailyTravelReports(empId, date.slice(0,7));
  return rows.find(row => row.travel_date === date) || null;
}

export async function getDailyTravelReports(empId, month) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(year, number, 0).getDate();
  const { data, error } = await supabase.rpc('av2_get_daily_travel', {
    p_emp_id: Number(empId), p_from: month + '-01',
    p_to: month + '-' + String(last).padStart(2,'0')
  });
  if (error) throw new Error('לא ניתן לטעון את דיווחי הנסיעות');
  return Array.isArray(data) ? data : [];
}

export async function getDailyTravelActivityLegs(empId, date) {
  const [year, month] = date.split('-').map(Number);
  const records = await getMonthRecords(empId, year, month, {force:true});
  const activities = records.filter(row => row.report_date === date)
    .map(row => ({
      recordId: row.id, date: row.report_date,
      startTime: row.start_time, endTime: row.end_time,
      activityType: row.activity_type,
      generationKind: row.generation_kind,
      destinationAddress: row.destination_address_snapshot,
      school: row.school_name_snapshot || row.authority_name_snapshot,
      isRemote: isZoomLocationReport({
        activityType: row.activity_type,
        trainingMode: row.training_mode,
        operationMeetingMode: row.operation_meeting_mode,
        operationName: row.activity_name_snapshot
      })
    }));
  return buildDailyTravelLegs(activities);
}

export async function saveDailyTravel(date, legs, noTravel = false) {
  if (!noTravel && !summarizeDailyTravel(legs).complete) {
    throw new Error('יש להשלים דקות וקילומטרים לכל מקטע נסיעה');
  }
  const { data,error } = await supabase.rpc('av2_save_daily_travel', {
    p_date:date,p_legs:noTravel?[]:legs,p_no_travel:Boolean(noTravel)
  });
  if(error) throw new Error(error.message || 'שמירת הנסיעות נכשלה');
  return data;
}

export async function reviewDailyTravel(empId,date,decision,km=null,minutes=null) {
  const {data,error}=await supabase.rpc('av2_review_daily_travel',{
    p_emp_id:Number(empId),p_date:date,p_decision:decision,
    p_km:km,p_minutes:minutes
  });
  if(error) throw new Error(error.message || 'אישור הנסיעות נכשל');
  return data;
}
