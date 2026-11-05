import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const data = source => 'data:text/javascript,' + encodeURIComponent(source);
const policy = read('frontend/src/permission-policy.js')
 .replace("'./permissions.js'", JSON.stringify(data(read('frontend/src/permissions.js'))))
 .replace("'./capability-registry.js'", JSON.stringify(data(read('frontend/src/capability-registry.js'))));
const { hasPermission } = await import(data(policy));
const source = read('frontend/src/instructor-observation-runtime.js');
const allowedSource = source.match(/const allowed = user =>[\s\S]*?\n\);/)[0];
const allowed = new Function('user','hasPermission',allowedSource+';return allowed(user);');
const viewer = { role: 'business_development_manager', is_active: true, permissions: {
 view_manager_board:'yes',view_manager_tracking:'yes',manage_instructor_observations:'yes'
}};
test('explicit observer can open the form while inactive users and ungranted peers cannot',()=>{
 assert.equal(allowed(viewer,hasPermission),true);
 assert.equal(allowed({...viewer,is_active:false},hasPermission),false);
 for(const key of Object.keys(viewer.permissions)) {
  assert.equal(allowed({...viewer,permissions:{...viewer.permissions,[key]:'no'}},hasPermission),false,key);
 }
 for(const role of ['admin','activities_manager','operation_manager'])
  assert.equal(allowed({role,is_active:true},hasPermission),true);
 assert.equal(allowed({role:'business_development_manager'},hasPermission),false);
});
test('observation editing still requires an own draft and completed reports remain locked',()=>{
 const editableSource=source.match(/const editable = \(\) =>[^;]+;/)[0];
 const editable=new Function('selected','viewerAuthId',editableSource+';return editable();');
 assert.equal(editable({status:'draft',created_by:'observer'},'observer'),true);
 assert.equal(editable({status:'draft',created_by:'other'},'observer'),false);
 assert.equal(editable({status:'completed',created_by:'observer'},'observer'),false);
});
