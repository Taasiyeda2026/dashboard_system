import { supabase } from '../api/client.js';
import { buildDailyTravelLegs, summarizeDailyTravel } from './daily-travel.js';
import { getMonthRecords } from './attendance.service.js';
import { isZoomLocationReport } from './attendance-location-policy.js';
import { instructorAttendanceError } from './instructor-error.service.js';


export async function getAssignedTravelDays({fromDate=null,toDate=null,signal=null}={}) {
  const request=supabase.rpc('av2_list_instructor_travel_days',{
    p_from:fromDate,p_to:toDate
  });
  const {data,error}=await (signal?request.abortSignal(signal):request);
  if(error)throw new Error('לא ניתן לטעון את ימי הפעילות');
  return Array.isArray(data)?data:[];
}

export async function getDailyTravelReport(empId, date, {signal=null}={}) {
  const rows = await getDailyTravelReports(empId, date.slice(0,7), {signal});
  return rows.find(row => row.travel_date === date) || null;
}

export async function getDailyTravelReports(empId, month, {signal=null}={}) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(year, number, 0).getDate();
  const request=supabase.rpc('av2_get_daily_travel', {
    p_emp_id: Number(empId), p_from: month + '-01',
    p_to: month + '-' + String(last).padStart(2,'0')
  });
  const {data,error}=await (signal?request.abortSignal(signal):request);
  if (error) throw new Error('לא ניתן לטעון את דיווחי הנסיעות');
  return Array.isArray(data) ? data : [];
}

export async function getDailyTravelActivityLegs(empId, date, {signal=null}={}) {
  const request=supabase.rpc('av2_preview_daily_travel',{p_date:date});
  const {data,error}=await (signal?request.abortSignal(signal):request);
  if(error)throw new Error('לא ניתן לטעון את מסלול הנסיעה');
  return Array.isArray(data) ? data.map(leg=>({
    ...leg,
    minutes:leg.kind==='between' && leg.gapMinutes!=null?Number(leg.gapMinutes):null,
    kilometers:leg.kind==='between' && leg.sameLocation===true ? 0 : null
  })) : [];
}

export async function saveDailyTravel(date, legs, noTravel = false, {signal=null}={}) {
  if (!noTravel && !summarizeDailyTravel(legs).complete) {
    throw new Error('יש להשלים שעות ודקות בנסיעה ברכב, קילומטרים או עלות בתחבורה ציבורית');
  }
  const request=supabase.rpc('av2_save_daily_travel', {
    p_date:date,p_legs:noTravel?[]:legs,p_no_travel:Boolean(noTravel)
  });
  const {data,error}=await (signal?request.abortSignal(signal):request);
  if(error) throw new Error(instructorAttendanceError(error, 'שמירת הנסיעות נכשלה. נסו שוב.'));
  if (!data || String(data.travel_date)!==date) throw new Error('לא התקבל אישור שמירה מהשרת');
  return data;
}

export async function reviewDailyTravel(empId,date,decision,km=null,minutes=null) {
  const {data,error}=await supabase.rpc('av2_review_daily_travel',{
    p_emp_id:Number(empId),p_date:date,p_decision:decision,
    p_km:km,p_minutes:minutes
  });
  if(error) throw new Error(instructorAttendanceError(error, 'אישור הנסיעות נכשל'));
  return data;
}
