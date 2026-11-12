import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBudgetUser,canAccessBudget,BUDGET_OWNER_UID} from '../frontend/src/budget-access.js';
function client({id=BUDGET_OWNER_UID,role='admin',active=true,latest=id,profileError=null}={}){
 return {auth:{getUser:async()=>({data:{user:{id}}}),getSession:async()=>({data:{session:{user:{id:latest}}}})},from(table){assert.equal(table,'users');return {select(columns){assert.equal(columns,'role,is_active');return {eq(column,value){assert.equal(column,'auth_user_id');assert.equal(value,BUDGET_OWNER_UID);return {maybeSingle:async()=>({data:{role,is_active:active},error:profileError})}}}}}}};
}
test('verified owner gets entry even when persisted dashboard profile lacks identity/active fields',async()=>{
 const oldProfile={user_id:'8000',role:'admin'};assert.equal(canAccessBudget(oldProfile),false);
 const user=await resolveBudgetUser(client());assert.equal(canAccessBudget(user),true);assert.equal(user.auth_user_id,BUDGET_OWNER_UID);
 assert.deepEqual(oldProfile,{user_id:'8000',role:'admin'});
});
test('other authenticated users never query the owner profile or get entry',async()=>{
 const c=client({id:'other-admin'});c.from=()=>{throw Error('must not query owner profile')};assert.equal(await resolveBudgetUser(c),null);
});
test('inactive, nonadmin and failed profile reads fail closed',async()=>{
 for(const c of [client({active:false}),client({role:'instructor'}),client({profileError:{message:'denied'}}),null])assert.equal(await resolveBudgetUser(c),null);
});
test('account switch during canonical profile lookup does not show owner entry',async()=>{
 assert.equal(await resolveBudgetUser(client({latest:'another-account'})),null);
});
