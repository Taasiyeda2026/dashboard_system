import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
let source=readFileSync(new URL('../frontend/src/screens/admin-home.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export const adminHomeScreen','const adminHomeScreen');
source+='\nglobalThis.render=()=>adminHomeScreen.render();';
for(const [role,user_id,expected] of [['admin','8000',true],['system_admin','8000',true],['admin','8001',false],['instructor','8000',false]]){
 const ctx={state:{user:{role,user_id,is_active:true}},dsScreenStack:x=>x,dsPageHeader:()=>'',console};vm.createContext(ctx);vm.runInContext(source,ctx);
 assert.equal(ctx.render().includes('https://taasiyeda2026.github.io/budget-control/'),expected);
}
console.log('PASS: 4 management link authorization cases');
