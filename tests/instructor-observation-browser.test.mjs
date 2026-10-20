import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const runtime=readFileSync(new URL('../frontend/src/instructor-observation-runtime.js',import.meta.url),'utf8')
 .replace(/^import .*?;\s*$/gm,'')
 .replace(/export function /g,'function ');
const tick=()=>new Promise(r=>setTimeout(r,20));

test('manager creates, completes, reopens, and prints observation without editing locked report',async()=>{
 const dom=new JSDOM('<table class="manager-workspace-tracking-table"><tbody><tr><td data-label="תצפית 1"><span>27.11.26</span><button data-io-open="1550" data-io-slot="1" data-io-name="מדריך בדיקה">פתיחת משוב</button></td><td data-label="תצפית 2"><button data-io-open="1550" data-io-slot="2" data-io-name="מדריך בדיקה">פתיחת משוב</button></td></tr></tbody></table>',{url:'https://test.invalid'});
 const w=dom.window,records=[],authId='11111111-1111-4111-8111-111111111111';
 let printed=0;
 w.print=()=>{printed++};
 const supabase={
  auth:{getUser:async()=>({data:{user:{id:authId}}})},
  from(table){
   let op='',payload=null,filters=[];
   return {
    select(){return this},
    eq(key,value){filters.push([key,value]);return this},
    or(){return this},
    order(){return this},
    limit(){return Promise.resolve({data:table==='activities'?[]:records.filter(x=>x.emp_id===1550),error:null})},
    insert(row){op='insert';payload=row;return this},
    update(row){op='update';payload=row;return this},
    async single(){
     if(op==='insert'){
      const record={...payload,id:'test-record',created_by:authId};
      records.push(record);return {data:{...record},error:null};
     }
     if(op==='update'){
      const record=records.find(x=>x.id==='test-record');
      if(!record||record.status!=='draft'||filters.some(([k,v])=>record[k]!==v))
       return {data:null,error:{message:'immutable'}};
      Object.assign(record,payload);
      return {data:{id:record.id,status:record.status},error:null};
     }
     throw new Error('unexpected builder call');
    }
   };
  }
 };
 const context=vm.createContext({
  document:w.document,window:w,MutationObserver:w.MutationObserver,
  requestAnimationFrame:fn=>Promise.resolve().then(fn),
  setTimeout,clearTimeout,supabase,
  waitForSupabaseAuthSession:async()=>null,console,
  Date,Promise
 });
 try{
  vm.runInContext(runtime+'; installInstructorObservationRuntime({getUser:()=>({role:"operation_manager",is_active:true,full_name:"צופה"})});',context);
  await tick();
  const click=async selector=>{
   const el=w.document.querySelector(selector);
   assert.ok(el,'Missing UI control '+selector);
   el.click();await tick();
  };
  await click('[data-io-open="1550"]');
  await click('[data-io-action="new"]');
  assert.equal(records.length,1);
  await click('[data-io-action="next"]');
  const fill=(sel,value)=>{
   const el=w.document.querySelector(sel);
   assert.ok(el,'Missing field '+sel);
   el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));
  };
  fill('[data-io-detail="course"]','קורס הדגמה');
  fill('[data-io-detail="school"]','בית ספר ניסוי');
  fill('[data-io-detail="class"]','ט');
  fill('[data-io-detail="meeting"]','2');
  fill('[data-io-detail="students"]','24');
  fill('[data-io-detail="school_staff"]','כן');
  await click('[data-io-action="next"]');
  for(let section=0;section<6;section++){
   const groups=new Set([...w.document.querySelectorAll('[data-io-answer]')].map(x=>x.name));
   for(const name of groups){
    const first=[...w.document.querySelectorAll('[data-io-answer]')].find(x=>x.name===name);
    first.click();
   }
   await click('[data-io-action="next"]');
  }
  assert.ok(w.document.querySelector('[data-io-overall]'));
  await click('[data-io-overall][value="4"]');
  fill('[data-io-text="strengths"]','חוזקות מקצועיות');
  fill('[data-io-text="improvements"]','המלצה לשיפור');
  fill('[data-io-text="summary"]','דוח תצפית מלא');
  await click('[data-io-action="next"]');
  await click('[data-io-action="finish"]');
  assert.equal(records[0].status,'completed');
  assert.equal(Object.keys(records[0].responses).length,15);
  assert.ok(w.document.querySelector('.io-print').textContent.includes('דוח תצפית מלא'));
  await click('[data-io-action="print"]');
  assert.equal(printed,1);
  await click('[data-io-action="home"]');
  await click('[data-io-resume="test-record"]');
  assert.ok(w.document.querySelector('[data-io-action="print"]'));
  assert.equal(w.document.querySelector('[data-io-action="finish"]'),null);
 }finally{dom.window.close();}
});
