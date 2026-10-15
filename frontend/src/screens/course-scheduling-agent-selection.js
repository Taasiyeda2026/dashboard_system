// Presentation + authenticated RPCs only. Never imports a matching/planning engine.
const text=value=>String(value??'').trim();
export function agentCandidateResult(snapshot,{replacement=false}={}) {
  if(!snapshot?.activity?.row_id)throw Error('trusted_assignment_snapshot_required');
  const course=snapshot.activity;
  const options=snapshot.planFresh===true?(snapshot.row?.options||[]):[];
  const checked=options.filter(option=>option.eligible===true).map(option=>({
    ...option,instructor:option.instructor||{emp_id:option.instructorEmpId,full_name:option.instructorName},
    failures:[],missingProfileData:[],serverValidationRequired:true,
    ...(!replacement&&option.meetings?.length?{dateAdjustment:{meetings:option.meetings,
      newEndDate:option.endDate||option.meetings.at(-1).date,exceedsHalf:option.halfOverflow===true,
      movedCount:Number(option.movedMeetingsCount)||0,label:'מועדים שחושבו בסוכן',reason:'מועדים מחושבים; האישור והשמירה נבדקים בשרת'}}:{})
  }));
  const recommended=checked.find(c=>text(c.instructor.emp_id)===text(snapshot.row?.instructorEmpId))||checked[0]||null;
  const byId=new Map(checked.map(c=>[text(c.instructor.emp_id),c]));
  const manualCandidates=(snapshot.instructors||[]).map(instructor=>byId.get(text(instructor.emp_id))||{
    instructor,eligible:false,score:null,failures:[],missingProfileData:[],serverValidationRequired:true
  });
  return {course,recommended,alternatives:checked.filter(c=>c!==recommended),checked,manualCandidates,
    status:recommended?'נמצא מדריך מתאים':'נדרש טיפול',
    treatmentReason:snapshot.planFresh?'אין חלופה מחושבת זמינה. אפשר לבחור מדריך לאימות בשרת.':
      'ההמלצות השמורות ממתינות לעדכון הסוכן. אפשר לבחור מדריך ידנית לאימות בשרת.',
    agentSnapshot:snapshot};
}

export function createAgentAssignmentClient({rpc,getActivity,onActivity=()=>{},onConflict=()=>{},snapshots=new Map()}) {
  return {
    async candidates(activityId,options){
      const {data,error}=await rpc('get_scheduling_dashboard_candidates',{p_activity_id:activityId});
      if(error)throw error;
      if(text(data?.activity?.row_id)!==text(activityId))throw Error('trusted_assignment_snapshot_required');
      snapshots.set(text(activityId),data);onActivity(data.activity);
      return agentCandidateResult(data,options);
    },
    async mutate(name,args){
      const id=text(args.p_activity_id),activity=getActivity(id),snapshot=snapshots.get(id);
      if(!activity?.updated_at)return {data:null,error:{message:'scheduling_activity_revision_conflict'}};
      try{
        const result=await rpc('scheduling_dashboard_assignment',{
          p_rpc:name,p_args:args,p_expected_updated_at:activity.updated_at,
          p_expected_source_revision:snapshot?.sourceRevision??null,
          p_expected_workspace_revision:snapshot?.workspaceRevision??null
        });
        if(result.error){
          if(/revision_conflict|permission_denied|JWT|session/i.test(result.error.message||'')){
            snapshots.delete(id);onConflict(id,result.error);
          }
          return result;
        }
        snapshots.delete(id);
        const row=Array.isArray(result.data)?result.data[0]:result.data;
        if(row)onActivity(row);
        return result;
      }catch(error){return {data:null,error};}
    }
  };
}
