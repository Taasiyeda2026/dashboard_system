// MANUAL ONLY. Disposable localhost Supabase stack; refuses all remote endpoints.
// Reduced fixture schema + unmodified repository attendance RPC bodies + actual PR
// notification migration/Auth/PostgREST/Realtime. This is NOT a full production clone.
import { execFileSync,spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createNotificationService} from '../frontend/src/notifications/service.js';
import {chromium} from 'playwright';
import {prepareSourceRPCs} from './fixtures/central-notifications/prepare-rpcs.mjs';
const workdir='work/notification-staging';const dbContainer='supabase_db_notifications-pr2458';
const dockerEnv={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const status=JSON.parse(execFileSync(process.env.NOTIFICATIONS_SUPABASE_CLI||'supabase',['status','--workdir',workdir,'--output','json'],{encoding:'utf8',env:dockerEnv,stdio:['ignore','pipe','pipe']}));
const url=status.API_URL;if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Disposable localhost stack required');
const sql=source=>{const r=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',dbContainer,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:source,encoding:'utf8',env:dockerEnv});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const bootstrap=await readFile('tests/fixtures/central-notifications/local-schema.sql','utf8');
// Refuse an accidental second initialization over an existing test run.
assert.equal(sql("select count(*) from information_schema.tables where table_schema='public' and table_name='dashboard_notifications'"),'0');
sql(bootstrap);
await prepareSourceRPCs(workdir);
sql(await readFile(`${workdir}/source-rpcs.sql`,'utf8'));
const admin=createClient(url,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const password=`Local-only-${randomUUID()}!`;
const identities={employee:{role:'instructor',emp:'10',name:'מדריך בדיקה'},staff:{role:'employee',emp:'20',name:'עובדת מטה בדיקה'},manager:{role:'activities_manager',name:'מנהל בדיקה'},idan:{role:'admin',username:'idann',name:'עידן — בדיקה'},toni:{role:'finance',username:'tonin',name:'טוני — בדיקה'},outsider:{role:'employee',emp:'21',name:'משתמש אחר — בדיקה'}};
const quote=v=>v===null?'null':`'${String(v).replaceAll("'","''")}'`;
for(const [name,identity] of Object.entries(identities)){
 identity.email=`${name}@notifications.local`;const {data,error}=await admin.auth.admin.createUser({email:identity.email,password,email_confirm:true});if(error)throw error;identity.id=data.user.id;
 sql(`insert into users(user_id,auth_user_id,username,role,full_name,emp_id,permissions) values(${quote(name)},${quote(identity.id)},${quote(identity.username||name)},${quote(identity.role)},${quote(identity.name)},${quote(identity.emp||null)},'{"view_attendance_control":"yes","view_finance_payroll":"yes","personal_reports_manager":"yes","manage_proposals_agreements":"yes"}');insert into profiles values(${quote(identity.id)},${quote(identity.email)},${quote(identity.name)},${quote(name==='idan'?'admin':'employee')},true,true);`);
 const client=createClient(url,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email:identity.email,password});if(login.error)throw login.error;identity.client=client;identity.service=createNotificationService(client);
}
sql(`insert into contacts_instructors(emp_id,full_name,direct_manager) values(10,${quote(identities.employee.name)},${quote(identities.manager.name)});insert into employee_profiles values('staff','20',${quote(identities.manager.name)},${quote(identities.staff.name)});insert into attendance_records(emp_id,report_date) values(10,'2026-10-29');insert into attendance_manager_record_reviews select id,emp_id,'2026-10','approved',updated_at from attendance_records;`);
sql(await readFile('supabase/migrations/20261029191937_central_notifications.sql','utf8'));
sql("notify pgrst,'reload schema';");
const results=[],wire={};const channels=[];
const wait=async predicate=>{const deadline=Date.now()+20000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for actual local event');};
const ok=async promise=>{const result=await promise;if(result.error)throw result.error;return result.data;};
for(const name of ['employee','manager','idan','toni','outsider']){
 wire[name]=[];const actor=identities[name];
 const channel=actor.client.channel(`integration-${name}-${Date.now()}`).on('postgres_changes',{event:'*',schema:'public',table:'dashboard_notifications',filter:`recipient_auth_user_id=eq.${actor.id}`},payload=>wire[name].push({table:'notifications',type:payload.eventType,id:payload.new.id,domain:payload.new.domain,event:payload.new.event_type})).on('postgres_changes',{event:'*',schema:'public',table:'dashboard_notification_tasks',filter:`recipient_auth_user_id=eq.${actor.id}`},payload=>wire[name].push({table:'tasks',type:payload.eventType,id:payload.new.id,closed:!!payload.new.closed_at}));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Realtime subscribe timeout: ${name}`)),20000);channel.subscribe(state=>{if(state==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(state==='CHANNEL_ERROR'){clearTimeout(timer);reject(Error(`Realtime channel error: ${name}`));}});});channels.push([actor.client,channel]);
}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const contexts=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'he-IL',timezoneId:'Asia/Jerusalem'});contexts.push(context);const page=await context.newPage();
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.goto('http://127.0.0.1:5187/tests/fixtures/central-notifications/index.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(config=>window.localSupabaseScenario(config),{url,anonKey:status.ANON_KEY,email:identities.manager.email,password,role:'activities_manager'});
 await ok(identities.employee.client.rpc('av2_submit_attendance_month',{p_month_key:'2026-10',p_submitted_by_name:identities.employee.name}));
 await wait(()=>wire.manager.some(e=>e.event==='employee_submitted'));
 assert.deepEqual(await identities.manager.service.counts(),{tasks:1,unread:1});assert.deepEqual(await identities.toni.service.counts(),{tasks:0,unread:0});assert.equal((await identities.outsider.service.counts()).tasks,0);
 await page.waitForFunction(()=>document.querySelector('[data-notification-task-count]')?.textContent==='1');
 await page.locator('[data-notification-tab=updates]').click();await page.locator('[data-notification-read]').click();
 await wait(async()=> (await identities.manager.service.counts()).unread===0);assert.equal((await identities.manager.service.counts()).tasks,1);
 await ok(identities.employee.client.rpc('av2_submit_attendance_month',{p_month_key:'2026-10',p_submitted_by_name:identities.employee.name}));
 assert.equal((await identities.manager.service.page()).rows.length,1);
 results.push({case:'employee submit, real manager WebSocket delivery, browser read propagated to second client, no duplicates',passed:true});
 await ok(identities.manager.client.rpc('manager_finalize_attendance_month_review',{p_employee_id:'10',p_month_key:'2026-10',p_manager_name:identities.manager.name,p_manager_pdf_sharepoint_url:'https://local-fixture.invalid/report.pdf',p_manager_pdf_file_name:'fixture.pdf',p_manager_approved_snapshot:{employeeName:identities.employee.name}}));
 await wait(()=>wire.idan.some(e=>e.event==='manager_approved'));await wait(()=>wire.manager.some(e=>e.table==='tasks'&&e.closed));
 assert.equal((await identities.manager.service.counts()).tasks,0);assert.equal((await identities.idan.service.tasks())[0].stage,'final_review');
 await page.waitForFunction(()=>document.querySelector('[data-notification-task-count]')?.textContent==='0');
 results.push({case:'manager approval using repository RPC closes manager task and delivers final review to Idan',passed:true});
 await ok(identities.idan.client.rpc('admin_finalize_attendance_month_payroll',{p_employee_id:'10',p_month_key:'2026-10',p_final_approved_by_name:identities.idan.name}));
 assert.equal((await identities.idan.service.tasks())[0].stage,'dispatch');assert.equal((await identities.toni.service.page()).rows.length,0);
 await ok(identities.idan.client.rpc('admin_send_attendance_month_to_payroll',{p_employee_id:'10',p_month_key:'2026-10',p_sent_by_name:identities.idan.name}));
 await wait(()=>wire.toni.some(e=>e.event==='dispatched_to_payroll'));assert.deepEqual(await identities.toni.service.counts(),{tasks:0,unread:1});assert.equal((await identities.idan.service.counts()).tasks,0);
 await ok(identities.idan.client.rpc('admin_send_attendance_month_to_payroll',{p_employee_id:'10',p_month_key:'2026-10',p_sent_by_name:identities.idan.name}));
 assert.equal((await identities.toni.service.page()).rows.length,1);assert.equal(sql('select count(*) from payroll_attendance_dispatches'),'1');
 results.push({case:'Idan final approval, explicit dispatch, Toni real WebSocket, repeated dispatch idempotent',passed:true});
 const proposalId=randomUUID();await ok(identities.staff.client.from('proposals_agreements').insert({id:proposalId,created_by:'staff',status:'draft',quote_number:'1045',client_authority:'לקוח בדיקה'}));
 await ok(identities.staff.client.from('proposals_agreements').update({status:'pending_approval'}).eq('id',proposalId));
 await wait(()=>wire.idan.some(e=>e.event==='awaiting_signature'));assert.equal((await identities.idan.service.tasks()).some(t=>t.entity_key===proposalId&&t.stage==='sign'),true);
 await ok(identities.idan.client.from('proposals_agreements').update({status:'approved',approved_at:new Date().toISOString(),approved_by:identities.idan.id,signature_meta:{signer_name:identities.idan.name,signature:{image:'fixture-signature'}}}).eq('id',proposalId));
 const approved=await identities.staff.service.page();assert.equal(approved.rows.some(n=>n.entity_key===proposalId&&n.event_type==='approved'),true);
 await ok(identities.idan.client.from('proposals_agreements').update({status:'returned_for_changes',approval_note:'תיקון בדיקה'}).eq('id',proposalId));
 assert.equal((await identities.staff.service.page()).rows.filter(n=>n.entity_key===proposalId).length,2);
 results.push({case:'proposal awaiting signature, approved and returned to responsible owner; source status capture and RLS',passed:true,limit:'reduced source policies; does not validate full signature modal/PDF business rules'});
 const reportId=randomUUID();await ok(identities.staff.client.from('personal_reports').insert({id:reportId,employee_id:identities.staff.id,report_month:10,report_year:2026,status:'draft'}));
 await ok(identities.staff.client.from('personal_reports').update({status:'submitted'}).eq('id',reportId));
 await ok(identities.idan.client.from('personal_reports').update({status:'needs_correction',correction_note:'תיקון לבדיקה'}).eq('id',reportId));
 await ok(identities.staff.client.from('personal_reports').update({status:'submitted'}).eq('id',reportId));
 await ok(identities.idan.client.from('personal_reports').update({status:'approved'}).eq('id',reportId));
 assert.equal((await identities.staff.service.page()).rows.filter(n=>n.entity_key===reportId).length,2);
 assert.equal((await identities.idan.service.page()).rows.some(n=>n.entity_key===reportId&&n.event_type==='resubmitted'),true);
 assert.equal((await identities.idan.service.tasks()).some(n=>n.entity_key===reportId),false);
 results.push({case:'personal report submitted, returned, resubmitted and approved with private recipient history',passed:true,limit:'direct status write path; named production correction RPC is not defined in repository fixture'});
 assert.equal((await identities.outsider.service.page()).rows.length,0);assert.equal(wire.outsider.length,0);
 const foreign=(await identities.toni.service.page()).rows[0];assert.equal(await identities.outsider.service.markRead(foreign.id),false);
 assert.deepEqual(await identities.outsider.service.details([foreign]),{});
 results.push({case:'six-user RLS isolation, no outsider WebSocket events, foreign read and label access denied',passed:true});
 const escalation=await identities.staff.client.from('profiles').update({role:'admin'}).eq('id',identities.staff.id);assert.equal(escalation.error?.code,'42501');
 results.push({case:'sensitive profile self-escalation blocked through actual authenticated REST',passed:true});
 await mkdir(`${workdir}/live-evidence`,{recursive:true});await page.screenshot({path:`${workdir}/live-evidence/manager-after-actions.png`,fullPage:true,animations:'disabled'});
 await writeFile(`${workdir}/live-results.json`,JSON.stringify({environment:'disposable local Supabase CLI/Docker',api:'localhost only',productionAccess:false,fixture:'reduced source schema; actual notification migration; actual repository attendance RPC bodies',results,wire},null,2));
 console.log(JSON.stringify({passed:results.length,webSocketRecipients:Object.entries(wire).map(([name,events])=>({name,events:events.length})),limitations:results.filter(r=>r.limit||r.remaining)}));
}finally{for(const [client,channel] of channels)await client.removeChannel(channel);for(const ctx of contexts)await ctx.close();await browser.close();for(const actor of Object.values(identities))await actor.client.auth.signOut();}
