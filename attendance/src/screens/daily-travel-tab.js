import { createInputField } from '../components/field.js';
import { createCompactSelect } from '../components/compact-select.js';
import { createBoundedMonthPicker } from '../components/bounded-month-picker.js';
import { summarizeDailyTravel } from '../services/daily-travel.js';
import { getMonthApproval, invalidateAttendanceCache } from '../services/attendance.service.js';
import { supabase } from '../api/client.js';
import { canEditMonth, formatMonthLabel } from '../services/month-gate.service.js';
import { listInstructorDisplayMonths, readHistoricalAttendance, historicalTravelDays, isHistoricTravelMonth, monthStatusLabel } from '../services/historical-display.service.js';
import {
  getDailyTravelActivityLegs, getDailyTravelReport, getDailyTravelReports, getAssignedTravelDays, saveDailyTravel
} from '../services/daily-travel.service.js';

const LEG_LABELS = {outbound:'יציאה לפעילות הראשונה',between:'מעבר בין פעילויות',return:'חזרה מהפעילות האחרונה'};

export function createDailyTravelTab({empId, initialDate, onEditHistorical}) {
  const panel = document.createElement('section');
  panel.id = 'av2-travel-tab-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'av2-travel-tab-trigger');
  panel.className = 'av2-daily-travel av2-report__travel-tab';
  const title = document.createElement('h2');
  title.textContent = 'דיווח נסיעות';
  const monthLabel=document.createElement('label');
  monthLabel.textContent='חודש דיווח';
  monthLabel.setAttribute('for','av2-travel-month-selector');
  const monthSelect=document.createElement('select');
  monthSelect.id='av2-travel-month-selector';
  monthSelect.className='av2-field__select av2-daily-travel__month-select';
  const monthWrap=document.createElement('div');
  monthWrap.className='av2-daily-travel__month-wrap';
  const monthPicker=createBoundedMonthPicker(monthSelect);
  monthWrap.append(monthLabel,monthSelect,monthPicker.wrap);
  const dateField = createInputField({id:'av2-travel-date',label:'תאריך',type:'hidden',value:initialDate});
  dateField.wrap.hidden=true;
  const dayLabel=document.createElement('label');
  dayLabel.className='av2-daily-travel__day-label';
  dayLabel.textContent='יום פעילות – תאריך ומיקום';
  dayLabel.setAttribute('for','av2-travel-day-selector-trigger');
  const daySelect=document.createElement('select');
  daySelect.id='av2-travel-day-selector';
  daySelect.className='av2-field__select av2-daily-travel__day-select av2-daily-travel__native-day-select';
  daySelect.hidden=true;
  const dayPicker=createCompactSelect({
    id:'av2-travel-day-selector',options:[],placeholder:'בחר יום פעילות',
    ariaLabel:'יום פעילות',maxHeight:248
  });
  dayPicker.select.disabled=true;
  dayPicker.wrap.classList.add('av2-daily-travel__day-picker');
  dayPicker.select.addEventListener('change',()=>{
    daySelect.value=dayPicker.select.value;
    daySelect.dispatchEvent(new Event('change'));
  });
  function syncDayPicker(){
    dayPicker.setOptions([...daySelect.options].map(option=>({
      value:option.value,label:option.textContent
    })));
    dayPicker.select.value=daySelect.value;
    dayPicker.select.disabled=daySelect.disabled;
  }
  const daysWrap=document.createElement('div');
  daysWrap.className='av2-daily-travel__day-wrap';
  daysWrap.append(dayLabel,daySelect,dayPicker.wrap);
  const status = document.createElement('p');
  status.className = 'av2-daily-travel__status';
  status.setAttribute('role','status');
  const historicalEdit=document.createElement('button');
  historicalEdit.type='button';
  historicalEdit.className='av2-btn av2-btn--secondary av2-daily-travel__historical-edit';
  historicalEdit.textContent='עריכה';
  historicalEdit.hidden=true;
  historicalEdit.addEventListener('click',()=>{
    if(!historicalEditable() || !loadedDate)return;
    historicalEditing=!historicalEditing;
    renderHistoricalDay(historicalDays.find(day=>day.date===loadedDate));
  });
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
  actions.append(save);
  const reportCard=document.createElement('div');
  reportCard.className='av2-daily-travel__report-card';
  reportCard.append(monthWrap,daysWrap,dateField.wrap,status,historicalEdit,legsArea,noTravelLabel,summary,actions);
  panel.append(title,reportCard);

  let legs=[];
  let loadedDate='';
  let loading=false;
  let locked=false;
  let dayOptions=[];
  let requestedDay=initialDate;
  let selectedMonth=String(initialDate||'').slice(0,7);
  let monthsLoaded=false;
  let requestSequence=0;
  let historicalDays=[];
  let historicalMonthApproval=null;
  let historicalEditing=false;
  let historicalSaving=false;
  const formatDate=value=>String(value||'').split('-').reverse().join('.');
  const isLegacyDay=date=>String(date||'')<'2026-11-04';
  const historicalEditable=()=>{
    const [year,month]=selectedMonth.split('-').map(Number);
    return canEditMonth(year,month,historicalMonthApproval) &&
      (selectedMonth>='2026-11' || historicalMonthApproval?.status==='reopened');
  };
  const appendDetail=(wrap,label,value)=>{
    if(value===null || value===undefined || value==='')return;
    const row=document.createElement('div');
    row.className='av2-daily-travel__legacy-detail';
    const key=document.createElement('span');key.textContent=label;
    const val=document.createElement('strong');val.textContent=String(value);
    row.append(key,val);wrap.append(row);
  };
  const durationValue=minutes=>{
    if(minutes==null)return '';
    const n=Number(minutes);
    return Number.isFinite(n)?String(Math.floor(n/60))+':'+String(n%60).padStart(2,'0'):'';
  };
  const parseDuration=value=>{
    const raw=String(value||'').trim();
    if(!/^(?:\d{1,2}):[0-5]\d$/.test(raw))return null;
    const [hours,minutes]=raw.split(':').map(Number);
    const total=hours*60+minutes;
    return total>=0 && total<360?total:null;
  };
  function addHistoricalEditor(block,record){
    const fields=document.createElement('div');
    fields.className='av2-daily-travel__inline-fields';
    fields.dataset.recordId=record.id;
    const data=[
      ['roundtrip_km','קילומטרים (הלוך וחזור)',record.roundtrip_km,'number'],
      ['cancellation_before_minutes','ביטול זמן היסטורי – מקטע יציאה (שעות:דקות)',durationValue(record.cancellation_before_minutes),'text'],
      ['cancellation_after_minutes','ביטול זמן היסטורי – מקטע חזרה (שעות:דקות)',durationValue(record.cancellation_after_minutes),'text']
    ];
    for(const [field,label,value,type] of data){
      const wrapper=document.createElement('label');
      const heading=document.createElement('span');heading.textContent=label;
      const input=document.createElement('input');
      input.className='av2-field__input';input.type=type;
      input.dataset.historicalField=field;
      input.value=value==null?'':String(value);
      if(type==='number'){
        input.min='0';input.max='2000';input.step='0.01';input.inputMode='decimal';
      }else{input.placeholder='0:00';input.inputMode='text';}
      wrapper.append(heading,input);fields.append(wrapper);
    }
    block.append(fields);
  }
  async function saveHistoricalDay(){
    if(historicalSaving || !historicalEditable())return;
    const date=loadedDate;
    const [year,month]=selectedMonth.split('-').map(Number);
    historicalSaving=true;
    const editorButtons=[...reportCard.querySelectorAll('[data-historical-action]')];
    editorButtons.forEach(button=>button.disabled=true);
    try{
      const approval=await getMonthApproval(empId,selectedMonth,{force:true});
      if(!canEditMonth(year,month,approval) || (selectedMonth<'2026-11' && approval?.status!=='reopened'))
        throw new Error('החודש אינו פתוח עוד לעריכה');
      const forms=[...legsArea.querySelectorAll('[data-record-id]')];
      const changes=forms.map(form=>{
        const value=key=>form.querySelector('[data-historical-field="'+key+'"]')?.value.trim()??'';
        const km=value('roundtrip_km');
        const before=value('cancellation_before_minutes');
        const after=value('cancellation_after_minutes');
        const kmNumber=km===''?null:Number(km);
        if(kmNumber!==null && (!Number.isFinite(kmNumber)||kmNumber<0||kmNumber>2000))
          throw new Error('יש להזין מספר קילומטרים תקין');
        if((before==='')!== (after===''))throw new Error('יש למלא את שני משכי ביטול הזמן או להשאיר את שניהם ריקים');
        const beforeMinutes=before===''?null:parseDuration(before);
        const afterMinutes=after===''?null:parseDuration(after);
        if((before!=='' && beforeMinutes===null)||(after!=='' && afterMinutes===null))
          throw new Error('משך ביטול זמן חייב להיות בשעות:דקות ובטווח של פחות מ־6 שעות לכל כיוון');
        return {id:form.dataset.recordId,payload:{
          roundtrip_km:kmNumber,
          cancellation_before_minutes:beforeMinutes,
          cancellation_after_minutes:afterMinutes
        }};
      });
      for(const change of changes){
        const {data,error}=await supabase.from('attendance_records')
          .update({...change.payload,updated_at:new Date().toISOString()})
          .eq('id',change.id).eq('emp_id',Number(empId)).select('id').single();
        if(error || !data)throw new Error(error?.message||'שמירת הנסיעות נכשלה');
      }
      invalidateAttendanceCache(empId);
      const historical=await readHistoricalAttendance(empId,selectedMonth);
      const reports=await getDailyTravelReports(empId,selectedMonth);
      historicalDays=historicalTravelDays(historical.rows,reports);
      historicalMonthApproval=historical.approval;
      historicalEditing=false;
      renderHistoricalDay(historicalDays.find(day=>day.date===date));
      status.textContent='השינויים נשמרו';
    }catch(error){
      status.textContent=error.message||'שמירת השינויים נכשלה';
    }finally{
      historicalSaving=false;
      editorButtons.forEach(button=>button.disabled=false);
    }
  }
  function renderHistoricalDay(day){
    locked=true;loadedDate=day?.date||'';
    legs=[];legsArea.replaceChildren();
    noTravelLabel.hidden=true;save.hidden=true;summary.textContent='';
    if(!day){status.textContent='אין מידע לחודש זה';historicalEdit.hidden=true;return;}
    const approvalText=monthStatusLabel(historicalMonthApproval);
    status.textContent=approvalText;
    historicalEdit.hidden=!historicalEditable() || historicalEditing || !day.records.length;
    historicalEdit.textContent='עריכה';
    historicalEdit.classList.add('av2-daily-travel__action-sm');
    const report=day.dailyReport;
    // Historic attendance has legacy cancellation fields, not verified travel-leg durations.
    // Keep presentation grouped by workday without inventing outbound/return travel times.
    const daySummary=document.createElement('article');
    daySummary.className='av2-daily-travel__leg av2-daily-travel__legacy-card';
    const dayHeading=document.createElement('strong');
    dayHeading.textContent='סיכום יום עבודה · '+formatDate(day.date);
    daySummary.append(dayHeading);
    const historicKm=day.records.reduce((sum,row)=>sum+(Number(row.roundtrip_km)||0),0);
    const historicCancellation=day.records.reduce((sum,row)=>
      sum+(Number(row.cancellation_before_minutes)||0)+(Number(row.cancellation_after_minutes)||0),0);
    appendDetail(daySummary,'קילומטרים בדיווחי הנוכחות',historicKm+' ק״מ');
    appendDetail(daySummary,'ביטול זמן בדיווחי הנוכחות',durationValue(historicCancellation)+' שעות');
    if(!report)appendDetail(daySummary,'מקור הנתונים','רשומות נוכחות היסטוריות – לא קיים פירוט מסלול נסיעה מאומת');
    legsArea.append(daySummary);
    if(!report){
      const activities=day.records
        .filter(row=>row.generation_kind==null && row.start_time && row.end_time
          && row.activity_type!=='ביטול זמן' && row.activity_type!=='זום'
          && row.training_mode!=='online' && row.operation_meeting_mode!=='online')
        .slice().sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))
          || String(a.id).localeCompare(String(b.id)));
      if(activities.length){
        const route=document.createElement('article');
        route.className='av2-daily-travel__leg av2-daily-travel__legacy-card';
        const routeTitle=document.createElement('strong');
        routeTitle.textContent='מסלול יום העבודה · תצוגת נתוני עבר';
        route.append(routeTitle);
        const destination=row=>row.school_name_snapshot||row.destination_address_snapshot
          ||row.authority_name_snapshot||'מיקום הפעילות';
        const segment=(from,to,minutes)=>{
          const item=document.createElement('div');
          item.className='av2-daily-travel__legacy-detail';
          const label=document.createElement('span');
          label.textContent=from+' ← '+to;
          const value=document.createElement('strong');
          value.textContent=minutes==null?'זמן נסיעה לא דווח':formatTripDuration(minutes)+' שעות נסיעה מדווחות';
          item.append(label,value);route.append(item);
        };
        segment('בית',destination(activities[0]),
          activities[0].travel_compensation?.reportedOutboundMinutes);
        for(let i=1;i<activities.length;i++)
          segment(destination(activities[i-1]),destination(activities[i]),null);
        segment(destination(activities.at(-1)),'בית',
          activities.at(-1).travel_compensation?.reportedReturnMinutes);
        const note=document.createElement('small');
        note.textContent='סדר התחנות לפי שעות הפעילות. כתובות ומקטעי מעבר אינם מאומתים; לא בוצע חישוב או שינוי שכר.';
        route.append(note);
        legsArea.append(route);
      }
    }
    if(report){
      const summaryCard=document.createElement('article');
      summaryCard.className='av2-daily-travel__leg av2-daily-travel__legacy-card';
      const heading=document.createElement('strong');heading.textContent='נסיעות · '+formatDate(day.date);
      summaryCard.append(heading);
      appendDetail(summaryCard,'קילומטרים',report.total_km==null?null:report.total_km+' ק״מ');
      appendDetail(summaryCard,'ביטול זמן מאושר / מדווח',report.cancellation_minutes==null?null:durationValue(report.cancellation_minutes)+' שעות');
      appendDetail(summaryCard,'סטטוס נסיעה',report.review_status==='approved'||report.review_status==='corrected'?'אושר':
        report.review_status==='rejected'?'נדחה':report.review_status==='pending_review'?'ממתין לאישור':null);
      for(const leg of Array.isArray(report.legs)?report.legs:[]){
        const part=document.createElement('div');part.className='av2-daily-travel__legacy-detail';
        const label=document.createElement('span');label.textContent=[leg.from,leg.to].filter(Boolean).join(' ← ');
        part.append(label);
        const values=[leg.minutes==null?'':formatTripDuration(leg.minutes)+' שעות',leg.kilometers==null?'':leg.kilometers+' ק״מ'].filter(Boolean);
        if(values.length){const v=document.createElement('strong');v.textContent=values.join(' · ');part.append(v);}
        summaryCard.append(part);
      }
      legsArea.append(summaryCard);
    }
    for(const record of day.records){
      const block=document.createElement('article');
      block.className='av2-daily-travel__leg av2-daily-travel__legacy-card';
      const header=document.createElement('strong');
      header.textContent=[record.activity_type,record.program_name_snapshot||record.activity_name_snapshot||record.program_name,
        record.school_name_snapshot||record.authority_name_snapshot].filter(Boolean).join(' · ');
      block.append(header);
      appendDetail(block,'שעות פעילות',record.start_time&&record.end_time
        ? String(record.start_time).slice(0,5)+'–'+String(record.end_time).slice(0,5):null);
      if(historicalEditing){
        const note=document.createElement('small');
        note.textContent='עריכת נתוני עבר: אלו שדות ביטול זמן מקוריים, ולא דיווחי זמן נסיעה בפועל.';
        block.append(note);
        addHistoricalEditor(block,record);
      }else{
        appendDetail(block,'קילומטרים בדיווח המקורי',record.roundtrip_km==null?null:record.roundtrip_km+' ק״מ');
        const cancelMinutes=(Number(record.cancellation_before_minutes)||0)+(Number(record.cancellation_after_minutes)||0);
        if(record.cancellation_before_minutes!=null || record.cancellation_after_minutes!=null)
          appendDetail(block,'ביטול זמן היסטורי',durationValue(cancelMinutes)+' שעות');
      }
      appendDetail(block,'תחבורה ציבורית',record.public_transport_cost>0?'₪'+record.public_transport_cost:null);
      const travel=record.travel_compensation;
      if(travel){
        appendDetail(block,'זמן נסיעה מדווח',travel.reportedOutboundMinutes==null && travel.reportedReturnMinutes==null?null:
          [travel.reportedOutboundMinutes,travel.reportedReturnMinutes].filter(v=>v!=null).map(formatTripDuration).join(' / ')+' שעות');
      }
      legsArea.append(block);
    }
    if(!day.records.length&&!report)status.textContent='אין נתונים ליום זה';
    legsArea.hidden=false;
    actions.replaceChildren();
    if(historicalEditing){
      const hint=document.createElement('small');
      hint.textContent='עריכת נתוני עבר בלבד: הזינו שעות:דקות (למשל 01:30). הערכים אינם זמני נסיעה מאומתים.';
      const confirm=document.createElement('button');
      confirm.type='button';confirm.className='av2-btn av2-btn--primary av2-daily-travel__action-sm';
      confirm.dataset.historicalAction='save';confirm.textContent='שמירה';
      confirm.addEventListener('click',()=>void saveHistoricalDay());
      const cancel=document.createElement('button');
      cancel.type='button';cancel.className='av2-btn av2-btn--secondary av2-daily-travel__action-sm';
      cancel.dataset.historicalAction='cancel';cancel.textContent='ביטול';
      cancel.addEventListener('click',()=>{historicalEditing=false;renderHistoricalDay(day);});
      actions.append(hint,confirm,cancel);
    }
  }
  // Employee-facing durations are HH:MM; the API continues to store minutes.
  const formatTripDuration=value=>{
    if(value===null || value===undefined || value==='')return '';
    const minutes=Number(value);
    return Number.isInteger(minutes)&&minutes>=0
      ? String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'):'';
  };
  const parseTripDuration=value=>{
    const raw=String(value??'').trim();
    if(raw==='')return null;
    if(!/^\d{1,2}:[0-5]\d$/.test(raw))return NaN;
    const [hours,minutes]=raw.split(':').map(Number);
    const total=hours*60+minutes;
    return total<=1440?total:NaN;
  };
  function showSummary(){
    legsArea.hidden=noTravel.checked;
    const inputs=[...legsArea.querySelectorAll('[data-daily-travel-leg]')];
    for(const input of inputs){
      const index=Number(input.dataset.dailyTravelLeg);
      const key=input.dataset.field;
      const raw=input.value.trim();
      legs[index][key]=key==='minutes'?parseTripDuration(raw):(raw===''?null:Number(raw));
    }
    const totals=summarizeDailyTravel(legs);
    const publicTransportFare=legs.reduce((sum,leg)=>sum+
      (leg.mode==='public_transport'?Number(leg.transportCost||0):0),0);
    summary.textContent=noTravel.checked ? 'ללא נסיעה'
      : totals.cancellationMinutes===null
        ? 'יש להשלים זמני נסיעה בפורמט שעות:דקות (לדוגמה 01:30)'
        : 'ביטול זמן מחושב: '+formatTripDuration(totals.cancellationMinutes)+' שעות'
          +(totals.kilometers===null?'':' · '+totals.kilometers+' ק״מ')
          +(publicTransportFare>0?' · תחבורה ציבורית: ₪'+publicTransportFare.toFixed(2):'');
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
      for(const [key,label] of [['minutes','זמן נסיעה בפועל (שעות:דקות)'],['kilometers','קילומטרים']]){
        if(leg.kind==='between' && key==='minutes'){
          const fixed=document.createElement('div');
          fixed.className='av2-daily-travel__calculated-field';
          const fieldLabel=document.createElement('span');
          fieldLabel.className='av2-field__label';
          fieldLabel.textContent='ביטול זמן בין פעילויות';
          const value=document.createElement('strong');
          value.textContent=formatTripDuration(leg.gapMinutes)+' שעות · מחושב משעות הפעילויות';
          fixed.append(fieldLabel,value);
          fields.append(fixed);
          continue;
        }
        if(leg.kind==='between' && leg.sameLocation===true && key==='kilometers'){
          const fixed=document.createElement('div');
          fixed.className='av2-daily-travel__calculated-field';
          const fieldLabel=document.createElement('span');
          fieldLabel.className='av2-field__label';
          fieldLabel.textContent='קילומטרים';
          const value=document.createElement('strong');
          value.textContent='0 ק״מ · אותו מיקום';
          fixed.append(fieldLabel,value);
          fields.append(fixed);
          continue;
        }
        const field=createInputField({
          id:'av2-leg-'+index+'-'+key,label,type:key==='minutes'?'text':'number',
          value:key==='minutes'?formatTripDuration(leg[key]):(leg[key]==null?'':String(leg[key])),
          attrs:key==='minutes'?{placeholder:'01:30',inputmode:'numeric',maxlength:'5'}:{min:'0',max:'2000',step:'0.01'}
        });
        field.input.dataset.dailyTravelLeg=String(index);
        field.input.dataset.field=key;
        field.input.addEventListener('input',showSummary);
        fields.append(field.wrap);
      }
      const modeWrap=document.createElement('label');
      modeWrap.className='av2-daily-travel__mode';
      const modeText=document.createElement('span');
      modeText.textContent='אמצעי נסיעה';
      const mode=document.createElement('select');
      mode.className='av2-field__select';
      for(const [value,label] of [['car','רכב'],['public_transport','תחבורה ציבורית']]){
        const opt=document.createElement('option');
        opt.value=value;opt.textContent=label;mode.append(opt);
      }
      mode.value=leg.mode||'car';
      leg.mode=mode.value;
      modeWrap.append(modeText,mode);
      if(leg.kind==='between' && leg.sameLocation===true)modeWrap.hidden=true;
      const fare=createInputField({
        id:'av2-leg-'+index+'-fare',label:'עלות נסיעה (₪)',type:'number',
        value:leg.transportCost==null?'':String(leg.transportCost),
        attrs:{min:'0',max:'10000',step:'0.01'}
      });
      function syncMode(){
        leg.mode=mode.value;
        const kmInput=fields.querySelector('[data-field="kilometers"]');
        const transit=mode.value==='public_transport';
        if(leg.kind==='between' && leg.sameLocation===true){
          leg.mode='car';leg.kilometers=0;leg.transportCost=0;
          fare.wrap.hidden=true;fare.input.disabled=true;showSummary();return;
        }
        fare.wrap.hidden=!transit;
        fare.input.disabled=!transit;
        kmInput.disabled=transit;
        if(transit){
          kmInput.value='0';
          leg.kilometers=0;
        }else{
          fare.input.value='0';
          leg.transportCost=0;
        }
        showSummary();
      }
      mode.addEventListener('change',syncMode);
      fare.input.addEventListener('input',()=>{
        leg.transportCost=fare.input.value===''?0:Number(fare.input.value);
        showSummary();
      });
      fields.append(modeWrap,fare.wrap);
      block.append(fields);
      legsArea.append(block);
      syncMode();
    }
    showSummary();
  }
  function setDate(date) {
    historicalEditing=false;
    requestedDay=String(date||'').slice(0,10);
    const targetMonth=requestedDay.slice(0,7);
    if(monthsLoaded && [...monthSelect.options].some(option=>option.value===targetMonth) && targetMonth!==selectedMonth){
      selectedMonth=targetMonth;
      monthSelect.value=targetMonth;
      monthPicker.sync();
      dayOptions=[];
    }
    dateField.input.value=requestedDay;
    if(dayOptions.some(item=>item.date===requestedDay)){
      daySelect.value=requestedDay;
      dayPicker.select.value=requestedDay;
    }
    loadedDate='';
  }
  function displayDay(day){
    const formatDate=day.date.slice(8,10)+'.'+day.date.slice(5,7)+'.'+day.date.slice(0,4);
    const state=day.ready
      ? day.review_status==='approved'||day.review_status==='corrected'?'אושר'
        : day.review_status==='pending_review'?'ממתין לאישור'
        : day.review_status==='rejected'?'נדרש תיקון':'טרם דווח'
      : 'נדרשת נוכחות';
    return formatDate+' · '+(day.activities||'פעילות')+' · '+state;
  }
  async function refreshMonths(){
    const allowed=await listInstructorDisplayMonths(empId);
    const currentMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
    monthSelect.replaceChildren();
    for(const key of allowed){
      const [year,month]=key.split('-').map(Number);
      const option=document.createElement('option');
      option.value=key;
      option.textContent=formatMonthLabel(year,month);
      monthSelect.append(option);
    }
    selectedMonth=allowed.includes(selectedMonth)?selectedMonth:
      allowed.includes(currentMonth)?currentMonth:allowed[0]||'';
    monthSelect.value=selectedMonth;
    monthPicker.sync();
    monthsLoaded=true;
  }
  async function refreshDays(){
    daySelect.disabled=true;
    dayPicker.select.disabled=true;
    const [year,month]=selectedMonth.split('-').map(Number);
    if(!year||!month){dayOptions=[];return false;}
    const fromDate=selectedMonth+'-01';
    const toDate=selectedMonth+'-'+String(new Date(year,month,0).getDate()).padStart(2,'0');
    if(isHistoricTravelMonth(selectedMonth)){
      const [historical,storedReports]=await Promise.all([
        readHistoricalAttendance(empId,selectedMonth),
        getDailyTravelReports(empId,selectedMonth)
      ]);
      historicalMonthApproval=historical.approval;
      historicalDays=historicalTravelDays(historical.rows,storedReports);
      dayOptions=historicalDays.map(day=>{
        const schools=[...new Set(day.records.map(row=>
          row.school_name_snapshot||row.authority_name_snapshot||'').filter(Boolean))];
        const programs=[...new Set(day.records.map(row=>
          row.program_name_snapshot||row.activity_name_snapshot||row.program_name||row.activity_type||'').filter(Boolean))];
        const location=schools.slice(0,2).join(' / ');
        const activity=programs.slice(0,2).join(' / ');
        return {
          date:day.date,
          activities:[activity,location].filter(Boolean).join(' – ')||'דיווח נסיעות',
          ready:true,review_status:day.dailyReport?.review_status||null
        };
      });
      daySelect.replaceChildren();
      for(const day of dayOptions){
        const option=document.createElement('option');
        option.value=day.date;
        option.textContent=formatDate(day.date)+' · '+(day.activities||'דיווח נסיעות');
        daySelect.append(option);
      }
      if(!dayOptions.length){
        requestedDay='';dateField.input.value='';
        status.textContent='אין דיווחים לחודש זה';
        legsArea.replaceChildren();save.hidden=true;noTravelLabel.hidden=true;
        summary.textContent='';
        syncDayPicker();
        return false;
      }
      const chosen=dayOptions.find(day=>day.date===requestedDay)||dayOptions[0];
      daySelect.value=chosen.date;
      dateField.input.value=chosen.date;
      requestedDay=chosen.date;
      daySelect.disabled=false;
      syncDayPicker();
      return true;
    }
    const fetched=await getAssignedTravelDays({fromDate,toDate});
    dayOptions=fetched.filter(item=>item.date>='2026-11-04' && item.date?.slice(0,7)===selectedMonth);
    if(selectedMonth==='2026-11'){
      const historical=await readHistoricalAttendance(empId,selectedMonth);
      historicalMonthApproval=historical.approval;
      historicalDays=historicalTravelDays(historical.rows.filter(row=>isLegacyDay(row.report_date)),[]);
      for(const day of historicalDays){
        if(dayOptions.some(item=>item.date===day.date))continue;
        dayOptions.push({date:day.date,activities:day.records.map(row=>row.activity_name_snapshot||row.activity_type).filter(Boolean).join(' · ')||'פעילות',ready:true,legacy:true});
      }
      dayOptions.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    }
    daySelect.replaceChildren();
    if(!dayOptions.length){
      dateField.input.value='';
      requestedDay='';
      status.textContent='אין ימי פעילות לדיווח נסיעות';
      legsArea.replaceChildren();
      save.hidden=true;
      noTravelLabel.hidden=true;
      summary.textContent='';
      syncDayPicker();
      return false;
    }
    for(const day of dayOptions){
      const option=document.createElement('option');
      option.value=day.date;
      option.textContent=displayDay(day);
      daySelect.append(option);
    }
    const requested=dayOptions.find(day=>day.date===requestedDay);
    const chosen=requested || dayOptions.find(day=>day.ready && day.review_status==='missing')
      || dayOptions.find(day=>day.ready && day.review_status==='rejected')
      || dayOptions[0];
    daySelect.value=chosen.date;
    dateField.input.value=chosen.date;
    requestedDay=chosen.date;
    daySelect.disabled=false;
    syncDayPicker();
    return true;
  }
  async function load({force=false}={}){
    if(loading)return;
    if(!force && loadedDate===requestedDay && loadedDate!=='')return;
    loading=true;save.disabled=true;reload.disabled=true;
    historicalEdit.hidden=true;
    historicalEditing=false;
    actions.replaceChildren(save);
    status.textContent='טוען נסיעות…';
    const token=++requestSequence;
    try{
      if(!monthsLoaded)await refreshMonths();
      if(force || !dayOptions.length){
        const hasDays=await refreshDays();
        if(!hasDays)return;
      }
      const date=dateField.input.value;
      if(isHistoricTravelMonth(selectedMonth) || isLegacyDay(date)){
        renderHistoricalDay(historicalDays.find(day=>day.date===date));
        return;
      }
      const day=dayOptions.find(item=>item.date===date);
      if(!day || !day.ready){
        status.textContent='יש להשלים תחילה דיווח נוכחות ליום זה';
        legsArea.replaceChildren();save.hidden=true;noTravelLabel.hidden=true;
        summary.textContent='';loadedDate='';
        return;
      }
      const [available,stored]=await Promise.all([
        getDailyTravelActivityLegs(empId,date),
        getDailyTravelReport(empId,date)
      ]);
      if(token!==requestSequence || date!==dateField.input.value)return;
      loadedDate=date;
      legs=available.map((leg,index)=>{
        const old=stored?.legs?.[index];
        const same=old && old.kind===leg.kind && old.from===leg.from && old.to===leg.to;
        return {...leg,
          minutes:leg.kind==='between'?leg.gapMinutes:(same?old.minutes:null),
          kilometers:leg.kind==='between' && leg.sameLocation===true?0:(same?old.kilometers:null),
          mode:same?(old.mode||'car'):'car',transportCost:same?Number(old.transportCost||0):0};
      });
      noTravel.checked=stored?.no_travel===true;
      noTravelLabel.hidden=!legs.length || legs.some(leg=>leg.kind==='between');
      if(noTravelLabel.hidden)noTravel.checked=false;
      save.hidden=!legs.length;
      status.textContent=!legs.length?'לא נמצאו פעילויות הדורשות נסיעה בתאריך זה'
        :stored?.review_status==='approved'||stored?.review_status==='corrected'
          ? 'הנסיעות אושרו'
          :stored?'דיווח נסיעות נשמר':'';
      const monthApproval=await getMonthApproval(empId,selectedMonth,{force:true});
      const [reportYear,reportMonth]=selectedMonth.split('-').map(Number);
      const monthEditable=canEditMonth(reportYear,reportMonth,monthApproval);
      locked=!monthEditable || ((stored?.review_status==='approved'||stored?.review_status==='corrected') && monthApproval?.status!=='reopened');
      save.disabled=locked;
      if(!monthEditable)status.textContent='החודש אינו פתוח לעריכה';
      renderLegs();
    }catch(err){
      status.textContent=err.message||'טעינת הנסיעות נכשלה';
      loadedDate='';
    }finally{
      loading=false;reload.disabled=false;
      if(loadedDate===dateField.input.value && !save.hidden && !locked)save.disabled=false;
    }
  }
  noTravel.addEventListener('change',showSummary);
  monthSelect.addEventListener('change',()=>{
    historicalEditing=false;
    selectedMonth=monthSelect.value;
    requestedDay='';loadedDate='';dayOptions=[];
    dayPicker.setOptions([]);dayPicker.select.disabled=true;
    void load({force:true});
  });
  daySelect.addEventListener('change',()=>{
    setDate(daySelect.value);
    void load();
  });
  reload.addEventListener('click',()=>load({force:true}));
  save.addEventListener('click',async()=>{
    if(loading || locked || loadedDate!==dateField.input.value)return;
    const monthKey=loadedDate.slice(0,7);
    const [year,month]=monthKey.split('-').map(Number);
    const approval=await getMonthApproval(empId,monthKey,{force:true});
    if(!canEditMonth(year,month,approval)){
      status.textContent='החודש נעול לדיווח. נדרש לפתוח אותו מחדש לעריכה.';
      return;
    }
    showSummary();
    if(!noTravel.checked && legs.some(leg=>leg.kind!=='between' && !Number.isInteger(leg.minutes))){
      status.textContent='יש להזין את זמן הנסיעה בפורמט שעות:דקות (לדוגמה 01:30)';
      return;
    }
    save.disabled=true;
    try{
      await saveDailyTravel(loadedDate,legs,noTravel.checked);
      status.textContent='הנסיעות נשמרו';
      const day=dayOptions.find(item=>item.date===loadedDate);
      if(day){
        day.review_status='pending_review';
        const option=[...daySelect.options].find(item=>item.value===loadedDate);
        if(option)option.textContent=displayDay(day);
      }
    }catch(error){
      status.textContent=error.message||'שמירת הנסיעות נכשלה';
    }finally{save.disabled=locked;}
  });
  return {panel,load,setDate,dateInput:dateField.input};
}
