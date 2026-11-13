import test from 'node:test';import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';import {readFile} from 'node:fs/promises';
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const pause=()=>new Promise(r=>setTimeout(r,10));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause();}throw Error('UI state timed out');}
function globals(dom){for(const key of ['window','document','Node','Element'])globalThis[key]=dom.window[key];}
test('dashboard embed only sends verified access to the exact frame, origin and nonce',async()=>{
 const dom=new JSDOM('<iframe></iframe>',{url:'https://taasiyeda2026.github.io/dashboard_system/'});globals(dom);
 try{
  let checks=0,allowed=true,messages=[];
  globalThis.testPairingClient={auth:{getSession:async()=>({data:{session:{access_token:'test-access',user:{id:'same'}}}}),getUser:async()=>{checks++;return {data:{user:{id:'same'}}};}}};
  const mock=data('export const supabase=globalThis.testPairingClient;export const waitForSupabaseAuthSession=async()=>({access_token:"test-access"});');
  let binding=await readFile(new URL('../frontend/src/pairing-dashboard-frame.js',import.meta.url),'utf8');
  binding=binding.replace("'./supabase-client.js'",JSON.stringify(mock)).replace("'./inspiration-session-bridge.js'",JSON.stringify(data(await readFile(new URL('../frontend/src/inspiration-session-bridge.js',import.meta.url),'utf8'))));
  const {bindPairingDashboardFrame}=await import(data(binding));const frame=document.querySelector('iframe');frame.contentWindow.postMessage=(...args)=>messages.push(args);
  const dispose=bindPairingDashboardFrame(frame,()=>allowed),nonce='a'.repeat(48);
  const send=(origin,source=frame.contentWindow,n=nonce)=>window.dispatchEvent(new window.MessageEvent('message',{origin,source,data:{type:'pairing:dashboard-session-request',nonce:n}}));
  send('https://evil.example');send('https://portzot-derech.org',window);send('https://portzot-derech.org',frame.contentWindow,'bad');await pause();assert.equal(checks,0);
  send('https://portzot-derech.org');await until(()=>messages.length===1);assert.equal(messages[0][0].access_token,'test-access');assert.equal(messages[0][1],'https://portzot-derech.org');assert.equal(messages[0][0].nonce,nonce);assert(!('refresh_token' in messages[0][0]));
  allowed=false;send('https://portzot-derech.org');await pause();assert.equal(messages.length,1);dispose();allowed=true;send('https://portzot-derech.org');await pause();assert.equal(messages.length,1);
 }finally{dom.window.close();delete globalThis.testPairingClient;}
});
test('owner dashboard tile opens the embedded manager and returns to the course catalog',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://taasiyeda2026.github.io/dashboard_system/'});globals(dom);globalThis.MutationObserver=dom.window.MutationObserver;
 try{
  globalThis.pairingTestState={user:{role:'admin',user_id:'8000'},routes:[]};
  const replacements={
   '../pairing-dashboard-frame.js':'export const bindPairingDashboardFrame=()=>()=>{};',
   '../budget-launcher.js':'export const launchBudget=async()=>{};',
   '../budget-access.js':'export const resolveBudgetUser=async()=>null;',
   '../state.js':'export const state=globalThis.pairingTestState;',
   '../supabase-client.js':'export const supabase={};export const waitForSupabaseAuthSession=async()=>null;',
   './shared/layout.js':'export const dsPageHeader=(a,b)=>`<h1>${a}</h1><p>${b}</p>`;export const dsScreenStack=s=>s;'
  };
  let s=await readFile(new URL('../frontend/src/screens/admin-home.js',import.meta.url),'utf8');
  for(const [path,value] of Object.entries(replacements))s=s.replace(JSON.stringify(path),JSON.stringify(data(value))).replace("'"+path+"'",JSON.stringify(data(value)));
  const {adminHomeScreen}=await import(data(s));const root=document.querySelector('#app');root.innerHTML=adminHomeScreen.render();adminHomeScreen.bind({root});
  root.querySelector('[data-course-results-open]').click();root.querySelector('[data-portzot-course-results]').click();
  assert.equal(root.querySelector('[data-portzot-results-section]').hidden,false);assert.equal(root.querySelector('[data-course-results-catalog]').hidden,true);
  assert.equal(root.querySelector('iframe').src,'https://portzot-derech.org/pairing/admin.html?view=groups&embed=dashboard');
  assert(!root.querySelector('[data-portzot-course-results]').hasAttribute('data-manager-board-open'));
  root.querySelector('[data-portzot-results-back]').click();assert.equal(root.querySelector('[data-course-results-catalog]').hidden,false);
  globalThis.pairingTestState.user.user_id='1234';assert(!adminHomeScreen.render().includes('data-portzot-frame'));
  root.replaceChildren();await pause();
 }finally{dom.window.close();delete globalThis.pairingTestState;}
});
