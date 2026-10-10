// Auditable operational measurements; verified routes only, no scoring/network calls.
import {compileConstraints,createOccupancy,knownRoute,minute,weekday,addDays,text} from './constraints.js';
import {resolveCourseSchedulingPeriod} from '../course-scheduling-periods.js';
const unionMinutes = rules => {
  if (!rules?.length || rules.some(r=>r.available!==true)) return 0;
  const spans=rules.map(r=>[minute(r.start_time),minute(r.end_time)]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
  let total=0,end=-Infinity;for(const [a,b] of spans){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;
};
export function availabilityByInstructor(context,periodKey='year') {
  const period=resolveCourseSchedulingPeriod(periodKey),result=new Map();
  for(const [empId] of context.byInstructor){let minutes=0,days=0;
    for(let date=period.start;date<=period.end;date=addDays(date,1)){
      if(weekday(date)===5&&context.profiles[empId]?.friday_allowed!==true)continue;
      const window=unionMinutes(context.exceptions.get(empId)?.get(date)||context.rules.get(empId)?.get(weekday(date)));
      minutes+=window;if(window)days++;
    }result.set(empId,{availableHours:minutes/60,availableDays:days});
  }return result;
}
export function operationalQuality(rows,input={},context=input.constraintContext||compileConstraints(input),availability=availabilityByInstructor(context,input.periodKey||'year')) {
  const occupancy=createOccupancy(context,rows),instructors=new Map([...context.byInstructor].map(([id])=>[id,{empId:id,...availability.get(id),assignedHours:0,activeDays:0,meetings:0,activities:new Set(),waitingMinutes:0,travelMinutes:0,travelKm:0,unknownRouteLegs:0,freeWindows:[]}]));
  let sameSchoolSequences=0,sameAuthoritySequences=0,nearbySequences=0,splitDays=0;
  for(const [key,list] of occupancy.days){const empId=list[0].empId,date=list[0].date;let stats=instructors.get(empId);if(!stats){stats={empId,availableHours:0,availableDays:0,assignedHours:0,activeDays:0,meetings:0,activities:new Set(),waitingMinutes:0,travelMinutes:0,travelKm:0,unknownRouteLegs:0,freeWindows:[]};instructors.set(empId,stats);}
    stats.activeDays++;let waiting=0;const home=context.byInstructor.get(empId)?.address;
    const leg=(from,to,same=false)=>{const route=same?{duration_minutes:0,distance_km:0}:knownRoute(context,from,to);if(!route){stats.unknownRouteLegs++;return null;}stats.travelMinutes+=+route.duration_minutes;stats.travelKm+=+route.distance_km;return route;};
    leg(home,list[0].address);leg(list.at(-1).address,home);
    for(let i=0;i<list.length;i++){const m=list[i];stats.meetings++;stats.activities.add(m.courseId);stats.assignedHours+=(m.end-m.start)/60;
      if(!i)continue;const p=list[i-1],same=!!m.schoolId&&m.schoolId===p.schoolId,gap=m.start-p.end,route=leg(p.address,m.address,same);
      if(gap>=0){const idle=route?Math.max(0,gap-(+route.duration_minutes)-(same?0:+route.distance_km<=5?5:15)):null;
        if(idle!==null){waiting+=idle;stats.waitingMinutes+=idle;}if(same&&gap<=30)sameSchoolSequences++;
        else if(text(m.authority)&&text(m.authority)===text(p.authority))sameAuthoritySequences++;
        else if(route&&+route.distance_km<=5)nearbySequences++;
      }
    }if(waiting>30)splitDays++;
    const rules=context.exceptions.get(empId)?.get(date)||context.rules.get(empId)?.get(weekday(date))||[];
    for(const rule of rules.filter(r=>r.available===true)){let cursor=minute(rule.start_time),end=minute(rule.end_time);for(const m of list){if(m.start>cursor)stats.freeWindows.push({date,startMinutes:cursor,endMinutes:Math.min(m.start,end)});cursor=Math.max(cursor,m.end);}if(cursor<end)stats.freeWindows.push({date,startMinutes:cursor,endMinutes:end});}
  }
  const perInstructor=[...instructors.values()].map(s=>({...s,activities:s.activities.size,utilizationRatio:s.availableHours?s.assignedHours/s.availableHours:null,freeWindows:s.freeWindows.filter(w=>w.endMinutes>w.startMinutes)}));
  const total=key=>perInstructor.reduce((sum,s)=>sum+(s[key]||0),0),covered=rows.filter(r=>r.instructorEmpId).length;
  return {covered,uncovered:rows.length-covered,recruitment:rows.filter(r=>r.kind==='recruitment').length,meetingHours:total('assignedHours'),meetings:total('meetings'),availableHours:total('availableHours'),utilizationRatio:total('availableHours')?total('assignedHours')/total('availableHours'):null,workDays:total('activeDays'),waitingMinutes:total('waitingMinutes'),splitDays,sameSchoolSequences,sameAuthoritySequences,nearbySequences,totalTravelMinutes:total('travelMinutes'),totalTravelKm:total('travelKm'),unknownRouteLegs:total('unknownRouteLegs'),instructorsUsed:perInstructor.filter(s=>s.meetings).length,operationalScoreSum:rows.filter(r=>r.kind!=='live').reduce((sum,r)=>sum+(r.score||0),0),perInstructor,
    measurementPolicy:'Travel counts outbound and return home legs plus chronological school transitions per instructor/date, verified routes only; unknown legs counted separately. Availability is union of explicit windows with date exceptions over requested period, excluding unpermitted Friday; sector-specific holidays and travel are not subtracted from the availability denominator. Free windows are raw gaps, not certified course placements.'};
}
// A lower-priority objective can never buy a higher-priority regression.
// Same-school consecutive packing outranks idle waiting: a small wait on one
// school day must not beat two clean but separate school visits.
export function compareOperationalQuality(a,b) {
  for(const [key,direction] of [['covered',1],['meetingHours',1],['splitDays',-1],['sameSchoolSequences',1],['waitingMinutes',-1],['sameAuthoritySequences',1],['nearbySequences',1],['unknownRouteLegs',-1],['totalTravelMinutes',-1],['totalTravelKm',-1],['operationalScoreSum',1]]){
    const delta=(a[key]||0)-(b[key]||0);if(Math.abs(delta)>1e-7)return Math.sign(delta)*direction;
  }return 0;
}
