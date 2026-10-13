import {snapshotHash,GatewayError} from './gateway.mjs';
const text=v=>String(v??'').trim().replace(/\s+/g,' '),time=v=>text(v).slice(0,5);
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(text(v))?['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][new Date(text(v)+'T12:00:00Z').getUTCDay()]:'';
const fields=['רשות','בית ספר','תוכנית','מספר גפן','מדריך','מצב','יום','תחילה','משעה','עד שעה','מפגשים'];
export function buildSyncPreview({sheet,database}){
 if(sheet.values?.[3]?.[16]!=='מזהה קורס')throw new GatewayError('sheet_header_mismatch',409);
 const byId=new Map(database.rows.map(r=>[text(r.activityId),r]));
 if(byId.size!==database.rows.length)throw new GatewayError('duplicate_database_id',409);
 const seen=new Set(),results=[];
 for(const [index,row] of sheet.values.slice(4).entries()){
  if(!row.some(v=>text(v)))continue;
  const id=text(row[16]);
  if(!id||seen.has(id))throw new GatewayError('missing_or_duplicate_sheet_id',409);seen.add(id);
  const d=byId.get(id);
  if(!d){results.push({sheetRow:index+5,activityId:id,category:'missing_database',changes:[],blocked:true});continue;}
  const p=d.planning||{},approved=d.instructorId!=null;
  const instructor=approved?d.instructorName:p.instructorName||'—';
  const state=approved?'מאושר':instructor&&instructor!=='—'?'טיוטה לתיאום':'חסר מדריך';
  const startDate=approved?d.startDate:p.startDate||'';
  const desired=[d.authority,d.school,d.program,d.programId,instructor,state,day(startDate),startDate,time(approved?d.startTime:p.startTime),time(approved?d.endTime:p.endTime),d.sessions];
  const columns=[0,1,2,3,4,6,7,8,9,10,11],changes=[];
  columns.forEach((col,i)=>{if(text(row[col])!==text(desired[i]))changes.push({field:fields[i],column:col+1,before:row[col]??'',after:desired[i]??''});});
  if(text(row[12])!==text(d.activityManager))changes.push({field:'מנהל',column:13,before:row[12]??'',after:d.activityManager??''});
  if(/ערבית/.test(text(row[5]))&&d.instructionLanguage!=='ar')changes.push({field:'שפה',column:6,before:row[5],after:d.instructionLanguage,requiresBusinessDecision:true});
  results.push({sheetRow:index+5,activityId:id,category:changes.length?'different':'matching',changes,approved,needsRecalc:!!d.needsRecalc,blocked:!!d.needsRecalc});
 }
 return {mode:'dry_run',writes:0,rows:results,counts:results.reduce((o,r)=>(o[r.category]=(o[r.category]||0)+1,o),{}),
 missingSheet:database.rows.filter(r=>!seen.has(text(r.activityId))).map(r=>({activityId:r.activityId,startDate:r.startDate||r.planning?.startDate||''})),
 policy:'Review-only diff. No inserts, deletions, school-agreed date changes or overwrite of manual sheet choices.'};
}
export async function dryRunSync(input){
 const before=await snapshotHash(input),result=buildSyncPreview(input),after=await snapshotHash(input);
 if(before!==after)throw new GatewayError('dry_run_mutated_input',500);
 return {...result,beforeHash:before,afterHash:after,inputPreserved:true};
}
