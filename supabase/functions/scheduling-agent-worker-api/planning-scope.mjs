// Match get_scheduling_planning_preflight: Israeli calendar days, not UTC days.
/**
 * @param {{stored?: Array<{activity_id: string, needs_recalc?: boolean, locked_option?: unknown, row_data?: {kind?: string, startDate?: string}}>, activities?: Array<Record<string, unknown>>, serverTime: string}} input
 */
export function planningRefreshTargets({stored = [], activities = [], serverTime}) {
  const now = new Date(serverTime);
  if (!serverTime || !Number.isFinite(now.getTime())) throw Error('worker_snapshot_server_time_invalid');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(now);
  const cutoff = new Date(today + 'T12:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() + 7);
  const threshold = cutoff.toISOString().slice(0,10);
  const targets = new Set(stored.filter(x=>x.needs_recalc).map(x=>String(x.activity_id)));
  const activityById = new Map(activities.map(x=>[String(x.row_id),x]));
  for (const x of stored) {
    const row = x.row_data || {};
    if (x.locked_option || !['proposal','fixed-proposal'].includes(String(row.kind))
        || !row.startDate || String(row.startDate) >= threshold) continue;
    const activity = activityById.get(String(x.activity_id));
    if (activity && !activity.emp_id && !activity.emp_id_2 && !activity.start_date
        && !activity.instructor_assignment_locked
        && !Array.from({length:35},(_,i)=>activity['date_'+(i+1)]).some(Boolean)) {
      targets.add(String(x.activity_id));
    }
  }
  return [...targets];
}
