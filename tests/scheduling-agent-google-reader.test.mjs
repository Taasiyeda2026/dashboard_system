import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleReader,createGoogleTokenProvider} from '../supabase/functions/scheduling-agent-gateway/google-reader.mjs';
const CANONICAL_SHEET_ID='fixture-sheet';
const json=body=>Response.json(body);
const meta={id:CANONICAL_SHEET_ID,mimeType:'application/vnd.google-apps.spreadsheet',modifiedTime:'now',version:'1',parents:['fixture-folder']};
const sheet={sheets:[{properties:{title:'שיבוצים',sheetId:42,gridProperties:{rowCount:1000,columnCount:26}}}],properties:{timeZone:'America/Los_Angeles'}};
test('missing OAuth credentials fail before any outgoing call',async()=>{let calls=0;await assert.rejects(createGoogleTokenProvider({fetchImpl:async()=>{calls++;}})(),/not_configured/);assert.equal(calls,0);});
test('refresh tokens remain server side, account is pinned and short-lived token is reused',async()=>{
 let calls=0;const p=createGoogleTokenProvider({clientId:'client',clientSecret:'private',refreshToken:'private-refresh',expectedGoogleSub:'fixture-owner',fetchImpl:async u=>(calls++,u.includes('/token')?json({access_token:'access',expires_in:3600}):json({sub:'fixture-owner'}))});
 assert.equal(await p(),'access');assert.equal(await p(),'access');assert.equal(calls,2);
});
test('a different Google account cannot access the pinned data',async()=>{
 const p=createGoogleTokenProvider({clientId:'client',clientSecret:'secret',refreshToken:'refresh',expectedGoogleSub:'fixture-owner',fetchImpl:async u=>u.includes('/token')?json({access_token:'token',expires_in:3600}):json({sub:'different'})});await assert.rejects(p(),/account_mismatch/);
});
test('reader verifies identity and rereads revision around bounded native values',async()=>{
 const urls=[];const r=createGoogleReader({spreadsheetId:CANONICAL_SHEET_ID,folderId:'fixture-folder',getAccessToken:async()=> 'secret',fetchImpl:async u=>{urls.push(u);return json(u.includes('/drive/')?meta:u.includes('/values/')?{values:[['headers']]}:sheet);}});
 const data=await r({},CANONICAL_SHEET_ID);assert.equal(data.version,'1');assert.equal(urls.length,4);assert.equal(urls[2].includes('A1%3AQ1000'),true);assert.equal(JSON.stringify(data).includes('secret'),false);
 await assert.rejects(r({},'unapproved-sheet'),/not_allowed/);
});
test('concurrent Google revision change returns conflict instead of a snapshot',async()=>{
 let metadataReads=0;const r=createGoogleReader({spreadsheetId:CANONICAL_SHEET_ID,folderId:'fixture-folder',getAccessToken:async()=> 'secret',fetchImpl:async u=>json(u.includes('/drive/')?{...meta,version:String(++metadataReads)}:u.includes('/values/')?{values:[]}:sheet)});await assert.rejects(r({},CANONICAL_SHEET_ID),/changed_during_read/);
});
