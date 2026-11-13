import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessBudget,BUDGET_OWNER_UID} from '../frontend/src/budget-access.js';
test('budget link requires owner identity, active account and system_admin',()=>{
 const owner={auth_user_id:BUDGET_OWNER_UID,role:'system_admin',active:'yes'};
 assert.equal(canAccessBudget(owner),true);
 assert.equal(canAccessBudget({...owner,role:'admin'}),true);
 for(const user of [null,{}, {...owner,auth_user_id:'another-admin'},{...owner,role:'authorized_user'},{...owner,role:'instructor'},{...owner,active:'no'}])assert.equal(canAccessBudget(user),false);
});

test('real dashboard session exposes the owner tile without legacy active',()=>{
 const owner={auth_user_id:BUDGET_OWNER_UID,role:'admin',profile_is_active:true,user_id:'8000'};
 assert.equal(canAccessBudget(owner),true);
 for(const user of [{...owner,auth_user_id:'another-admin'},{...owner,role:'instructor'},{...owner,profile_is_active:false},{...owner,active:'no'},{...owner,is_active:false},{...owner,profile_is_active:undefined}])assert.equal(canAccessBudget(user),false);
});
