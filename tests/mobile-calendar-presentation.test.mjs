import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { monthScreen } from '../frontend/src/screens/month.js';
import { weekScreen } from '../frontend/src/screens/week.js';

const row = {RowID:'r1',row_id:'r1',source_sheet:'activities',activity_name:'חלל',activity_type:'course',school:'מוסד לדוגמה',authority:'רשות',instructor_name:'מדריכה',start_time:'08:00',end_time:'09:30',sessions:3,start_date:'2026-11-15'};
const second = {...row,RowID:'r2',row_id:'r2',activity_name:'רובוטיקה'};
const items_by_id = {r1:row,r2:second};
const data={month:'2026-11',cells:[{day:15,date:'2026-11-15',item_ids:['r1']},{day:16,date:'2026-11-16',item_ids:['r2']}],items_by_id};

test('mobile month selection reuses the filtered day list and existing activity detail action; desktop retains day drawer', () => {
  const state={mobileMonthSelectedDate:'2026-11-15',routes:['month','week'],route:'month',user:{role:'admin'},clientSettings:{},screenDataCache:{'activityDetail:activities:r2':{data:second}}};
  const doc=new JSDOM(monthScreen.render(data,{state})).window.document;
  const root=doc.body;
  let mobile=true;
  doc.defaultView.matchMedia=()=>({matches:mobile});
  const drawers=[];
  const ui={openDrawer: options=>drawers.push(options),bindInteractiveCards(el,callback){
    el.querySelectorAll('[data-card-action]').forEach(button=>{
      if(button.dataset.cardBound==='yes')return;
      button.dataset.cardBound='yes';
      button.addEventListener('click',()=>callback(button.dataset.cardAction));
    });
  }};
  monthScreen.bind({root,ui,data,state,rerender:()=>{},api:{}});
  const panel=root.querySelector('[data-mobile-month-day]');
  assert.match(panel.textContent,/חלל/);
  assert.match(panel.textContent,/מוסד לדוגמה/);
  root.querySelector('[data-card-action="monthcell|16"]').click();
  assert.equal(state.mobileMonthSelectedDate,'2026-11-16');
  assert.match(panel.textContent,/רובוטיקה/);
  assert.doesNotMatch(panel.textContent,/חלל/);
  assert.equal(drawers.length,0);
  panel.querySelector('[data-card-action^="monthsession|"]').click();
  assert.equal(drawers.at(-1).title,'רובוטיקה');
  root.querySelector('[data-card-action="monthcell|17"]').click();
  assert.match(panel.textContent,/אין פעילויות/);
  mobile=false;
  root.querySelector('[data-card-action="monthcell|15"]').click();
  assert.match(drawers.at(-1).title,/15\/11\/2026/);
  assert.equal(state.mobileMonthSelectedDate,'2026-11-17');
});

test('weekly session cards keep their actions and original group count with mobile location and time', () => {
  const state={routes:['month','week'],route:'week',user:{role:'admin'},clientSettings:{}};
  const html=weekScreen.render({days:[{date:'2026-11-15',weekday_label:'ראשון',item_ids:['r1','r2']}],items_by_id},{state});
  const doc=new JSDOM(html).window.document;
  assert.equal(doc.querySelector('.ds-week-col__count').textContent,'2');
  assert.equal(doc.querySelector('[data-group-toggle]').dataset.groupCount,'2');
  assert.equal(doc.querySelectorAll('[data-card-action^="weeksession|"]').length,2);
  assert.match(doc.querySelector('.week-mobile-session-details').textContent,/מוסד לדוגמה/);
  assert.match(doc.querySelector('.week-mobile-session-details').textContent,/08:00–09:30/);
});
