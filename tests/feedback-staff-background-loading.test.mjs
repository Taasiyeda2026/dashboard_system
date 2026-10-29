import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync('frontend/src/screens/impact-feedback.js', 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function setup() {
  const status=deferred(), plan=deferred();
  const ui={year:'school_2027', staffDeliveryLoaded:false, staffDeliveryLoading:false, staffDelivery:new Map(), staffPlans:new Map()};
  const calls={status:0,plan:0};
  const context=vm.createContext({ui,inflight:{},fetchStaffDeliveryStatus:()=>{calls.status++;return status.promise;},fetchStaffSendPlan:()=>{calls.plan++;return plan.promise;},staffStatusIndex:rows=>new Map(rows.map(r=>[`${r.activity_row_id}|${r.stage}`,r])),Map});
  const start=source.indexOf('let staffDeliveryGeneration =');
  const end=source.indexOf('function refreshStaffDeliveryInBackground',start);
  vm.runInContext(source.slice(start,end)+';globalThis.ensure=ensureStaffDelivery;globalThis.reset=()=>{staffDeliveryGeneration++;ui.staffDeliveryLoading=false;inflight.staffDelivery=null;};',context);
  const presenter=source.slice(source.indexOf('function staffEmailStatusHtml('),source.indexOf('\nasync function ensureInstructorAssignments'));
  vm.runInContext(presenter+';globalThis.present=staffEmailStatusHtml;',context);
  return {context,ui,calls,status,plan};
}
test('slow delivery reads coalesce, show updating, and preserve exact per-activity evidence',async()=>{
  const x=setup();const a=x.context.ensure(),b=x.context.ensure(true);
  assert.deepEqual(x.calls,{status:1,plan:1});
  assert.equal(x.ui.staffDeliveryLoading,true);
  const html=x.context.present({row_id:'a'},'pre','staff');
  assert.match(html,/מתעדכן/);assert.doesNotMatch(html,/נשלח/);
  x.status.resolve([{activity_row_id:'a',stage:'pre',status:'sent'},{activity_row_id:'b',stage:'pre',status:'failed'}]);
  x.plan.resolve([{activity_row_ids:['a','b'],stage:'pre'}]);await Promise.all([a,b]);
  assert.equal(x.ui.staffDelivery.get('a|pre').status,'sent');
  assert.equal(x.ui.staffDelivery.get('b|pre').status,'failed');
  await x.context.ensure();assert.deepEqual(x.calls,{status:1,plan:1});
});
test('failure retains verified cache and clears pending state for retry',async()=>{
  const x=setup();x.ui.staffDelivery.set('a|pre',{status:'sent'});x.ui.staffDeliveryLoaded=true;
  const p=x.context.ensure(true);x.status.reject(new Error('offline'));x.plan.resolve([]);await p;
  assert.equal(x.ui.staffDelivery.get('a|pre').status,'sent');assert.equal(x.ui.staffDeliveryLoading,false);
});
test('obsolete reads cannot restore status after year reset',async()=>{
  const x=setup();const p=x.context.ensure();x.context.reset();x.status.resolve([{activity_row_id:'a',stage:'pre',status:'sent'}]);x.plan.resolve([]);await p;
  assert.equal(x.ui.staffDelivery.size,0);assert.equal(x.ui.staffDeliveryLoaded,false);
});
test('entry, tab switch and periodic sync start status reads without awaiting them',()=>{
  assert.doesNotMatch(source,/if \((?:ui\.tab|key|tab) === 'staff'\) await ensureStaffDelivery/);
  assert.match(source,/if \(ui\.tab === 'staff'\) refreshStaffDeliveryInBackground\(host, force\)/);
  assert.match(source,/const cacheWarm = \(!force \|\| ui\.tab === 'staff'\)/);
});

test('a table load finishes while both delivery RPCs are still pending', async () => {
  const x=setup();const paints=[];
  Object.assign(x.ui,{tab:'staff',programs:[{}],groups:[{row_id:'a'}],error:'',loading:false});
  Object.assign(x.context,{
    tabNeeds:()=>['groups','issues'],tabDataReady:()=>true,
    paint:()=>{ assert.equal(x.ui.loading,false); paints.push(x.ui.staffDeliveryLoading); },
    ensureDefinitions:async()=>{},ensureGroups:async()=>{},ensureStaffIssues:async()=>{},
    ensureSummary:async()=>{},ensureFacts:async()=>{},ensureInstructorAssignments:async()=>{},
    translateFeedbackError:e=>String(e)
  });
  const helper=source.slice(source.indexOf('function refreshStaffDeliveryInBackground'),source.indexOf('\n\n/**',source.indexOf('function refreshStaffDeliveryInBackground')));
  const loader=source.slice(source.indexOf('async function load(host,'),source.indexOf('\nfunction campaignById'));
  vm.runInContext(helper+loader+';globalThis.loadTable=load;',x.context);
  await x.context.loadTable({isConnected:true});
  await x.context.loadTable({isConnected:true},{force:true});
  assert.equal(x.ui.loading,false);assert.equal(x.ui.staffDeliveryLoading,true);
  assert.ok(paints.length);assert.deepEqual(x.calls,{status:1,plan:1});
  x.status.resolve([]);x.plan.resolve([]);await x.context.ensure();
});
test('one failed RPC keeps the pair coalesced until the other RPC settles', async () => {
  const x=setup();const first=x.context.ensure();x.status.reject(new Error('offline'));
  await new Promise(resolve=>setImmediate(resolve));
  const second=x.context.ensure(true);assert.deepEqual(x.calls,{status:1,plan:1});
  x.plan.resolve([]);await Promise.all([first,second]);assert.equal(x.ui.staffDeliveryLoading,false);
});

function installEntryFunctions(x) {
  const paints=[];
  Object.assign(x.ui,{tab:'staff',programs:[{}],groups:[{row_id:'a'}],templates:{},loading:false});
  Object.assign(x.context,{
    visibleFeedbackTabs:()=>[{key:'staff'}],tabNeeds:()=>['groups','issues'],tabDataReady:()=>true,
    paint:()=>{ assert.equal(x.ui.loading,false); paints.push(true); },
    ensureDefinitions:async()=>{},ensureGroups:async()=>{},ensureStaffIssues:async()=>{},
    ensureSummary:async()=>{},ensureFacts:async()=>{},ensureInstructorAssignments:async()=>{},
    translateFeedbackError:e=>String(e)
  });
  const helper=source.slice(source.indexOf('function refreshStaffDeliveryInBackground'),source.indexOf('\n\n/**',source.indexOf('function refreshStaffDeliveryInBackground')));
  const loader=source.slice(source.indexOf('async function load(host,'),source.indexOf('\nfunction campaignById'));
  const switcher=source.slice(source.indexOf('async function switchTab('),source.indexOf('\nfunction handleTabKeys'));
  vm.runInContext(helper+loader+switcher+';globalThis.loadTable=load;globalThis.switchTabForTest=switchTab;',x.context);
  return paints;
}

test('revisiting cached staff tab works even when the delivery loader returns no Promise', async()=>{
  const x=setup();const paints=installEntryFunctions(x);
  const status={activity_row_id:'a',stage:'pre',status:'sent'};
  x.ui.staffDeliveryLoaded=true;x.ui.staffDelivery.set('a|pre',status);
  const host={isConnected:true};
  await x.context.switchTabForTest(host,'staff');
  // Exercise the helper contract when a cache-hit loader returns synchronously.
  x.context.ensureStaffDelivery=()=>undefined;
  await x.context.switchTabForTest(host,'staff');
  assert.deepEqual(x.calls,{status:0,plan:0});
  assert.equal(x.ui.staffDelivery.get('a|pre'),status);
  assert.equal(x.ui.staffDeliveryLoading,false);assert.ok(paints.length>=2);
});

test('opening feedback in school_2026 works without a delivery Promise or delivery reads',async()=>{
  const x=setup();const paints=installEntryFunctions(x);x.ui.year='school_2026';
  const host={isConnected:true};
  await x.context.loadTable(host);
  assert.equal(x.ui.error,'');
  // A skipped unsupported-year loader is also allowed to return synchronously.
  x.context.ensureStaffDelivery=()=>undefined;
  await x.context.loadTable(host);
  assert.equal(x.ui.error,'');assert.deepEqual(x.calls,{status:0,plan:0});
  assert.equal(x.ui.staffDeliveryLoading,false);assert.ok(paints.length>=2);
});
