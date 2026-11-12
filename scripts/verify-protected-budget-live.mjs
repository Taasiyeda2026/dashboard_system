// Only the dashboard management connection is used here. Financial data remains
// behind the deployed budget gateway; no budget service-role credential is read.
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyLiveBrowser} from './protected-budget-browser.mjs';
const dashboard='https://szinlhjuwyiyszdpsdop.supabase.co';
const budget='https://iyvvaolbwtavznanxmsj.supabase.co/functions/v1/';
const owner='e9ca304a-4e66-4774-830e-14f1318c4908';
const origin='https://taasiyeda2026.github.io';
const cleanup=[];
let service,anon;
const mask=value=>console.log('::add-mask::'+value);
const notice=message=>console.log('::notice title=Deployed owner verification::'+message);
const headers=(key,token=key)=>({apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'});
async function json(url,options={},label='Verification request'){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(label+' returned HTTP '+r.status);
 return r.status===204?null:r.json();
}
const edge=(name,token,path='')=>fetch(budget+name+(path?'?path='+encodeURIComponent(path):''),{headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(20000)});
try{
 const token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!token)throw Error('Dashboard management token binding is missing');
 const keys=await json('https://api.supabase.com/v1/projects/szinlhjuwyiyszdpsdop/api-keys?reveal=true',{headers:{Authorization:'Bearer '+token}},'Dashboard verification-key lookup');
 service=keys.find(k=>k.name==='service_role')?.api_key;anon=keys.find(k=>k.name==='anon')?.api_key;
 if(!service||!anon)throw Error('Dashboard Auth verification bindings unavailable');mask(service);mask(anon);
 const user=await json(dashboard+'/auth/v1/admin/users/'+owner,{headers:headers(service)},'Owner identity lookup');
 const identity=user.user||user;assert.equal(identity.id,owner);
 const challenge=await json(dashboard+'/auth/v1/admin/generate_link',{method:'POST',headers:headers(service),body:JSON.stringify({type:'magiclink',email:identity.email})},'Owner test-session challenge');
 const hash=challenge.properties?.hashed_token||challenge.hashed_token;if(!hash)throw Error('Owner challenge unavailable');mask(hash);
 const session=await json(dashboard+'/auth/v1/verify',{method:'POST',headers:headers(anon),body:JSON.stringify({type:'magiclink',token_hash:hash})},'Owner test-session verification');
 mask(session.access_token);mask(session.refresh_token);assert.equal(session.user.id,owner);
 cleanup.push(async()=>{const r=await fetch(dashboard+'/auth/v1/logout?scope=local',{method:'POST',headers:headers(anon,session.access_token)});if(!r.ok&&r.status!==401)throw Error('Owner generated-session cleanup failed')});
 const profiles=await json(dashboard+'/rest/v1/users?select=*&auth_user_id=eq.'+owner,{headers:headers(anon,session.access_token)},'Canonical owner profile read');
 if(profiles.length!==1||profiles[0].is_active!==true||!['admin','system_admin'].includes(profiles[0].role))throw Error('Canonical active owner administrator profile not confirmed');
 const password=randomBytes(32).toString('hex');mask(password);
 const result=await json(dashboard+'/auth/v1/admin/users',{method:'POST',headers:headers(service),body:JSON.stringify({email:'budget-deployed-denial-'+randomUUID()+'@example.invalid',password,email_confirm:true})},'Disposable nonowner test account');
 const other=result.user||result;
 cleanup.push(async()=>{await json(dashboard+'/auth/v1/admin/users/'+other.id,{method:'DELETE',headers:headers(service)},'Disposable account cleanup')});
 const otherSession=await json(dashboard+'/auth/v1/token?grant_type=password',{method:'POST',headers:headers(anon),body:JSON.stringify({email:other.email,password})},'Nonowner test session');mask(otherSession.access_token);mask(otherSession.refresh_token);
 for(const name of ['budget-app','budget-data']){
  assert.equal((await edge(name,null,'budget_snapshots?select=id')).status,401);
  assert.equal((await edge(name,'invalid','budget_snapshots?select=id')).status,401);
  assert.equal((await edge(name,otherSession.access_token,'budget_snapshots?select=id')).status,403);
 }
 const app=await edge('budget-app',session.access_token);assert.equal(app.status,200);
 const doc=await app.json();assert.equal(doc.document_type,'taasiyeda-protected-budget-v1');
 assert.ok(!doc.html.includes(session.access_token));assert.ok(!doc.html.includes('type="password"'));
 const data=await edge('budget-data',session.access_token,'budget_snapshots?select=id&order=id.desc&limit=1');assert.equal(data.status,200);
 const snapshots=await data.json();if(!Array.isArray(snapshots)||snapshots.length!==1)throw Error('Owner budget read did not return the expected approved snapshot');
 for(const table of ['budget_rows','budget_snapshots','budget_seals']){
  const r=await fetch(budget+'budget-data?path='+table,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
 }
 await verifyLiveBrowser({session,profile:profiles[0]});
 notice('PASS deployed owner Auth, canonical role, protected interface/data access, valid nonowner denial, anonymous/invalid denial, approved-budget write rejection and live browser SSO. No financial writes.');
}catch(error){console.log('::error title=Deployed owner verification failed::'+error.message);process.exitCode=1}
finally{
 let failed=false;for(const fn of cleanup.reverse())try{await fn()}catch{failed=true}
 if(failed){console.log('::error title=Owner verification cleanup::A generated test session or disposable account requires cleanup');process.exitCode=1}
 else if(cleanup.length)notice('Disposable account deleted; generated owner test session revoked locally; existing owner sessions preserved.');
}
