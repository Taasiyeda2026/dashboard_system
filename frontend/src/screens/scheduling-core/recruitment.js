// Hypothetical hiring requirements, never actual instructor assignments.
// Greedy grouping is a valid upper bound, not a minimum-headcount proof.
import {text,activityId,minute,transitionFailure,weekday} from './constraints.js';
export function recruitmentModels(rows,context) {
 const models=[];
 for(const row of rows.filter(r=>r.kind==='recruitment'&&r.diagnostics?.recruitmentCertified&&r.meetings?.length)) {
  const activity=context.byActivity.get(row.courseId), gender=row.requiredGender||'any';
  const options=row.scheduleOptions?.length?row.scheduleOptions:[{meetings:row.meetings}];
 let own=row.meetings.map(m=>({...m,start:minute(m.start_time),end:minute(m.end_time),schoolId:text(activity.school_id),address:activity.school_address,courseId:row.courseId,fullDay:row.fullDayBlocking}));
  const fits=model=>{if(gender!=='any'&&model.gender!=='any'&&model.gender!==gender)return false;
   for(const date of new Set(own.map(m=>m.date))){const day=[...model.meetings.filter(m=>m.date===date),...own.filter(m=>m.date===date)].sort((a,b)=>a.start-b.start);
    for(let i=1;i<day.length;i++){if(day[i-1].end>day[i].start||day[i-1].fullDay||day[i].fullDay||transitionFailure(context,day[i-1],day[i]))return false;}}
   return true;};
  let model;for(const choice of options){own=choice.meetings.map(m=>({...m,start:minute(m.start_time),end:minute(m.end_time),schoolId:text(activity.school_id),address:activity.school_address,courseId:row.courseId,fullDay:row.fullDayBlocking}));model=models.find(fits);if(model)break;}if(!model){model={id:`recruitment-v37-${models.length+1}`,gender:'any',languages:[],activityIds:[],meetings:[],fridayPermissionRequired:false,saturdayAvailabilityRequired:false};models.push(model);}
  if(gender!=='any')model.gender=gender;if(!model.languages.includes(row.requiredLanguage))model.languages.push(row.requiredLanguage);
  model.activityIds.push(row.courseId);model.meetings.push(...own);model.fridayPermissionRequired||=own.some(m=>weekday(m.date)===5);model.saturdayAvailabilityRequired||=own.some(m=>weekday(m.date)===6);
 }
 return models;
}
