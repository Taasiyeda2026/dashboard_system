import { createInputField } from '../components/field.js';
import { summarizeDailyTravel } from '../services/daily-travel.js';
import {
  getDailyTravelActivityLegs, getDailyTravelReport, saveDailyTravel
} from '../services/daily-travel.service.js';

const LEG_LABELS = {outbound:'יציאה לפעילות הראשונה',between:'מעבר בין פעילויות',return:'חזרה מהפעילות האחרונה'};

export function createDailyTravelTab({empId, initialDate}) {
  const panel = document.createElement('section');
  panel.id = 'av2-travel-tab-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'av2-travel-tab-trigger');
  panel.className = 'av2-daily-travel av2-report__travel-tab';
  const title = document.createElement('h2');
  title.textContent = 'נסיעות וביטולים';
  const dateField = createInputField({id:'av2-travel-date',label:'תאריך',type:'date',value:initialDate});
  const status = document.createElement('p');
  status.className = 'av2-daily-travel__status';
  status.setAttribute('role','status');
  const legsArea = document.createElement('div');
  legsArea.className = 'av2-daily-travel__legs';
  const noTravelLabel = document.createElement('label');
  const noTravel = document.createElement('input');
  noTravel.type = 'checkbox';
  noTravelLabel.append(noTravel,document.createTextNode(' לא בוצעה נסיעה ביום זה'));
  const summary = document.createElement('p');
  summary.className = 'av2-daily-travel__summary';
  const save = document.createElement('button');
  save.type='button';save.className='av2-btn av2-btn--primary';
  save.textContent='שמירת נסיעות';
  const reload = document.createElement('button');
  reload.type='button';reload.className='av2-btn av2-btn--secondary';
  reload.textContent='רענון';
  const actions=document.createElement('div');
  actions.className='av2-report__actions';
  actions.append(save,reload);
  panel.append(title,dateField.wrap,status,legsArea,noTravelLabel,summary,actions);

  let legs=[];
  let loadedDate='';
  let loading=false;
  function showSummary(){
    legsArea.hidden=noTravel.checked;
    const inputs=[...legsArea.querySelectorAll('[data-daily-travel-leg]')];
    for(const input of inputs){
      const index=Number(input.dataset.dailyTravelLeg);
      const key=input.dataset.field;
      const raw=input.value.trim();
      legs[index][key]=raw===''?null:Number(raw);
    }
    const totals=summarizeDailyTravel(legs);
    summary.textContent=noTravel.checked ? 'ללא נסיעה'
      : totals.cancellationMinutes===null
        ? 'יש להשלים זמני נסיעה'
        : 'ביטול זמן: '+totals.cancellationMinutes+' דקות'
          +(totals.kilometers===null?'':' · '+totals.kilometers+' ק״מ');
  }
  function renderLegs(){
    legsArea.replaceChildren();
    for(const [index,leg] of legs.entries()){
      const block=document.createElement('div');
      block.className='av2-daily-travel__leg';
      const heading=document.createElement('strong');
      heading.textContent=LEG_LABELS[leg.kind]+' · '+leg.from+' ← '+leg.to;
      block.append(heading);
      const fields=document.createElement('div');
      fields.className='av2-daily-travel__leg-fields';
      for(const [key,label] of [['minutes','זמן נסיעה (דקות)'],['kilometers','קילומטרים']]){
        const field=createInputField({
          id:'av2-leg-'+index+'-'+key,label,type:'number',
          value:leg[key] == null?'':String(leg[key]),
          attrs:{min:'0',max:key==='minutes'?'1440':'2000',step:key==='minutes'?'1':'0.01'}
        });
        field.input.dataset.dailyTravelLeg=String(index);
        field.input.dataset.field=key;
        field.input.addEventListener('input',showSummary);
        fields.append(field.wrap);
      }
      block.append(fields);
      legsArea.append(block);
    }
    showSummary();
  }
  async function load({force=false}={}){
    if(loading)return;
    const date=dateField.input.value;
    if(!date)return;
    if(!force && loadedDate===date)return;
    loading=true;save.disabled=true;reload.disabled=true;
    status.textContent='טוען נסיעות…';
    try{
      const [available,stored]=await Promise.all([
        getDailyTravelActivityLegs(empId,date),
        getDailyTravelReport(empId,date)
      ]);
      if(date!==dateField.input.value)return;
      loadedDate=date;
      legs=available.map((leg,index)=>{
        const old=stored?.legs?.[index];
        const same=old && old.kind===leg.kind && old.from===leg.from && old.to===leg.to;
        return {...leg,minutes:same?old.minutes:null,kilometers:same?old.kilometers:null};
      });
      noTravel.checked=stored?.no_travel===true;
      noTravelLabel.hidden=!legs.length;
      save.hidden=!legs.length;
      status.textContent=!legs.length?'לא נמצאו פעילויות הדורשות נסיעה בתאריך זה'
        :stored?.review_status==='approved'||stored?.review_status==='corrected'
          ? 'הנסיעות אושרו'
          :stored?'דיווח נסיעות נשמר':'';
      save.disabled=stored?.review_status==='approved'||stored?.review_status==='corrected'
        ||stored?.review_status==='rejected';
      renderLegs();
    }catch(err){
      status.textContent=err.message||'טעינת הנסיעות נכשלה';
      loadedDate='';
    }finally{
      loading=false;reload.disabled=false;
      if(loadedDate===date && !save.hidden
        && !['הנסיעות אושרו'].includes(status.textContent))save.disabled=false;
    }
  }
  noTravel.addEventListener('change',showSummary);
  dateField.input.addEventListener('change',load);
  reload.addEventListener('click',()=>load({force:true}));
  save.addEventListener('click',async()=>{
    if(loading || loadedDate!==dateField.input.value)return;
    showSummary();
    save.disabled=true;
    try{
      await saveDailyTravel(loadedDate,legs,noTravel.checked);
      status.textContent='הנסיעות נשמרו';
    }catch(error){
      status.textContent=error.message||'שמירת הנסיעות נכשלה';
    }finally{save.disabled=false;}
  });
  return {panel,load,dateInput:dateField.input};
}
