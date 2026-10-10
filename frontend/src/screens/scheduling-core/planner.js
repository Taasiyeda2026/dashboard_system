import { explainRejections } from './rejection-reasons.js';
import { classifyMeetingAvailabilityBlocks } from '../course-scheduling-date-adjustments.js';
import { operationalQuality, availabilityByInstructor, compareOperationalQuality } from './quality.js';
import { augmentingSearch } from './augmenting-search.js';
import { planningPerfCount } from '../course-scheduling-perf.js';
import { recruitmentModels } from './recruitment.js';
import { computeSchedulingScore, compareCandidatesStable, courseUrgency } from '../course-scheduling-score.js';
import { buildOperationalBlocks } from '../course-scheduling-engine.js';
import { resolveCourseSchedulingPeriod } from '../course-scheduling-periods.js';
import { isSchedulingActivityActive, schedulingActivityTypeCategory, isFullDaySchedulingActivity } from '../shared/activity-scheduling-eligibility.js';
import { normalizeOperationalDistrict } from '../shared/district-normalization.js';
import { compileConstraints, createOccupancy, candidateFailures, staticFailures, meetingFailures, knownRoute,
  ensureRoute, ensureCandidateRoutes, validatePlanWithRoutes, officialMeetings, isProtectedActivity, activeInstructor, validatePlan, ENGINE_VERSION, text, activityId, minute, weekday, addDays } from './constraints.js';

const stamp = value => {const seconds=Math.round(value*60), result=`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}`;return seconds%60?result+':'+String(seconds%60).padStart(2,'0'):result;};
const covered = row => !!row.instructorEmpId;
const schedulingError = (code, failures = []) => Object.assign(Error(code), { code, failures });
export function planningActivities(input) {
  const period = resolveCourseSchedulingPeriod(input.periodKey || 'first'), district = normalizeOperationalDistrict(input.district);
  return (input.activities || []).filter(a => isSchedulingActivityActive(a) && schedulingActivityTypeCategory(a.activity_type || a.type))
    .filter(a => !district || normalizeOperationalDistrict(a.district || a.school_district || a.authority_district) === district)
    .filter(a => { const first = officialMeetings(a)[0]?.date; return first ? first >= period.start && first <= period.end : period.key !== 'second'; });
}
function courseSpec(a, input) {
  if (input.courseSpecs?.[activityId(a)]) return input.courseSpecs[activityId(a)];
  const catalog = (input.catalog || []).find(r => (a.activity_no && text(r.activity_no) === text(a.activity_no)) || text(r.activity_name) === text(a.activity_name));
  const tour = isFullDaySchedulingActivity(a), sessions = tour ? 1 : (+a.sessions || officialMeetings(a).length || +catalog?.meetings_count || (schedulingActivityTypeCategory(a.activity_type) === 'workshop' ? 1 : 0));
  const durationMinutes = tour ? 300 : Number.isFinite(minute(a.end_time) - minute(a.start_time))
    ? minute(a.end_time) - minute(a.start_time) : +catalog?.hours_count * 60 / +catalog?.meetings_count;
  return { sessions: Math.min(35, Math.floor(sessions)), durationMinutes: Math.ceil(durationMinutes / 15) * 15, complete: sessions > 0 && durationMinutes > 0 };
}
function rowFor(a, meetings = []) {
  return { courseId: activityId(a), schoolId: text(a.school_id), school: a.school, authority: a.authority, district: a.district,
    courseName: a.activity_name || a.program_name || a.name, activityType: a.activity_type, fullDayBlocking: isFullDaySchedulingActivity(a),
    requiredLanguage: a.instruction_language, requiredGender: a.required_instructor_gender || 'any', sourceHadDraft: !!text(a.draft_emp_id), previousDraftInstructorEmpId:text(a.draft_emp_id), previousDraftInstructorName:a.draft_instructor_name || '', previousDraftMeetings:(a.draft_proposed_meetings || []).map((m,i)=>({...m,meeting_no:m.meeting_no || i+1})),
    schoolDateAnchored: officialMeetings(a).length > 0, sessions: meetings.length, meetings,
    startDate: meetings[0]?.date || '', endDate: meetings.at(-1)?.date || '', startTime: meetings[0]?.start_time || '', endTime: meetings[0]?.end_time || '',
    kind: 'missing', status: 'חסר שיבוץ', instructorEmpId: '', instructorName: '', options: [], packingOptions: [], scheduleOptions: [] };
}
function optionRow(a, option, options) {
  return { ...rowFor(a, option.meetings), ...option, kind: officialMeetings(a).length ? 'fixed-proposal' : 'proposal',
    status: option.score >= 60 ? 'הצעה מוכנה' : 'מתאים טכנית ונדרש טיפול', options,
    reason: option.recommendationReason || 'המדריך עבר את כל תנאי הסף', diagnostics: { routeVerified: true, searchIncomplete: false, recruitmentCertified: false } };
}
function protectedRow(a, previous) {
  // Source dates win, but retain confirmed meeting substitutions from saved
  // data when the original date/meeting identity still matches exactly.
  const meetings = officialMeetings(a).map(m => {
    return m;
  });
  return { ...rowFor(a, meetings), kind: 'live', status: 'שיבוץ מאושר — נשמר', instructorEmpId: text(a.emp_id || a.emp_id_2),
    instructorName: previous?.instructorName || a.instructor_name || '', additionalInstructorEmpIds: text(a.emp_id_2) && text(a.emp_id) ? [text(a.emp_id_2)] : [] };
}
function scoring(context, occupancy, a, option) {
  const empId = option.instructorEmpId, all = [...occupancy.days.entries()].filter(([key]) => key.startsWith(`${empId}|`)).flatMap(([, rows]) => rows);
  const firstDate = option.meetings[0]?.date || '', second = firstDate >= '2027-01-31', halfRows = all.filter(m => (m.date >= '2027-01-31') === second);
  const existingActivities = halfRows.map(m => ({ ...m, school_id: m.schoolId, start_time: stamp(m.start), end_time: stamp(m.end) }));
  const hours = halfRows.reduce((sum, m) => sum + (m.end - m.start) / 60, 0), added = option.meetings.reduce((sum, m) => sum + (minute(m.end_time) - minute(m.start_time)) / 60, 0);
  const weekly = [...(context.rules.get(empId)?.values() || [])].flat().filter(r => r.available === true).reduce((sum, r) => sum + Math.max(0, minute(r.end_time) - minute(r.start_time)) / 60, 0);
  const availabilityHours = weekly * (second ? 22 : 26), transitions = {};
  for (const m of option.meetings) {
    const list = occupancy.days.get(`${empId}|${m.date}`) || [], start = minute(m.start_time), end = minute(m.end_time);
    const before = list.filter(x => x.end <= start).at(-1), after = list.find(x => x.start >= end);
    transitions[m.date] = {
      before: before ? { ...knownRoute(context, before.address, a.school_address), sameSchool: before.schoolId === text(a.school_id) } : null,
      after: after ? { ...knownRoute(context, a.school_address, after.address), sameSchool: after.schoolId === text(a.school_id) } : null
    };
  }
  let idleGapMinutes=0;for(const m of option.meetings){const list=occupancy.days.get(`${empId}|${m.date}`)||[], before=list.filter(x=>x.end<=minute(m.start_time)).at(-1),after=list.find(x=>x.start>=minute(m.end_time));if(before)idleGapMinutes+=minute(m.start_time)-before.end;if(after)idleGapMinutes+=after.start-minute(m.end_time);}
  const scored = computeSchedulingScore({ eligible: true, activity: a, meetings: option.meetings, existingActivities,
    travel: { home: knownRoute(context, context.byInstructor.get(empId)?.address, a.school_address), transitions },
    workDates: new Set(halfRows.map(m => m.date)), currentHalfHours: hours, projectedHalfHours: hours + added,
    currentCourseCount: new Set(halfRows.map(m => m.courseId)).size, availabilityHours,
    currentUtilizationRatio: availabilityHours ? hours / availabilityHours : 0, projectedUtilizationRatio: availabilityHours ? (hours + added) / availabilityHours : 0,
    activeWorkDays: new Set(halfRows.map(m => m.date)).size });
  return { ...option, ...scored, idleGapMinutes, eligible: true, instructor: context.byInstructor.get(empId), routeVerified: true,
    instructorName: context.byInstructor.get(empId)?.full_name || '', operationalMetrics: { ...scored } };
}
function* schedules(context, a, empId, spec, input, previous, occupancy) {
  const official = officialMeetings(a);
  if (official.length) { yield official; return; }
  // A source start date/time is a fixed school anchor even if date_1 is absent.
  const period = resolveCourseSchedulingPeriod(input.periodKey || 'first'), year = resolveCourseSchedulingPeriod('year');
  const start = [period.start, input.today || period.start, '2026-10-12', text(a.start_date).slice(0, 10)].sort().at(-1);
  const end = period.key === 'first' ? '2027-02-28' : year.end;
  if (previous?.meetings?.length && previous.meetings[0].date >= start) {
    yield previous.meetings;
    if(previous.instructorEmpId===empId){const blocks=classifyMeetingAvailabilityBlocks({meetings:previous.meetings,rules:input.rules?.[empId]||[],exceptions:input.exceptions?.[empId]||[]});
      if(blocks.instructorExceptionCount>0&&blocks.recoverable){const shifted=[];let nextAllowed=previous.meetings[0].date,changed=false;
        for(const m of previous.meetings){let date=m.date<nextAllowed?nextAllowed:m.date;while(date<=end&&meetingFailures(context,a,empId,{...m,date}).length)date=addDays(date,7);
          if(date>end){shifted.length=0;break;}changed ||= date!==m.date;shifted.push({...m,date});nextAllowed=addDays(date,7);
        }if(changed&&shifted.length===spec.sessions&&(!a.start_date||shifted[0].date===text(a.start_date).slice(0,10)))yield shifted;
      }
    }
  }
  for (let date = start; date <= (a.start_date ? text(a.start_date).slice(0, 10) : period.end); date = addDays(date, 1)) {
    const day = weekday(date), dayRules = context.exceptions.get(empId)?.get(date) || context.rules.get(empId)?.get(day) || [];
    if (day === 5 && context.profiles[empId]?.friday_allowed !== true) continue;
    if (day === 6 && !['arab', 'druze'].includes(a.calendar_sector)) continue;
    for (const rule of dayRules.filter(r => r.available === true)) {
      const from = a.start_time ? minute(a.start_time) : a.end_time ? minute(a.end_time)-spec.durationMinutes : Math.ceil(minute(rule.start_time) / 15) * 15;
      const to = a.start_time || a.end_time ? from : minute(rule.end_time) - spec.durationMinutes;
      const nearby = (occupancy?.days.get(`${empId}|${date}`) || []).filter(m=>m.courseId!==activityId(a));
      const adjacency = nearby.flatMap(m=>{const route=m.schoolId===text(a.school_id)?{distance_km:0,duration_minutes:0}:knownRoute(context,a.school_address,m.address);if(!route)return[];const buffer=m.schoolId===text(a.school_id)?0:(+route.distance_km<=5?5:15);return [Math.floor((m.start-spec.durationMinutes-(+route.duration_minutes)-buffer)/30)*30,Math.ceil((m.end+(+route.duration_minutes)+buffer)/30)*30];});
      const times=[...new Set([...adjacency.filter(t=>t>=from&&t<=to),...Array.from({length:Number.isFinite(from)&&Number.isFinite(to)&&to>=from?Math.floor((to-from)/30)+1:0},(_,i)=>from+i*30)])];
      for (const time of times) {
        const meetings = []; let next = date;
        while (meetings.length < spec.sessions && next <= end) {
          const meeting = { date: next, meeting_no: meetings.length + 1, start_time: stamp(time), end_time: stamp(time + spec.durationMinutes) };
          // Flexible dates may skip school holidays and unavailable days, but
          // no official date is ever shifted by this generation path.
          if (!meetingFailures(context, a, empId, meeting).length) meetings.push(meeting);
          next = addDays(next, 7);
        }
        if (meetings.length === spec.sessions && (!a.start_date || meetings[0].date === text(a.start_date).slice(0,10))) yield meetings;
      }
    }
  }
}
export async function buildPlan(input = {}) {
  planningPerfCount("scheduleCalls");
  const started = performance.now(), metrics = { candidateChecks: 0, generatedSchedules: 0, activitiesComputed: 0, protectedRows: 0, contextMs: 0, validationMs: 0, optimizationMs: 0 };
  const checkpoint = async () => { if (input.signal?.aborted) throw schedulingError('planning_cancelled'); await input.checkpoint?.(); };
  const report = async (phase, completed = 0, total = 0, courseId = '', row = null, snapshotRows = null) => { await checkpoint(); await input.onProgress?.({ phase, completed, total, courseId, row, snapshotRows }); };
  await report('הכנת הקשר מנוע חדש');
  const context = input.constraintContext || compileConstraints(input), targets = input.requiredActivities || planningActivities(input), ids = new Set(targets.map(activityId));
  const affected = input.targetCourseIds == null ? ids : new Set([...input.targetCourseIds,...(input.upgradeOptimizationScopes?.recruitmentRecoveryCourseIds || [])].map(text));
  if ([...affected].some(id => !ids.has(id))) throw schedulingError('planning_scope_conflict');
  if (input.targetCourseIds != null && input.allowGlobalRepair === true && !(input._nationalRun === true && input.resumeFromCheckpoint === true)) throw schedulingError('planning_scope_conflict');
  const previous = new Map((input.existingRows || []).map(r => [r.courseId, r])), rows = new Map(), anchors = [];
  for (const a of input.activities || []) {
    const id = activityId(a);
    if (isProtectedActivity(a)) {
      const row = protectedRow(a, previous.get(id)); anchors.push(row); if (ids.has(id)) rows.set(id, row); metrics.protectedRows++; continue;
    }
    if (!ids.has(id)) {
      if (a.draft_emp_id && a.draft_proposed_meetings?.length) anchors.push({ ...rowFor(a, a.draft_proposed_meetings), instructorEmpId: text(a.draft_emp_id), kind: 'draft' });
      continue;
    }
    const lock = input.lockedOptions?.[id];
    if (lock) { const row = { ...rowFor(a, lock.meetings), ...lock, kind: 'planning-locked', status: 'נקבע בתכנון', planningLocked: true }; rows.set(id, row); anchors.push(row); continue; }
    if (!affected.has(id) && previous.has(id)) { const row = previous.get(id); rows.set(id, row); anchors.push(row); }
    else if (a.draft_emp_id && a.draft_proposed_meetings?.length) anchors.push({ ...rowFor(a, a.draft_proposed_meetings), instructorEmpId: text(a.draft_emp_id), kind: 'draft' });
  }
  const occupancy = createOccupancy(context, anchors), queue = targets.filter(a => affected.has(activityId(a)) && !rows.has(activityId(a)));
  metrics.contextMs = performance.now() - started;
  const baselineOptions = new Map(), baselineInfo = new Map(), candidatePools = new Map();
  const availability = availabilityByInstructor(context,input.periodKey || 'year');
  const quality = values => operationalQuality(values,input,context,availability);
  const incumbentExceptionInstructor=new Map(), incumbentExceptionIneligible=new Map();
  if(input.targetCourseIds!=null)for(const a of queue){const prior=previous.get(activityId(a)),empId=prior?.instructorEmpId;if(!empId)continue;const blocked=classifyMeetingAvailabilityBlocks({meetings:prior.meetings||[],rules:input.rules?.[empId]||[],exceptions:input.exceptions?.[empId]||[]});if(blocked.instructorExceptionCount>0&&blocked.recoverable)incumbentExceptionInstructor.set(activityId(a),empId);else if(blocked.instructorExceptionCount>0&&!blocked.recoverable)incumbentExceptionIneligible.set(activityId(a),empId);}
  const limit = input.candidateBudgetPerInstructor || (input.planningProfile === 'fast' ? 96 : 384);
  async function generatePool(a,scheduleState=null) {
    const state = createOccupancy(context,anchors);
    const id = activityId(a), spec = courseSpec(a, input), found = [], failures = new Set(); let incomplete = false;
    const missingData=staticFailures(context,a,'').filter(r=>['missing_school_data','missing_language'].includes(r));
    if(missingData.length)return {options:[],incomplete:false,missing:true,failures:missingData};
    if (officialMeetings(a).some(m => !Number.isFinite(minute(m.start_time)) || !Number.isFinite(minute(m.end_time)) || minute(m.end_time)<=minute(m.start_time))) return {options:[],incomplete:false,missing:true,failures:['source_time_conflict']};
    if (officialMeetings(a).some(m => meetingFailures(context,a,'',m).some(reason => ['calendar_block','calendar_end_time','saturday_sector'].includes(reason)))) return { options: [], incomplete: false, missing: true, failures: ['source_date_conflict'] };
    if (a.start_time && a.end_time && minute(a.end_time)-minute(a.start_time) !== spec.durationMinutes && !officialMeetings(a).length) return {options:[],incomplete:false,missing:true,failures:['source_duration_conflict']};
    if (!spec.complete) return { options: [], incomplete: false, missing: true, failures: ['missing_course_spec'] };
    // Only active instructors can receive new proposals. Keep inactive people
    // in the context for historical/protected assignments and validation.
    // Home-to-school verified road distance is a proximity ranking, not a hard
    // geographic partition: unknown routes remain eligible for route lookup.
    const nearbyInstructors = [...context.byInstructor]
      .filter(([, instructor]) => activeInstructor(instructor))
      .sort(([leftId, left], [rightId, right]) => {
        const leftRoute = knownRoute(context, left.address, a.school_address);
        const rightRoute = knownRoute(context, right.address, a.school_address);
        const leftDistance = leftRoute ? Number(leftRoute.distance_km) : Infinity;
        const rightDistance = rightRoute ? Number(rightRoute.distance_km) : Infinity;
        return leftDistance - rightDistance || leftId.localeCompare(rightId);
      });
    for (const [empId, instructor] of nearbyInstructors) {
      if(incumbentExceptionInstructor.has(id)&&incumbentExceptionInstructor.get(id)!==empId)continue;
      if(incumbentExceptionIneligible.get(id)===empId)continue;
      if ((input.optimizationOnlyCourseIds || []).includes(id) && previous.get(id)?.instructorEmpId !== empId) continue;
      await checkpoint();
      const nonRouteFailures=staticFailures(context,a,empId).filter(r=>r!=='home_route_unknown');
      if(nonRouteFailures.length){planningPerfCount('staticCandidatePruned');nonRouteFailures.forEach(r=>failures.add(r));continue;}
      if (!knownRoute(context, instructor.address, a.school_address)) await ensureRoute(context, instructor.address, a.school_address);
      const rejected = staticFailures(context, a, empId); if (rejected.length) { planningPerfCount('staticCandidatePruned'); rejected.forEach(r => failures.add(r)); continue; }
      let attempted = 0;
      // Cap per weekday so the early Monday series cannot exhaust the fast
      // budget before Tue/Wed same-school packing alternatives are generated.
      const perWeekday = new Map();
      const weekdayCap = Math.max(12, Math.floor(limit / 4));
      for (const meetings of schedules(context, a, empId, spec, input, previous.get(id), scheduleState||state)) {
        if (attempted >= limit) { incomplete = true; break; }
        if(!officialMeetings(a).length && meetings.length!==spec.sessions)continue;
        const dow = weekday(meetings[0]?.date);
        if (Number.isInteger(dow) && (perWeekday.get(dow) || 0) >= weekdayCap) continue;
        metrics.generatedSchedules++; planningPerfCount("scenarioCount"); await checkpoint();
        if ((input.optimizationOnlyCourseIds || []).includes(id) && JSON.stringify(meetings.map(m=>m.date))!==JSON.stringify((previous.get(id)?.meetings || []).map(m=>m.date))) continue;
        const option = { instructorEmpId: empId, meetings, startDate: meetings[0].date, endDate: meetings.at(-1).date, startTime: meetings[0].start_time, endTime: meetings[0].end_time };
        await ensureCandidateRoutes(context, state, a, option);
        const issues = candidateFailures(context, state, a, option); metrics.candidateChecks++; planningPerfCount("candidateEvals");
        if (issues.length) { issues.forEach(f => failures.add(f.reason)); continue; }
        attempted++;
        if (Number.isInteger(dow)) perWeekday.set(dow, (perWeekday.get(dow) || 0) + 1);
        found.push(option);
      }
    }
    found.sort((a,b)=>a.instructorEmpId.localeCompare(b.instructorEmpId)||a.startDate.localeCompare(b.startDate)||a.startTime.localeCompare(b.startTime));
    return { options: found, incomplete, missing: failures.has('missing_school_data') || failures.has('missing_course_spec') || failures.has('missing_language') || failures.has('home_route_unknown') || (!found.length && failures.has('missing_profile_data')), failures: [...failures] };
  }
  // Structural shortlist, not a second scoring formula. Examine all generated
  // legal alternatives, retain distinct efficient schedules for every instructor,
  // then compute the existing 100-point score only for those finalists.
  function placement(a,option,state){let newDays=0,waiting=0,sameSchool=0;
    for(const m of option.meetings){const list=(state.days.get(`${option.instructorEmpId}|${m.date}`)||[]).filter(x=>x.courseId!==activityId(a));if(!list.length){newDays++;continue;}
      const start=minute(m.start_time),end=minute(m.end_time),before=list.filter(x=>x.end<=start).at(-1),after=list.find(x=>x.start>=end);
      for(const [neighbor,gap] of [[before,before?start-before.end:0],[after,after?after.start-end:0]]){if(!neighbor)continue;const same=neighbor.schoolId===text(a.school_id);if(same&&gap<=30)sameSchool++;const route=same?{duration_minutes:0,distance_km:0}:knownRoute(context,neighbor.address,a.school_address);if(route)waiting+=Math.max(0,gap-(+route.duration_minutes)-(same?0:+route.distance_km<=5?5:15));}
    }return {newDays,waiting,sameSchool};
  }
  const overlapOptions=(a,b)=>a.instructorEmpId===b.instructorEmpId&&a.meetings.some(m=>b.meetings.some(n=>m.date===n.date&&minute(m.start_time)<minute(n.end_time)&&minute(m.end_time)>minute(n.start_time)));
  function opportunityCost(a,option){let cost=0;for(const [id,alternatives] of baselineOptions){if(id===activityId(a)||rows.has(id)||!alternatives.length)continue;const count=new Set(alternatives.map(o=>o.instructorEmpId)).size;if(count>2)continue;
      cost+=alternatives.filter(other=>overlapOptions(option,other)).length/alternatives.length;
    }return cost;}
  // Prefer consecutive same-school packing over raw waiting minutes so a
  // second course at the same school is shortlisted before a clean new day.
  const comparePlacement=(a,b)=>a.blockers-b.blockers||a.placement.newDays-b.placement.newDays||b.placement.sameSchool-a.placement.sameSchool||a.placement.waiting-b.placement.waiting||a.option.startDate.localeCompare(b.option.startDate)||a.option.startTime.localeCompare(b.option.startTime)||a.option.instructorEmpId.localeCompare(b.option.instructorEmpId);
  function shortlist(a,options,state,count=4){
    const ranked=options.map(option=>({option,blockers:0,placement:placement(a,option,state)})).sort(comparePlacement);
    const counts=new Map(), kept=[], seenEmpWeekday=new Set();
    // Prefer already-packed same-school options, then diversify remaining
    // shortlist slots by weekday so a blocked Monday cannot starve Wed packing.
    for(const item of ranked){
      const emp=item.option.instructorEmpId, n=counts.get(emp)||0;
      if(n>=count) continue;
      if(item.placement.sameSchool>0 || item.placement.newDays===0){
        kept.push(item.option);
        counts.set(emp,n+1);
        seenEmpWeekday.add(`${emp}|${weekday(item.option.startDate)}`);
      }
    }
    for(const {option} of ranked){
      const emp=option.instructorEmpId, n=counts.get(emp)||0;
      if(n>=count || kept.includes(option)) continue;
      const key=`${emp}|${weekday(option.startDate)}`;
      if(seenEmpWeekday.has(key)) continue;
      seenEmpWeekday.add(key); counts.set(emp,n+1); kept.push(option);
    }
    for(const {option} of ranked){
      const emp=option.instructorEmpId, n=counts.get(emp)||0;
      if(n>=count || kept.includes(option)) continue;
      counts.set(emp,n+1); kept.push(option);
    }
    return kept;
  }
  async function candidates(a,state,baseOnly=false) {
    const id=activityId(a);if(!candidatePools.has(id))candidatePools.set(id,await generatePool(a));
    let pool=candidatePools.get(id);const options=[],failures=new Set(pool.failures);
    const collect=async raws=>{for(const raw of raws){await checkpoint();await ensureCandidateRoutes(context,state,a,raw);const issues=candidateFailures(context,state,a,raw);
      if(issues.length){issues.forEach(f=>failures.add(f.reason));continue;}options.push(raw);
    }};
    await collect(pool.options);
    if(!baseOnly&&!officialMeetings(a).length&&(!options.length||!options.some(o=>placement(a,o,state).sameSchool>0))){
      // Temporal adjacency changes when another course is accepted. Cached
      // constraints remain valid, but cached time choices are not exhaustive.
      // Refresh only this flexible activity, never the national snapshot.
      const extra=await generatePool(a,state),seen=new Set(pool.options.map(o=>JSON.stringify([o.instructorEmpId,o.meetings]))),fresh=extra.options.filter(o=>!seen.has(JSON.stringify([o.instructorEmpId,o.meetings])));
      pool={...pool,options:[...pool.options,...fresh],incomplete:pool.incomplete||extra.incomplete};candidatePools.set(id,pool);await collect(fresh);
    }
    const finalists=baseOnly?options:shortlist(a,options,state,8).map(raw=>scoring(context,state,a,raw));
    if(!baseOnly)for(const option of finalists)option.opportunityCost=opportunityCost(a,option);
    finalists.sort(baseOnly?(a,b)=>a.instructorEmpId.localeCompare(b.instructorEmpId):(a,b)=>a.opportunityCost-b.opportunityCost||compareCandidatesStable(a,b));
    return {...pool,options:finalists,failures:[...failures]};
  }
  const urgencyOrder = { within_7: 0, within_14: 1, later: 2, none: 3 };
  const urgency = new Map(queue.map(a => [activityId(a), courseUrgency({ ...a, meetings: officialMeetings(a) }, input.today)]));
  const blocks = buildOperationalBlocks(queue.map(a => ({ course: { ...a, meetings: officialMeetings(a) }, status: 'ממתין' })));
  let completed = 0;
  const accept = async (a, result, option) => {
    const id = activityId(a); occupancy.remove(id);
    const row = option ? optionRow(a, option, result.options.slice(0, 12)) : { ...rowFor(a, officialMeetings(a)), sessions: courseSpec(a, input).sessions,
      kind: result.missing || result.incomplete ? 'missing' : 'recruitment', status: result.incomplete ? 'בדיקה לא הושלמה' : result.missing ? 'חסר מידע' : 'נדרש גיוס',
      reason: result.incomplete ? 'החיפוש המוגבל הסתיים ללא הוכחה שאין מדריך מתאים' : explainRejections(result.failures),
      diagnostics: { searchIncomplete: result.incomplete, recruitmentCertified: !result.missing && !result.incomplete, rejectionReasons: result.failures } };
    if (row.kind === 'recruitment' && !row.meetings.length) {
      const profile = {gender: ['male','female'].includes(a.required_instructor_gender) ? a.required_instructor_gender : 'female', instruction_languages:[a.instruction_language],friday_allowed:false};
      const hypothetical = {...context,profiles:{...context.profiles,__recruitment:profile},rules:new Map(context.rules),exceptions:new Map(context.exceptions)};
      hypothetical.rules.set('__recruitment',new Map(Array.from({length:5},(_,day)=>[day,[{weekday:day,available:true,start_time:'08:00',end_time:'16:00'}]])));
      const choices=[];for(const meetings of schedules(hypothetical,a,'__recruitment',courseSpec(a,input),input,null)){choices.push({meetings,startDate:meetings[0].date,endDate:meetings.at(-1).date,startTime:meetings[0].start_time,endTime:meetings[0].end_time});if(choices.length>=16)break;}
      if(choices.length){Object.assign(row,choices[0],{scheduleOptions:choices,diagnostics:{...row.diagnostics,hypotheticalRecruitmentSchedule:true}});}
      else {row.kind='missing';row.status='נדרש בירור מועדים';row.diagnostics.recruitmentCertified=false;}
    }
    if(!row.instructorEmpId && (baselineOptions.get(id)||[]).length){row.diagnostics.recruitmentCertified=false;row.diagnostics.operationalConflict=true;row.reason='קיימים מדריכים מתאימים, אך האפשרויות מתנגשות בתכנון הנוכחי; נדרש חיפוש החלפות או שינוי מועדים שאינם קבועים.';}
    if(incumbentExceptionInstructor.has(id)&&!row.instructorEmpId){row.kind='missing';row.status='נדרשת התאמת מועדים';row.reason='חריג זמינות נקודתי: המדריך הקבוע לא הוחלף. לא נמצאה הזזה חוקית; מועדים רשמיים מחייבים אישור לשינוי.';row.diagnostics.recruitmentCertified=false;}
    if(option)row.diagnostics={...row.diagnostics,selectionReason:'scarcity-and-operational-ranking',candidateAlternatives:result.options.length,opportunityCost:option.opportunityCost||0};
    row.dependencyInstructorIds = [...new Set([...(baselineOptions.get(id) || []).map(o => o.instructorEmpId), ...(row.instructorEmpId ? [row.instructorEmpId] : context.byInstructor.keys())])];
    rows.set(id, row); occupancy.add(row); completed++; metrics.activitiesComputed++; planningPerfCount("activitiesComputed");
    await report('תכנון בלוקים — מנוע חדש', completed, queue.length, id, row);
  };
  // Order operational blocks by region, but retain one nationwide occupancy.
  // Mixed-region blocks are deferred to the shared-border stage so they can
  // never be independently committed or given the same instructor twice.
  const regionalRank = (block) => {
    const districts = new Set(block.results.map(({ course }) => normalizeOperationalDistrict(course.district || course.school_district || course.authority_district)));
    if (districts.size !== 1) return 2;
    const district = [...districts][0];
    return district === 'צפון' ? 0 : district === 'דרום' ? 1 : 2;
  };
  // Defer expensive route-aware candidate search until the block's region
  // is reached. Keep every instructor eligible and one shared occupancy.
  const stagedBlocks = blocks.map((block, index) => ({ block, index, stage: regionalRank(block) }));
  // Restore scarcity-first ordering INSIDE each region. Deferring all pools
  // without ordering allowed flexible courses to consume scarce instructors.
  // Prepare one regional batch at a time; never precompute the entire country.
  async function* orderedRegionalBlocks() {
    for (const stage of [0, 1, 2]) {
      const stageBlocks = stagedBlocks.filter(entry => entry.stage === stage);
      if (!stageBlocks.length) continue;
      await report(['תכנון צפון — אילוצים ארציים', 'תכנון דרום — אילוצים ארציים', 'תכנון מרכז וגבולות — אילוצים ארציים'][stage], completed, queue.length);
      for (const { block } of stageBlocks) for (const { course: activity } of block.results) {
        const id = activityId(activity);
        if (baselineOptions.has(id)) continue;
        const result = await candidates(activity, occupancy, true);
        baselineOptions.set(id, result.options);
        baselineInfo.set(id, result);
      }
      const priority = ({ block }) => {
        const activities = block.results.map(item => item.course);
        const scarcity = Math.min(...activities.map(activity => new Set((baselineOptions.get(activityId(activity)) || []).map(option => option.instructorEmpId)).size));
        const urgent = Math.min(...activities.map(activity => urgencyOrder[urgency.get(activityId(activity)).urgencyBand] ?? 3));
        return { scarcity, urgent };
      };
      stageBlocks.sort((left, right) => {
        const a = priority(left), b = priority(right);
        return a.urgent - b.urgent || a.scarcity - b.scarcity || left.index - right.index;
      });
      for (const entry of stageBlocks) yield entry;
    }
  }
  for await (const { block } of orderedRegionalBlocks()) {
    await checkpoint(); const activities = block.results.map(r => r.course);
    let acceptedBlock = false;
    if (activities.length > 1) {
      const common = activities.map(a => new Set(baselineOptions.get(activityId(a)).map(o => o.instructorEmpId))).reduce((a, b) => new Set([...a].filter(id => b.has(id))));
      const choices = [];
      for (const empId of common) {
        const state = createOccupancy(context, [...anchors, ...rows.values()]), simulation = []; let valid = true;
        for (const a of activities) {
          const option = baselineOptions.get(activityId(a)).find(o => o.instructorEmpId === empId);
          if (!option || candidateFailures(context, state, a, option).length) { valid = false; break; }
          const scored = scoring(context, state, a, option); simulation.push({ a, scored }); state.add(optionRow(a, scored, []));
        }
        if (valid) choices.push({ simulation, representative: simulation.reduce((best, item) => best || item.scored, null), score: simulation.reduce((sum, item) => sum + item.scored.score, 0) });
      }
      for(const choice of choices)choice.opportunityCost=choice.simulation.reduce((sum,item)=>sum+opportunityCost(item.a,item.scored),0);
      choices.sort((a, b) => a.opportunityCost-b.opportunityCost || compareCandidatesStable(a.representative, b.representative) || b.score - a.score);
      if (choices.length) { for (const { a, scored } of choices[0].simulation) await accept(a, { options: [scored] }, scored); acceptedBlock = true; }
    }
    if (!acceptedBlock) for (const a of activities) { const result = await candidates(a, occupancy); await accept(a, result, result.options[0]); }
  }
  const orderedRows = () => targets.map(a => rows.get(activityId(a)) || rowFor(a, officialMeetings(a)));
  const validationInput = value => ({ ...input, constraintContext: context, rows: value, requiredActivities: targets });
  let at = performance.now(), base = orderedRows(), validation = await validatePlanWithRoutes(validationInput(base), checkpoint); metrics.validationMs += performance.now() - at;
  if (!validation.valid) throw schedulingError('planning_final_validation_failed', validation.failures);
  // A valid persisted incumbent is also a lower bound; recomputation must not
  // discard a better lawful plan merely because greedy ordering changed.
  const incumbent=targets.map(a=>previous.get(activityId(a)));
  if(incumbent.every(Boolean)){
    const checked=await validatePlanWithRoutes(validationInput(incumbent),checkpoint);
    if(checked.valid&&compareOperationalQuality(quality(incumbent),quality(base))>0){base=incumbent;for(const row of base)rows.set(row.courseId,row);validation=checked;}
  }
  let bestVerified=base,bestQuality=quality(base);
  const optimization={completed:true,basePreserved:false,optimal:false,scope:'bounded-neighborhood',algorithmRevision:'v37-operational-1',decisions:[],stages:[],candidateSearchIncomplete:[...candidatePools.values()].some(p=>p.incomplete)};
  const national=input.targetCourseIds==null||(input._nationalRun===true&&input.resumeFromCheckpoint===true);
  if(!input.skipSoftOptimization&&national&&input.allowGlobalRepair!==false){
    at=performance.now();
    const budget=Number.isFinite(input.optimizationBudgetMs)?Math.max(0,Math.min(input.optimizationBudgetMs,60000)):45000;
    const nodeBudget=Number.isFinite(input.optimizationNodeBudget)?Math.max(0,Math.min(input.optimizationNodeBudget,20000)):6000;
    const deadline=at+budget;let nodes=0;
    const stageLimit=(name,fallback)=>Number.isFinite(input.optimizationStageNodeBudgets?.[name])?Math.max(0,Math.min(input.optimizationStageNodeBudgets[name],20000)):fallback;
    const searchCheckpoint=async()=>{await checkpoint();if(++nodes>nodeBudget||performance.now()>deadline)throw schedulingError('planning_optimization_budget_exceeded');};
    const stateFor=current=>createOccupancy(context,[...anchors,...current.values()]);
    const canMove=(id,row)=>affected.has(id)&&!input.lockedOptions?.[id]&&!isProtectedActivity(context.byActivity.get(id))&&['proposal','fixed-proposal'].includes(row?.kind);

    const optionsFor=async(id,current)=>{
      const a=context.byActivity.get(id),state=stateFor(current),pool=candidatePools.get(id)||await generatePool(a);candidatePools.set(id,pool);
      // Rank legal against immutable anchors first, then global opportunity cost:
      // prefer fewer conflicts before testing multi-activity displacement.
      const ranked=[];
      for(const option of pool.options){const issues=candidateFailures(context,state,a,option),blockers=new Set();let barrier=false;
        for(const issue of issues){if(issue.reason==='overlap'){for(const m of option.meetings)for(const other of state.days.get(`${option.instructorEmpId}|${m.date}`)||[])if(other.courseId!==id&&(other.fullDay||isFullDaySchedulingActivity(a)||(minute(m.start_time)<other.end&&minute(m.end_time)>other.start)))blockers.add(other.courseId);}
          else if(issue.otherCourseId)blockers.add(issue.otherCourseId);else barrier=true;}
        if(barrier||[...blockers].some(b=>!canMove(b,current.get(b))))continue;
        ranked.push({option,blockers:blockers.size,placement:placement(a,option,state)});
      }
      ranked.sort(comparePlacement);
      // Diverse legal schedules for every instructor, rather than allowing the
      // first instructor's flexible schedules to consume the entire branch cap.
      const counts=new Map(),diverse=[];for(const item of ranked){const id=item.option.instructorEmpId,count=counts.get(id)||0;if(count<4){diverse.push(item.option);counts.set(id,count+1);}}
      return diverse.map(raw=>scoring(context,state,a,raw));
    };
    const blockersFor=async(id,option,current)=>{
      const a=context.byActivity.get(id),state=stateFor(current);await ensureCandidateRoutes(context,state,a,option);
      const issues=candidateFailures(context,state,a,option),blockers=new Set();
      for(const f of issues){
        if(f.reason==='overlap')for(const m of option.meetings){for(const other of state.days.get(`${option.instructorEmpId}|${m.date}`)||[]){if(other.courseId!==id&&(other.fullDay||isFullDaySchedulingActivity(a)||(minute(m.start_time)<other.end&&minute(m.end_time)>other.start)))blockers.add(other.courseId);}}
        else if(f.otherCourseId)blockers.add(f.otherCourseId);else return null;
      }
      return [...blockers].sort((a,b)=>(candidatePools.get(a)?.options.length||0)-(candidatePools.get(b)?.options.length||0)||a.localeCompare(b));
    };
    const acceptTrial=async(trial,reason)=>{
      const checked=validatePlan(validationInput(trial));if(!checked.valid)return false;
      const nextQuality=quality(trial);if(compareOperationalQuality(nextQuality,bestQuality)<=0)return false;
      const old=new Map(bestVerified.map(r=>[r.courseId,r]));const changes=trial.filter(r=>JSON.stringify([r.instructorEmpId,r.meetings])!==JSON.stringify([old.get(r.courseId)?.instructorEmpId,old.get(r.courseId)?.meetings])).map(r=>({courseId:r.courseId,from:old.get(r.courseId)?.instructorEmpId||null,to:r.instructorEmpId||null,reason}));
      trial=trial.map(row=>{const change=changes.find(d=>d.courseId===row.courseId);return change?{...row,diagnostics:{...row.diagnostics,optimizationDecision:change}}:row;});
      for(const row of trial)rows.set(row.courseId,row);bestVerified=trial;bestQuality=nextQuality;validation=checked;optimization.decisions.push(...changes);
      await report('שיפור ארצי מאומת — מנוע חדש',trial.length,trial.length,'',null,trial);return true;
    };
    try {
      await report('בסיס חוקי נשמר בזיכרון; תיקון ארצי',base.length,base.length,'',null,base);
      if(budget===0||nodeBudget===0)throw schedulingError('planning_optimization_budget_exceeded');
      // Progressive, deterministic neighborhoods; wall time is an emergency cap,
      // node limits are reproducible. No arbitrary first-24-victims slice.
      for(const depth of [1,3]){
        const beforeNodes=nodes,stageStart=performance.now();let gains=0;
        coverageLoop: for(const missing of bestVerified.filter(r=>!covered(r))){await searchCheckpoint();let localNodes=0;
          const localCheckpoint=async()=>{await searchCheckpoint();if(nodes-beforeNodes>stageLimit(depth===1?'coverage1':'coverage3',depth===1?100:160))throw schedulingError('planning_optimization_stage_budget_exceeded');if(++localNodes>(depth===1?40:80))throw schedulingError('planning_optimization_local_budget_exceeded');};
          let trial;try{trial=await augmentingSearch({rows:new Map(rows),targetId:missing.courseId,optionsFor,blockersFor,canMove,toRow:(id,option)=>optionRow(context.byActivity.get(id),option,[]),checkpoint:localCheckpoint,maxDepth:depth,branchLimit:depth===1?32:64});}catch(error){if(error.code==='planning_optimization_stage_budget_exceeded'){optimization.completed=false;optimization.stageBudgetStops=(optimization.stageBudgetStops||0)+1;break coverageLoop;}if(error.code!=='planning_optimization_local_budget_exceeded')throw error;optimization.localBudgetStops=(optimization.localBudgetStops||0)+1;optimization.completed=false;continue;}
          if(trial&&await acceptTrial(targets.map(a=>trial.get(activityId(a))),'augmenting-chain'))gains++;
        }optimization.stages.push({name:'coverage',depth,nodes:nodes-beforeNodes,gains,elapsedMs:performance.now()-stageStart});
      }
      // Coverage is now fixed. Improve lawful schedules by the same strict
      // lexicographic objective; never buy continuity with lost teaching hours.
      const stageStart=performance.now(),beforeNodes=nodes;let gains=0;
      qualityLoop: for(const row of [...rows.values()].sort((a,b)=>a.courseId.localeCompare(b.courseId))){if(nodes-beforeNodes>=stageLimit('quality',200)||performance.now()>deadline-Math.min(5000,budget/4)){optimization.completed=false;optimization.qualityBudgetStop=true;break;}if(!canMove(row.courseId,row))continue;
        const a=context.byActivity.get(row.courseId),state=stateFor(rows);state.remove(row.courseId);
        const options=await candidates(a,state);const seen=new Set(),counts=new Map();let count=0;
        for(const option of options.options){const key=JSON.stringify([option.instructorEmpId,option.meetings]);if(seen.has(key))continue;seen.add(key);const n=counts.get(option.instructorEmpId)||0;if(n>=3)continue;counts.set(option.instructorEmpId,n+1);if(++count>72)break;if(nodes-beforeNodes>=stageLimit('quality',200)){optimization.completed=false;optimization.qualityBudgetStop=true;break qualityLoop;}await searchCheckpoint();
          const trial=orderedRows().map(r=>r.courseId===row.courseId?optionRow(a,option,options.options.slice(0,12)):r);
          if(await acceptTrial(trial,'operational-quality')){gains++;break;}
        }
      }optimization.stages.push({name:'operational-quality',nodes:nodes-beforeNodes,gains,elapsedMs:performance.now()-stageStart});
      // Better packing can open windows that did not exist during the coverage
      // pass. Recheck uncovered activities after it, with refreshed adjacency.
      const recoveryStart=performance.now();let recovered=0;
      for(const missing of bestVerified.filter(r=>!covered(r))){await searchCheckpoint();const a=context.byActivity.get(missing.courseId),result=await candidates(a,stateFor(rows));if(!result.options.length)continue;
        const trial=orderedRows().map(r=>r.courseId===missing.courseId?optionRow(a,result.options[0],result.options.slice(0,12)):r);if(await acceptTrial(trial,'opened-window-recovery'))recovered++;
      }optimization.stages.push({name:'opened-window-recovery',gains:recovered,elapsedMs:performance.now()-recoveryStart});
    } catch(error){if(input.signal?.aborted)throw schedulingError('planning_cancelled');if(error.code==='planning_cancelled')throw error;optimization.completed=false;optimization.basePreserved=true;optimization.failure=error.code||error.message;}
    optimization.nodes=nodes;optimization.budgetMs=budget;optimization.nodeBudget=nodeBudget;
    base=bestVerified;validation=validatePlan(validationInput(base));metrics.optimizationMs=performance.now()-at;
  }
  await report('אימות סופי — מנוע חדש', base.length, base.length, '', null, base);
  await checkpoint(); if (!validation.valid) throw schedulingError('planning_final_validation_failed', validation.failures);
  const models=recruitmentModels(base,context);
  base=base.map(row=>{const model=models.find(m=>m.activityIds.includes(row.courseId));if(!model)return row;
    const meetings=model.meetings.filter(m=>m.courseId===row.courseId).map(({date,meeting_no,start_time,end_time})=>({date,meeting_no,start_time,end_time}));
    return {...row,meetings,startDate:meetings[0]?.date||'',endDate:meetings.at(-1)?.date||'',startTime:meetings[0]?.start_time||'',endTime:meetings[0]?.end_time||'',recruitmentProfileId:model.id,recruitmentProfileLabel:`דרישות גיוס ${models.indexOf(model)+1}`,recruitmentProfileSize:model.activityIds.length};
  });
  validation=validatePlan(validationInput(base));if(!validation.valid)throw schedulingError('planning_final_validation_failed',validation.failures);
  base = base.map(row => { const issues=validation.warnings.filter(w=>w.courseId===row.courseId);
    return issues.length ? {...row, validationState:'protected-source', diagnostics:{...row.diagnostics, protectedSourceIssueCodes:[...new Set(issues.map(w=>w.reason))], protectedSourceIssueCount:issues.length}, reason:'שיבוץ מקור מוגן נשמר ללא שינוי; נדרשת בדיקת חריגות המקור: '+[...new Set(issues.map(w=>w.reason))].join(' · ')} : {...row, validationState:row.kind==='recruitment'?'requirements-only':'validated', diagnostics:{...row.diagnostics, softOptimizationIncomplete:!optimization.completed}};
  });
  return { rows: base, total: base.length, planned: base.filter(covered).length, engineVersion: ENGINE_VERSION, finalPlanValidation: validation,
    locked: base.filter(r=>r.planningLocked).length, missing:base.filter(r=>r.kind==='missing').length, recruitment:base.filter(r=>r.kind==='recruitment').length,
    optimization, quality: {...quality(base),recruitmentProfiles:models.length}, newEngineMetrics: { ...metrics, elapsedMs: performance.now() - started }, recruitmentProfiles: models };
}
