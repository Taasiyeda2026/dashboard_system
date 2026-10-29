import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const functions=[
 ['supabase/migrations/20260928160507_fix_attendance_approval_input_regexes.sql','av2_submit_attendance_month'],
 ['supabase/migrations/20260927053500_attendance_manager_record_reviews.sql','attendance_manager_can_review_employee'],
 ['supabase/migrations/20261013042258_unified_attendance_travel_time_cancellation.sql','av2_month_open_travel_reviews'],
 ['supabase/migrations/20261013042258_unified_attendance_travel_time_cancellation.sql','manager_finalize_attendance_month_review'],
 ['supabase/migrations/20261004205500_admin_attendance_payroll_dispatch.sql','admin_finalize_attendance_month_payroll'],
 ['supabase/migrations/20261004205500_admin_attendance_payroll_dispatch.sql','admin_send_attendance_month_to_payroll']
];export async function prepareSourceRPCs(workdir='work/notification-staging') {
let sql='';const manifest=[];
for(const [path,name] of functions){const source=await readFile(path,'utf8');const begin=source.indexOf(`create or replace function public.${name}(`);if(begin<0)throw Error(name);const body=source.indexOf('$$',begin);const end=source.indexOf('$$;',body+2)+3;if(end<begin)throw Error(name);sql+=source.slice(begin,end)+'\n';manifest.push({name,path,body:'unchanged repository definition',sha256:createHash('sha256').update(source.slice(begin,end)).digest('hex')});}
// Supabase default PUBLIC EXECUTE is explicitly removed for the isolated source RPCs too.
for(const {name} of manifest)sql+=`do $q$ declare f regprocedure; begin for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='${name}' loop execute format('revoke all on function %s from public,anon',f); execute format('grant execute on function %s to authenticated',f); end loop;end $q$;\n`;
await writeFile(`${workdir}/source-rpcs.sql`,sql);await writeFile(`${workdir}/source-rpcs.json`,JSON.stringify(manifest,null,2));

}
