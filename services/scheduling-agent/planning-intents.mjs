// A saved choice is not a validated assignment and reserves no calendar time.
// Hold these courses out of optimization until a human releases the choice or
// confirms its instructor through the existing schedule/assignment validators.
export function applyPlanningIntents(snapshot) {
  const active = new Map((snapshot.planningIntents || [])
    .filter(x => x.status === 'active').map(x => [String(x.activity_id), x]));
  const held = snapshot.activities.filter(a => active.has(String(a.row_id))
    && !a.emp_id && !a.emp_id_2 && !a.instructor_assignment_locked);
  const ids = new Set(held.map(a => String(a.row_id)));
  const rows = held.map(a => {
    const intent = active.get(String(a.row_id));
    const cancelled = new Set(a.cancelled_meeting_dates || []);
    const meetings = Array.from({length:35}, (_, i) => ({
      date:a['date_' + (i + 1)], start_time:a.start_time,
      end_time:a.end_time, meeting_no:i + 1
    })).filter(m => m.date && !cancelled.has(m.date));
    return {
      courseId:String(a.row_id), kind:'exception', school:a.school,
      schoolId:a.school_id, programName:a.activity_name,
      instructorEmpId:null, instructorName:'', meetings,
      options:[], packingOptions:[], scheduleOptions:[],
      planningIntent:{instructorId:intent.emp_id, version:intent.version,
        status:'awaiting_schedule_validation', protected:true},
      reason:'מדריך מיועד שמור; ממתין למועדים ולאימות לפני אישור שיבוץ'
    };
  });
  return {rows, snapshot:{...snapshot,
    activities:snapshot.activities.filter(a => !ids.has(String(a.row_id))),
    existingRows:(snapshot.existingRows || []).filter(r => !ids.has(String(r.courseId))),
    committedRows:(snapshot.committedRows || []).filter(r => !ids.has(String(r.courseId))),
    lockedOptions:Object.fromEntries(Object.entries(snapshot.lockedOptions || {}).filter(([id]) => !ids.has(id)))
  }};
}
