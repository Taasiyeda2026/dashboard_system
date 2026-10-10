import { planningPerfCount } from '../course-scheduling-perf.js';
import { recruitmentModels } from './recruitment.js';
import { computeSchedulingScore, compareCandidatesStable, courseUrgency } from '../course-scheduling-score.js';
import { buildOperationalBlocks } from '../course-scheduling-engine.js';
import { resolveCourseSchedulingPeriod } from '../course-scheduling-periods.js';
import { isSchedulingActivityActive, schedulingActivityTypeCategory, isFullDaySchedulingActivity } from '../shared/activity-scheduling-eligibility.js';
import { normalizeOperationalDistrict } from '../shared/district-normalization.js';
import { compileConstraints, createOccupancy, candidateFailures, staticFailures, meetingFailures, knownRoute,
  ensureRoute, ensureCandidateRoutes, validatePlanWithRoutes, officialMeetings, isProtectedActivity, validatePlan, ENGINE_VERSION, text, activityId, minute, weekday, addDays } from './constraints.js';

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
  if (previous?.meetings?.length && previous.meetings[0].date >= start) yield previous.meetings;
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
        if (meetings.length === spec.sessions) yield meetings;
      }
    }
  }
}
function planQuality(rows, input) {
  const work = new Set(), newWork = new Set(), instructors = new Set(), prior = new Map((input.committedRows || []).map(r => [r.courseId, r]));
  let hours = 0, travelKm = 0, score = 0, changedDrafts = 0;
  for (const row of rows) {
    if (!covered(row)) continue; instructors.add(row.instructorEmpId);
    for (const m of row.meetings || []) { hours += (minute(m.end_time) - minute(m.start_time)) / 60; work.add(`${row.instructorEmpId}|${m.date}`); }
    if (row.kind !== 'live') {
      score += row.score || 0; travelKm += row.relevantTravelDistance || 0;
      for (const m of row.meetings || []) newWork.add(`${row.instructorEmpId}|${m.date}`);
      if (row.sourceHadDraft && prior.get(row.courseId)?.instructorEmpId !== row.instructorEmpId) changedDrafts++;
    }
  }
  return { covered: rows.filter(covered).length, uncovered: rows.filter(r => !covered(r)).length, recruitmentProfiles: recruitmentModels(rows, input.constraintContext || compileConstraints(input)).length,
    recruitment: rows.filter(r => r.kind === 'recruitment').length, changedDrafts, newWorkDayMeetings: newWork.size,
    totalTravelKm: travelKm, operationalScoreSum: score, meetingHours: hours, instructorsUsed: instructors.size, workDays: work.size };
}
function betterQuality(a, b) {
  for (const [key, direction] of [['covered', 1], ['recruitmentProfiles', -1], ['changedDrafts', -1], ['newWorkDayMeetings', -1], ['totalTravelKm', -1], ['operationalScoreSum', 1], ['uncovered', -1]]) {
    if (a[key] !== b[key]) return (a[key] - b[key]) * direction > 0;
  }
  return false;
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
  const baselineOptions = new Map(), baselineInfo = new Map();
  const limit = input.candidateBudgetPerInstructor || (input.planningProfile === 'fast' ? 96 : 384);
  async function candidates(a, state, baseOnly = false) {
    const id = activityId(a), spec = courseSpec(a, input), found = [], failures = new Set(); let incomplete = false;
    const missingData=staticFailures(context,a,'').filter(r=>['missing_school_data','missing_language'].includes(r));
    if(missingData.length)return {options:[],incomplete:false,missing:true,failures:missingData};
    if (officialMeetings(a).some(m => !Number.isFinite(minute(m.start_time)) || !Number.isFinite(minute(m.end_time)) || minute(m.end_time)<=minute(m.start_time))) return {options:[],incomplete:false,missing:true,failures:['source_time_conflict']};
    if (officialMeetings(a).some(m => meetingFailures(context,a,'',m).some(reason => ['calendar_block','calendar_end_time','saturday_sector'].includes(reason)))) return { options: [], incomplete: false, missing: true, failures: ['source_date_conflict'] };
    if (a.start_time && a.end_time && minute(a.end_time)-minute(a.start_time) !== spec.durationMinutes && !officialMeetings(a).length) return {options:[],incomplete:false,missing:true,failures:['source_duration_conflict']};
    if (!spec.complete) return { options: [], incomplete: false, missing: true, failures: ['missing_course_spec'] };
    for (const [empId, instructor] of context.byInstructor) {
      if ((input.optimizationOnlyCourseIds || []).includes(id) && previous.get(id)?.instructorEmpId !== empId) continue;
      await checkpoint();
      const nonRouteFailures=staticFailures(context,a,empId).filter(r=>r!=='home_route_unknown');
      if(nonRouteFailures.length){if(baseOnly)planningPerfCount('staticCandidatePruned');nonRouteFailures.forEach(r=>failures.add(r));continue;}
      if (!knownRoute(context, instructor.address, a.school_address)) await ensureRoute(context, instructor.address, a.school_address);
      const rejected = staticFailures(context, a, empId); if (rejected.length) { if(baseOnly)planningPerfCount('staticCandidatePruned'); rejected.forEach(r => failures.add(r)); continue; }
      let attempted = 0, accepted = 0;
      for (const meetings of schedules(context, a, empId, spec, input, previous.get(id), state)) {
        if (++attempted > limit) { incomplete = true; break; }
        metrics.generatedSchedules++; planningPerfCount("scenarioCount"); await checkpoint();
        if ((input.optimizationOnlyCourseIds || []).includes(id) && JSON.stringify(meetings.map(m=>m.date))!==JSON.stringify((previous.get(id)?.meetings || []).map(m=>m.date))) continue;
        const option = { instructorEmpId: empId, meetings, startDate: meetings[0].date, endDate: meetings.at(-1).date, startTime: meetings[0].start_time, endTime: meetings[0].end_time };
        await ensureCandidateRoutes(context, state, a, option);
        const issues = candidateFailures(context, state, a, option); metrics.candidateChecks++; planningPerfCount("candidateEvals");
        if (issues.length) { issues.forEach(f => failures.add(f.reason)); continue; }
        found.push(baseOnly ? option : scoring(context, state, a, option));
        // Keep a bounded set of real legal alternatives for each instructor;
        // finding one is sufficient for baseline scarcity, never a no-fit proof.
        if (++accepted >= (baseOnly ? 1 : 3)) break;
      }
    }
    found.sort(baseOnly ? (a, b) => a.instructorEmpId.localeCompare(b.instructorEmpId) : (a,b)=>b.score-a.score || a.idleGapMinutes-b.idleGapMinutes || compareCandidatesStable(a,b));
    return { options: found, incomplete, missing: failures.has('missing_school_data') || failures.has('missing_course_spec') || failures.has('missing_language') || failures.has('home_route_unknown') || (!found.length && failures.has('missing_profile_data')), failures: [...failures] };
  }
  for (const a of queue) { const result = await candidates(a, occupancy, true); baselineOptions.set(activityId(a), result.options); baselineInfo.set(activityId(a), result); }
  const urgencyOrder = { within_7: 0, within_14: 1, later: 2, none: 3 };
  const urgency = new Map(queue.map(a => [activityId(a), courseUrgency({ ...a, meetings: officialMeetings(a) }, input.today)]));
  queue.sort((a, b) => { const au = urgency.get(activityId(a)), bu = urgency.get(activityId(b)); return urgencyOrder[au.urgencyBand] - urgencyOrder[bu.urgencyBand]
    || new Set(baselineOptions.get(activityId(a)).map(o => o.instructorEmpId)).size - new Set(baselineOptions.get(activityId(b)).map(o => o.instructorEmpId)).size
    || text(au.nextUpcomingMeetingDate).localeCompare(text(bu.nextUpcomingMeetingDate)) || activityId(a).localeCompare(activityId(b)); });
  const blocks = buildOperationalBlocks(queue.map(a => ({ course: { ...a, meetings: officialMeetings(a) }, status: 'ממתין' })));
  let completed = 0;
  const accept = async (a, result, option) => {
    const id = activityId(a); occupancy.remove(id);
    const row = option ? optionRow(a, option, result.options.slice(0, 12)) : { ...rowFor(a, officialMeetings(a)), sessions: courseSpec(a, input).sessions,
      kind: result.missing || result.incomplete ? 'missing' : 'recruitment', status: result.incomplete ? 'בדיקה לא הושלמה' : result.missing ? 'חסר מידע' : 'נדרש גיוס',
      reason: result.incomplete ? 'החיפוש המוגבל הסתיים ללא הוכחה שאין מדריך מתאים' : result.failures.join(' · ') || 'נדרש גיוס לאחר מיצוי אפשרויות הצוות הקיים',
      diagnostics: { searchIncomplete: result.incomplete, recruitmentCertified: !result.missing && !result.incomplete, rejectionReasons: result.failures } };
    if (row.kind === 'recruitment' && !row.meetings.length) {
      const profile = {gender: ['male','female'].includes(a.required_instructor_gender) ? a.required_instructor_gender : 'female', instruction_languages:[a.instruction_language],friday_allowed:false};
      const hypothetical = {...context,profiles:{...context.profiles,__recruitment:profile},rules:new Map(context.rules),exceptions:new Map(context.exceptions)};
      hypothetical.rules.set('__recruitment',new Map(Array.from({length:5},(_,day)=>[day,[{weekday:day,available:true,start_time:'08:00',end_time:'16:00'}]])));
      const choices=[];for(const meetings of schedules(hypothetical,a,'__recruitment',courseSpec(a,input),input,null)){choices.push({meetings,startDate:meetings[0].date,endDate:meetings.at(-1).date,startTime:meetings[0].start_time,endTime:meetings[0].end_time});if(choices.length>=16)break;}
      if(choices.length){Object.assign(row,choices[0],{scheduleOptions:choices,diagnostics:{...row.diagnostics,hypotheticalRecruitmentSchedule:true}});}
      else {row.kind='missing';row.status='נדרש בירור מועדים';row.diagnostics.recruitmentCertified=false;}
    }
    row.dependencyInstructorIds = [...new Set([...(baselineOptions.get(id) || []).map(o => o.instructorEmpId), ...(row.instructorEmpId ? [row.instructorEmpId] : context.byInstructor.keys())])];
    rows.set(id, row); occupancy.add(row); completed++; metrics.activitiesComputed++; planningPerfCount("activitiesComputed");
    await report('תכנון בלוקים — מנוע חדש', completed, queue.length, id, row);
  };
  for (const block of blocks) {
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
      choices.sort((a, b) => compareCandidatesStable(a.representative, b.representative) || b.score - a.score);
      if (choices.length) { for (const { a, scored } of choices[0].simulation) await accept(a, { options: [scored] }, scored); acceptedBlock = true; }
    }
    if (!acceptedBlock) for (const a of activities) { const result = await candidates(a, occupancy); await accept(a, result, result.options[0]); }
  }
  const orderedRows = () => targets.map(a => rows.get(activityId(a)) || rowFor(a, officialMeetings(a)));
  const validationInput = value => ({ ...input, constraintContext: context, rows: value, requiredActivities: targets });
  let at = performance.now(), base = orderedRows(), validation = await validatePlanWithRoutes(validationInput(base), checkpoint); metrics.validationMs += performance.now() - at;
  if (!validation.valid) throw schedulingError('planning_final_validation_failed', validation.failures);
  const verifiedBase = base, baselineQuality = planQuality(base, input); let bestVerified = base, optimization = { completed: true, basePreserved: false };
  if (!input.skipSoftOptimization && (input.targetCourseIds == null || (input._nationalRun === true && input.resumeFromCheckpoint === true)) && input.allowGlobalRepair !== false && base.some(r => !covered(r))) {
    at = performance.now();
    try {
      await report('בסיס חוקי נשמר בזיכרון; תיקון ארצי', base.length, base.length, '', null, base);
      // Bounded augmenting reassignment: only unprotected generated proposals
      // can be displaced; every replacement is rechecked against current state.
      const deadline = performance.now() + (input.optimizationBudgetMs || 5000);
      for (const missing of base.filter(r => !covered(r))) {
        await checkpoint(); const a = context.byActivity.get(missing.courseId), candidatesToMove = [...rows.values()].filter(r => covered(r) && ['proposal', 'fixed-proposal'].includes(r.kind)).slice(0, 24);
        for (const movable of candidatesToMove) {
          if (performance.now() > deadline) throw schedulingError('planning_optimization_budget_exceeded');
          const state = createOccupancy(context, [...anchors, ...rows.values()]); state.remove(movable.courseId);
          const result = await candidates(a, state); const chosen = result.options[0]; if (!chosen) continue;
          const replacement = optionRow(a, chosen, result.options.slice(0, 12)); state.add(replacement);
          const otherActivity = context.byActivity.get(movable.courseId), other = await candidates(otherActivity, state), next = other.options[0];
          if (!next) continue;
          const trial = orderedRows().map(r => r.courseId === missing.courseId ? replacement : r.courseId === movable.courseId ? optionRow(otherActivity, next, other.options.slice(0, 12)) : r);
          const checked = validatePlan(validationInput(trial));
          if (checked.valid && betterQuality(planQuality(trial, input), planQuality(orderedRows(), input))) { rows.set(replacement.courseId, replacement); rows.set(movable.courseId, optionRow(otherActivity, next, other.options.slice(0, 12))); bestVerified = trial; break; }
        }
      }
      base = orderedRows(); validation = validatePlan(validationInput(base));
      if (!validation.valid || !betterQuality(planQuality(base, input), baselineQuality)) { base = verifiedBase; validation = validatePlan(validationInput(base)); optimization.basePreserved = true; }
    } catch (error) {
      if (input.signal?.aborted || error.code === 'planning_cancelled') throw error;
      base = bestVerified; validation = validatePlan(validationInput(base)); optimization = { completed: false, basePreserved: true, failure: error.code || error.message };
    }
    metrics.optimizationMs = performance.now() - at;
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
    optimization, quality: planQuality(base, input), newEngineMetrics: { ...metrics, elapsedMs: performance.now() - started }, recruitmentProfiles: models };
}
