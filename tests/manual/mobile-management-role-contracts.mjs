// Manual only. Actual GoTrue identities; optional mutation is restricted to synthetic localhost fixtures.
import {createClient} from '@supabase/supabase-js';import{readFile,writeFile}from'node:fs/promises';import assert from'node:assert/strict';
const accounts=JSON.parse(await readFile(process.env.MOBILE_QA_ACCOUNTS_FILE || 'work/real-auth-accounts.json'));
const appUrl=process.env.MOBILE_QA_SUPABASE_URL || 'http://127.0.0.1:54321';
if(!['localhost','127.0.0.1'].includes(new URL(appUrl).hostname))throw Error('Localhost Supabase required');
const anon=process.env.MOBILE_QA_ANON_KEY;
if(!anon)throw Error('MOBILE_QA_ANON_KEY required');
const results=[];
for(const a of accounts){
 const c=createClient(appUrl,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const lookup=await c.rpc('lookup_login_user_by_username',{p_username:a.username});assert.equal(lookup.error,null);assert.equal(lookup.data[0].auth_user_id,a.authId);
 const login=await c.auth.signInWithPassword({email:lookup.data[0].auth_email,password:a.password});assert.equal(login.error,null);assert.equal(login.data.user.id,a.authId);
 const role=await c.rpc('app_current_role');assert.equal(role.data,a.role);
 const read=await c.rpc('feedback_admin_groups',{p_academic_year:'school_2027',p_activity_row_id:'ACT-1'});
 if(a.role==='instructor')assert.equal(read.error?.code,'42501');else {assert.equal(read.error,null);assert.equal(read.data.length,1);}
 if(process.env.MOBILE_QA_ALLOW_LOCAL_MUTATION==='1'){
 const write=await c.rpc('feedback_admin_open_campaign',{p_activity_row_id:'ACT-3',p_audience:'student',p_stage:'pre'});
 if(a.role==='admin')assert.equal(write.error,null);else assert.equal(write.error?.code,'42501');
 }
 const cancellations=await c.from('course_meeting_cancellations').select('activity_id,meeting_date').eq('activity_id','ACT-1');assert.equal(cancellations.error,null);assert.equal(cancellations.data.length,a.role==='admin'?1:0);
 results.push({role:a.role,realAuth:true,lookupMatched:true,serverRoleMatched:true,feedbackRead:a.role==='instructor'?'denied':'allowed',isolatedFeedbackWrite:process.env.MOBILE_QA_ALLOW_LOCAL_MUTATION==='1'?(a.role==='admin'?'allowed':'denied'):'not_run',cancellationRows:cancellations.data.length});
 await c.auth.signOut();
}
console.log(JSON.stringify(results,null,2));await writeFile('work/real-auth-role-contracts-results.json',JSON.stringify(results,null,2));
