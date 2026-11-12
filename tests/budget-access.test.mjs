import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessBudget,BUDGET_OWNER_UID} from '../frontend/src/budget-access.js';
test('budget link requires owner identity, active account and system_admin',()=>{
 const owner={auth_user_id:BUDGET_OWNER_UID,role:'system_admin',active:'yes'};
 assert.equal(canAccessBudget(owner),true);
 assert.equal(canAccessBudget({...owner,role:'admin'}),true);
 for(const user of [null,{}, {...owner,auth_user_id:'another-admin'},{...owner,role:'authorized_user'},{...owner,role:'instructor'},{...owner,active:'no'}])assert.equal(canAccessBudget(user),false);
});
