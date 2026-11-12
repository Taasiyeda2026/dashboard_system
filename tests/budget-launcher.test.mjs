import test from 'node:test';
import assert from 'node:assert/strict';
import {launchBudget,BUDGET_APP_ENDPOINT} from '../frontend/src/budget-launcher.js';
import {BUDGET_OWNER_UID} from '../frontend/src/budget-access.js';
const user={auth_user_id:BUDGET_OWNER_UID,role:'admin',active:'yes'};
const session={data:{session:{access_token:'test-only',user:{id:BUDGET_OWNER_UID}}}};
function setup(){const writes=[];const popup={opener:{},document:{body:{},open(){},write(html){writes.push(html)},close(){}},location:{replace(url){assert.equal(url,'blob:private-document')}},closed:false,close(){this.closed=true}};return {popup,writes,openWindow:()=>popup,createDocumentUrl:html=>{writes.push(html);return 'blob:private-document'},releaseDocumentUrl:()=>{}};}
test('authorized launch uses header token, authenticated HTML and no URL credentials',async()=>{
 const s=setup();let url,options;
 await launchBudget({...s,user,getSession:async()=>session,request:async(u,o)=>{url=u;options=o;return new Response('<html>private interface</html>',{headers:{'Content-Type':'text/html'}})}});
 assert.equal(url,BUDGET_APP_ENDPOINT);assert.equal(options.headers.Authorization,'Bearer test-only');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(s.popup.opener,null);assert.equal(s.writes.length,1);
});
test('unauthorized user never opens a window or fetches interface',async()=>{
 await assert.rejects(launchBudget({user:{...user,auth_user_id:'another'},openWindow:()=>{throw Error('should not open')}}),/אין הרשאת/);
});
test('backend denial closes popup without rendering private HTML',async()=>{
 const s=setup();await assert.rejects(launchBudget({...s,user,getSession:async()=>session,request:async()=>new Response('denied',{status:403})}));assert.equal(s.popup.closed,true);assert.equal(s.writes.length,0);
});
test('logout during request prevents displaying the response',async()=>{
 const s=setup();let calls=0;await assert.rejects(launchBudget({...s,user,getSession:async()=>++calls===1?session:{data:{session:null}},request:async()=>new Response('<html>private</html>',{headers:{'Content-Type':'text/html'}})}));assert.equal(s.writes.length,0);assert.equal(s.popup.closed,true);
});
