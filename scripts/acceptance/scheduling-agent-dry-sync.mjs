// Reads an already authorized LOCAL snapshot; no network, credentials, or writers.
import {readFileSync,writeFileSync} from 'node:fs';
import {dryRunSync} from '../../supabase/functions/scheduling-agent-gateway/sync-preview.mjs';
const [snapshotPath,outputPath]=process.argv.slice(2);
if(!snapshotPath||!outputPath)throw Error('Usage: node scripts/acceptance/scheduling-agent-dry-sync.mjs SNAPSHOT OUTPUT');
const s=JSON.parse(readFileSync(snapshotPath));
const details=new Map(s.activityDetails.map(a=>[a.row_id,a])),plans=new Map(s.plan.map(p=>[p.activity_id,p]));
const rows=s.db.map(d=>{const a=details.get(d.row_id),p=plans.get(d.row_id);return {activityId:d.row_id,
 school:d.school,authority:d.authority,program:d.activity_name,programId:d.activity_no,
 instructorId:d.emp_id,instructorName:d.instructor_name,startDate:a.start_date,startTime:a.start_time,endTime:a.end_time,
 sessions:a.sessions,activityManager:a.activity_manager,instructionLanguage:a.instruction_language,needsRecalc:d.needs_recalc,
 planning:{instructorName:p.name,startDate:p.start,startTime:p.start_time,endTime:p.end_time}};});
const sheet={...s.sheet,values:[...s.headers.values,...s.sheet.values]};
const input={sheet,database:{sourceRevision:String(s.sourceState[0].revision),workspaceRevision:String(s.workspaces[0].revision),rows}};
const result=await dryRunSync(input);writeFileSync(outputPath,JSON.stringify(result,null,2));
console.log(JSON.stringify({rows:result.rows.length,counts:result.counts,missingSheet:result.missingSheet.length,writes:result.writes,inputPreserved:result.inputPreserved,beforeHash:result.beforeHash,afterHash:result.afterHash}));
