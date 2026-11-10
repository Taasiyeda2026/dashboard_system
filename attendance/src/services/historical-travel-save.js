import { supabase } from '../api/client.js';
import { confirmedMutation, recordMatchesPayload } from './confirmed-mutation.js';

export async function saveHistoricalTravel(empId, date, changes) {
  return confirmedMutation(async signal => {
    const {data,error} = await supabase.rpc('av2_save_historical_travel_batch', {
      p_emp_id:Number(empId),p_date:date,p_changes:changes
    }).abortSignal(signal);
    if (error) throw new Error(error.message || 'שמירת הנסיעות נכשלה');
    if (!Array.isArray(data) || data.length !== changes.length) throw new Error('לא התקבל אישור שמירה מלא');
    return data;
  }, async signal => {
    const {data,error} = await supabase.from('attendance_records')
      .select('id,roundtrip_km,cancellation_before_minutes,cancellation_after_minutes')
      .eq('emp_id',Number(empId)).eq('report_date',date)
      .in('id',changes.map(change=>change.id)).abortSignal(signal);
    if (error) throw error;
    return changes.every(change=>recordMatchesPayload(data?.find(row=>row.id===change.id),change.payload)) ? data : null;
  });
}
