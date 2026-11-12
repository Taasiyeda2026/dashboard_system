import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {JSDOM} from 'jsdom';
import {resolveBudgetUser,BUDGET_OWNER_UID} from '../frontend/src/budget-access.js';
const source=readFileSync(new URL('../frontend/src/screens/admin-home.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export const adminHomeScreen','const adminHomeScreen')+'\nglobalThis.testScreen=adminHomeScreen;';
async function screenFor({authId,cachedUser}){
 const dom=new JSDOM('<main id="root"></main>');const launches=[];
 const client={auth:{getUser:async()=>({data:{user:{id:authId}}}),getSession:async()=>({data:{session:{user:{id:authId}}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'admin',is_active:true}})})})})};
 const context={state:{user:cachedUser,routes:[]},supabase:client,resolveBudgetUser,launchBudget:async args=>launches.push(args),document:dom.window.document,window:dom.window,dsScreenStack:s=>s,dsPageHeader:s=>`<h1>${s}</h1>`};
 vm.runInNewContext(source,context);
 const root=dom.window.document.querySelector('#root');root.innerHTML=context.testScreen.render();context.testScreen.bind({root});await nextTurn();
 return {root,launches,dom};
}
test('existing owner session shows a working management tile without cached auth_user_id or active fields',async()=>{
 const {root,launches,dom}=await screenFor({authId:BUDGET_OWNER_UID,cachedUser:{user_id:'8000',role:'admin'}});
 const button=root.querySelector('[data-budget-open]');assert.ok(button);assert.match(button.textContent,/בקרה תקציבית/);
 button.click();await nextTurn();assert.equal(launches.length,1);assert.equal(launches[0].user.auth_user_id,BUDGET_OWNER_UID);dom.window.close();
});
test('stale owner metadata does not expose the management tile to another authenticated administrator',async()=>{
 const {root,dom}=await screenFor({authId:'another-admin',cachedUser:{user_id:'8000',auth_user_id:BUDGET_OWNER_UID,role:'admin',active:'yes'}});
 assert.equal(root.querySelector('[data-budget-open]'),null);dom.window.close();
});
