import test from 'node:test';import assert from 'node:assert/strict';
import {createServiceAccountTokenProvider} from '../supabase/functions/scheduling-agent-gateway/google-service-account.mjs';
test('service account credentials never enter output; scopes are read-only and no delegation is requested',async()=>{
 let options,calls=0;const provider=createServiceAccountTokenProvider({credentialsJson:JSON.stringify({type:'service_account',client_email:'agent@example.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----fixture'}),now:()=>1000,createJwt:o=>{options=o;return {authorize:async()=>(calls++,{access_token:'token',expiry_date:9999999})};}});
 assert.equal(await provider(),'token');assert.equal(await provider(),'token');assert.equal(calls,1);assert.equal('subject' in options,false);assert.equal(options.scopes.every(s=>s.endsWith('.readonly')),true);
});
test('unconfigured and malformed service account credentials fail closed',async()=>{
 await assert.rejects(createServiceAccountTokenProvider({})(),/not_configured/);
 await assert.rejects(createServiceAccountTokenProvider({credentialsJson:'{"type":"user"}'})(),/credentials_invalid/);
});
