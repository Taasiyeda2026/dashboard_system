const test=require('node:test');
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class El {
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attrs={};this.style={setProperty(){}};this.disabled=false;this.hidden=false;this._text='';this._value='';this.className='';this.classList={add:(...s)=>{this.className+=' '+s.join(' ')},remove(){},toggle(){}};}
 append(...nodes){for(const n of nodes){this.children.push(typeof n==='string'?Object.assign(new El('text'),{textContent:n}):n);if(n&&typeof n==='object')n.parent=this}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes)}
 set textContent(t){this._text=String(t);this.children=[]}get textContent(){return this._text+this.children.map(n=>n.textContent).join('')}
 set innerHTML(t){this.textContent=t}get innerHTML(){return this.textContent}
 set value(v){this._value=String(v)}get value(){return this._value|| (this.tagName==='select'?this.options[0]?.value||'':'')}
 get options(){return this.children.filter(n=>n.tagName==='option')}
 setAttribute(k,v){this.attrs[k]=String(v)} getAttribute(k){return this.attrs[k]}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 dispatchEvent(e){for(const fn of this.listeners[e.type]||[])fn(e)}
 async fire(type){for(const fn of this.listeners[type]||[])await fn({type,target:this,preventDefault(){}})}
 contains(n){return n===this||this.children.some(c=>c.contains(n))}
 focus(){} blur(){}
 matches(s){if(s.startsWith('.'))return this.className.split(' ').includes(s.slice(1));if(s.startsWith('#'))return this.id===s.slice(1);const m=s.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);if(m){const k=m[1].replace(/-([a-z])/g,(_,a)=>a.toUpperCase());return k in this.dataset&&(m[2]===undefined||this.dataset[k]===m[2])}return this.tagName===s}
 querySelectorAll(s){return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)])}querySelector(s){return this.querySelectorAll(s)[0]||null}
}
function setup(){
 const document={createElement:t=>new El(t),createTextNode:t=>Object.assign(new El('text'),{textContent:t}),addEventListener(){}};
 const days=['2026-11-04','2026-11-05'];let pendingPreview=null,pendingSave=null;const calls=[];
 const ctx={console,document,Event:class{constructor(type){this.type=type}},Date,Number,Map,Set,JSON,Promise};vm.createContext(ctx);
 for(const f of ['components/field.js','components/compact-select.js','components/bounded-month-picker.js','services/daily-travel.js']){
  const s=fs.readFileSync(__dirname+'/../attendance/src/'+f,'utf8').replace(/^import .*?;\n/gm,'').replace(/export /g,'');vm.runInContext(s,ctx);
 }
 const legs=d=>[{kind:'outbound',from:'בית',to:'בית ספר '+d,minutes:null,kilometers:null,toRecordId:d},{kind:'return',from:'בית ספר '+d,to:'בית',minutes:null,kilometers:null,fromRecordId:d}];
 Object.assign(ctx,{
 getMonthApproval:async()=>null,invalidateAttendanceCache(){},supabase:{},canEditMonth:()=>true,formatMonthLabel:x=>String(x),
 listInstructorDisplayMonths:async()=>['2026-11'],readHistoricalAttendance:async()=>({rows:[],approval:null}),historicalTravelDays:()=>[],isHistoricTravelMonth:()=>false,monthStatusLabel:()=>'',
 getAssignedTravelDays:async()=>days.map(date=>({date,ready:true,review_status:'missing',activities:'פעילות'})),
 getDailyTravelReports:async()=>[],getDailyTravelReport:async()=>null,
 getDailyTravelActivityLegs:async(_,d)=>{calls.push(['preview',d]);if(pendingPreview&&pendingPreview.date===d)await pendingPreview.promise;return legs(d)},
 saveDailyTravel:async(d,l)=>{calls.push(['save',d]);if(pendingSave)await pendingSave.promise;return {}},
 });
 const source=fs.readFileSync(__dirname+'/../attendance/src/screens/daily-travel-tab.js','utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm,'').replace(/export /g,'');vm.runInContext(source,ctx);
 const tab=ctx.createDailyTravelTab({empId:1502,initialDate:days[0]});
 const save=tab.panel.querySelector('.av2-btn--primary');
 const status=tab.panel.querySelector('.av2-daily-travel__status');
 const label=()=>tab.panel.querySelector('#av2-travel-day-selector-trigger').textContent;
 const native=()=>tab.panel.querySelector('#av2-travel-day-selector');
 const choose=async d=>{const select=native();select.value=d;await select.fire('change');await new Promise(setImmediate)};
 const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
 const fill=async()=>{for(const input of tab.panel.querySelectorAll('[data-daily-travel-leg]')){input.value=input.dataset.field==='minutes'?'01:00':'73';await input.fire('input')}};
 return {ctx,tab,save,status,label,native,calls,choose,defer,fill,blockPreview(d){pendingPreview={date:d,...defer()};return pendingPreview},blockSave(){pendingSave=defer();return pendingSave}};
}

test('travel save updates both the visible picker and the native day status',async()=>{
 const a=setup();await a.tab.load();await a.fill();await a.save.fire('click');
 assert.match(a.status.textContent,/נשמרו/);
 assert.match(a.label(),/ממתין לאישור/);
 assert.match(a.native().options.find(o=>o.value==='2026-11-04').textContent,/ממתין לאישור/);
});
test('a day chosen during loading is loaded next and can be saved',async()=>{
 const a=setup();const gate=a.blockPreview('2026-11-04');const loading=a.tab.load();
 while(!a.calls.length)await new Promise(setImmediate);
 await a.choose('2026-11-05');gate.resolve();await loading;
 assert.equal(a.tab.dateInput.value,'2026-11-05');assert.equal(a.save.disabled,false);
 assert.equal(a.status.textContent,'');
 assert.deepEqual(a.calls.filter(x=>x[0]==='preview'),[['preview','2026-11-04'],['preview','2026-11-05']]);
 await a.fill();await a.save.fire('click');assert.deepEqual(a.calls.at(-1),['save','2026-11-05']);
});
test('switching days during a save cannot mark the new unsaved day as saved',async()=>{
 const a=setup();await a.tab.load();await a.fill();const gate=a.blockSave();const saving=a.save.fire('click');
 while(!a.calls.some(x=>x[0]==='save'))await new Promise(setImmediate);
 await a.choose('2026-11-05');gate.resolve();await saving;
 assert.equal(a.tab.dateInput.value,'2026-11-05');assert.doesNotMatch(a.status.textContent,/נשמרו/);
 assert.match(a.native().options.find(o=>o.value==='2026-11-04').textContent,/ממתין לאישור/);
 assert.match(a.label(),/טרם דווח/);
 assert.deepEqual(a.calls.filter(x=>x[0]==='save'),[['save','2026-11-04']]);
});
test('an approval lookup failure is shown and leaves save available for retry',async()=>{
 const a=setup();await a.tab.load();await a.fill();
 a.ctx.getMonthApproval=async()=>{throw new Error('temporary approval failure')};
 await a.save.fire('click');assert.match(a.status.textContent,/temporary approval failure/);assert.equal(a.save.disabled,false);
 a.ctx.getMonthApproval=async()=>null;await a.save.fire('click');assert.match(a.status.textContent,/נשמרו/);
});
test('repeated save clicks during approval lookup produce only one write',async()=>{
 const a=setup();await a.tab.load();await a.fill();const gate=a.defer();
 a.ctx.getMonthApproval=async()=>{await gate.promise;return null};
 const first=a.save.fire('click');const second=a.save.fire('click');gate.resolve();await Promise.all([first,second]);
 assert.equal(a.calls.filter(x=>x[0]==='save').length,1);
});
function setupWorker({editing=false,hadController=true}={}){
 const events={},swEvents={};let reloads=0,observer=null,disconnected=false;
 const ctx={navigator:{serviceWorker:{controller:hadController?{}:null,addEventListener:(k,f)=>swEvents[k]=f,register:()=>Promise.resolve({update:()=>Promise.resolve(),addEventListener(){}})}},
 document:{documentElement:{},querySelector:()=>editing?{}:null,addEventListener(){}},
 window:{addEventListener:(k,f)=>events[k]=f,location:{reload:()=>reloads++}},
 MutationObserver:class{constructor(fn){observer=fn}observe(){}disconnect(){disconnected=true}},console,Date};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../attendance/src/services/sw-registration.service.js','utf8').replace('export ',''),ctx);
 ctx.registerServiceWorker();events.load();
 return {change:()=>swEvents.controllerchange(),leave:()=>{editing=false;observer?.()},get reloads(){return reloads},get disconnected(){return disconnected}};
}
test('worker update preserves the reporting screen and reloads once after leaving',()=>{
 const a=setupWorker({editing:true});a.change();assert.equal(a.reloads,0);
 a.leave();assert.equal(a.reloads,1);assert.equal(a.disconnected,true);a.change();a.leave();assert.equal(a.reloads,1);
});
test('worker update applies immediately on a safe screen and skips first-install reload',()=>{
 const a=setupWorker();a.change();assert.equal(a.reloads,1);
 const first=setupWorker({hadController:false});first.change();assert.equal(first.reloads,0);
});
