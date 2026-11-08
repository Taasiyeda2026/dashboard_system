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
  const savedCard=document.createElement('section');
  savedCard.className='av2-daily-travel__saved';
  savedCard.setAttribute('role','status');
  savedCard.hidden=true;
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
  reportCard.append(monthWrap,daysWrap,dateField.wrap,status,historicalEdit,legsArea,noTravelLabel,summary,savedCard,actions);
  panel.append(title,reportCard);

  let legs=[];
  let loadedDate='';
  let loading=false;
  let loadingDay='';
  let loadingMonth='';
  let reloadRequested=false;
  let saving=false;
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
  let editingSavedReport=false;
  const formatDate=value=>String(value||'').split('-').reverse().join('.');
  const isLegacyDay=date=>String(date||'')<'2026-11-01';
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
    savedCard.hidden=true;summary.hidden=false;editingSavedReport=false;
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
      appendDetail(summaryCard,'סטטוס דיווח',report.review_status==='rejected'?'נדרש תיקון':'נשמר');
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
  const savedDateTime=value=>{
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    return new Intl.DateTimeFormat('he-IL',{
      timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',
      hour:'2-digit',minute:'2-digit',hour12:false
    }).format(date);
  };
  function showSavedReport(report){
    editingSavedReport=false;
    savedCard.replaceChildren();
    const heading=document.createElement('strong');
    heading.className='av2-daily-travel__saved-title';
    heading.textContent='✓ הדיווח נשמר בהצלחה';
    const when=document.createElement('p');
    when.textContent='דיווח ליום '+formatDate(loadedDate)+(savedDateTime(report?.reported_at)?' · נשמר ב־'+savedDateTime(report.reported_at):'');
    const details=document.createElement('div');
    details.className='av2-daily-travel__saved-details';
    const addDetail=(label,value)=>{
      const block=document.createElement('div');
      const small=document.createElement('span');small.textContent=label;
      const strong=document.createElement('strong');strong.textContent=value;
      block.append(small,strong);details.append(block);
    };
    if(report?.no_travel){
      addDetail('נסיעות','לא בוצעה נסיעה');
    }else{
      const reportLegs=report?.legs||[];
      const result=summarizeDailyTravel(reportLegs);
      const km=report?.total_km??result.kilometers;
      const minutes=report?.cancellation_minutes??result.cancellationMinutes;
      const hasCarTravel=reportLegs.some(leg=>leg.mode!=='public_transport'
        && !(leg.kind==='between' && leg.sameLocation===true));
      if(hasCarTravel){
        addDetail('קילומטרים',Number(km||0).toLocaleString('he-IL')+' ק״מ');
        addDetail('ביטול זמן מחושב',formatTripDuration(minutes??0)+' שעות');
      }else if(Number(minutes||0)>0){
        addDetail('ביטול זמן בין פעילויות',formatTripDuration(minutes)+' שעות');
      }
      const cost=Number(report?.public_transport_cost??reportLegs.reduce((sum,leg)=>
        sum+(leg.mode==='public_transport'?Number(leg.transportCost||0):0),0));
      if(reportLegs.some(leg=>leg.mode==='public_transport'))
        addDetail('תחבורה ציבורית',cost.toLocaleString('he-IL',{style:'currency',currency:'ILS'}));
    }
    savedCard.append(heading,when,details);
    savedCard.hidden=false;
    status.textContent='';
    legsArea.hidden=true;
    noTravelLabel.hidden=true;
    summary.hidden=true;
    actions.replaceChildren();
    if(!locked){
      const edit=document.createElement('button');
      edit.type='button';edit.className='av2-btn av2-btn--secondary';
      edit.textContent='עריכת דיווח';
      edit.addEventListener('click',()=>{
        if(locked || loading || saving)return;
        editingSavedReport=true;
        savedCard.hidden=true;
        noTravelLabel.hidden=!legs.length || legs.some(leg=>leg.kind==='between');
        summary.hidden=false;
        actions.replaceChildren(save);
        renderLegs();
        save.disabled=false;
      });
      actions.append(edit);
    }
  }
  function showSummary(){
    legsArea.hidden=noTravel.checked;
    const inputs=[...legsArea.querySelectorAll('[data-daily-travel-leg]')];
    for(const input of inputs){
      if(input.disabled)continue;
      const index=Number(input.dataset.dailyTravelLeg);
      const raw=input.value.trim();
      legs[index][input.dataset.field]=raw===''?null:Number(raw);
    }
    for(const [index,leg] of legs.entries()){
      if(leg.kind==='between')continue;
      if(leg.mode==='public_transport'){leg.minutes=0;continue;}
      const hour=legsArea.querySelector('[data-duration-hours="'+index+'"]');
      const minute=legsArea.querySelector('[data-duration-minutes="'+index+'"]');
      if(!hour || !minute)continue;
      leg.minutes=hour.value!=='' && minute.value!=='' ? Number(hour.value)*60+Number(minute.value) : null;
    }
    const totals=summarizeDailyTravel(legs);
    const publicTransportFare=legs.reduce((sum,leg)=>
      sum+(leg.mode==='public_transport'?Number(leg.transportCost||0):0),0);
    const hasCarTravel=legs.some(leg=>leg.mode!=='public_transport'
      && !(leg.kind==='between' && leg.sameLocation===true));
    const hasTransit=legs.some(leg=>leg.mode==='public_transport');
    const travelDetails=hasCarTravel
      ? 'ביטול זמן מחושב: '+formatTripDuration(totals.cancellationMinutes)+' שעות'
        +(totals.kilometers===null?'':' · '+totals.kilometers+' ק״מ')
      : (totals.cancellationMinutes>0
        ? 'ביטול זמן בין פעילויות: '+formatTripDuration(totals.cancellationMinutes)+' שעות'
        : '');
    summary.textContent=noTravel.checked ? 'ללא נסיעה'
      : !totals.complete ? 'יש להשלים את נתוני הנסיעה'
      : [travelDetails,hasTransit?'תחבורה ציבורית: ₪'+publicTransportFare.toFixed(2):''].filter(Boolean).join(' · ');
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
      let durationWrap=null;
      if(leg.kind==='between'){
        const fixed=document.createElement('div');
        fixed.className='av2-daily-travel__calculated-field';
        const fieldLabel=document.createElement('span');
        fieldLabel.className='av2-field__label';
        fieldLabel.textContent='ביטול זמן בין פעילויות';
        const value=document.createElement('strong');
        value.textContent=formatTripDuration(leg.gapMinutes)+' שעות · מחושב משעות הפעילויות';
        fixed.append(fieldLabel,value);
        fields.append(fixed);
      }else{
        durationWrap=document.createElement('div');
        durationWrap.className='av2-daily-travel__duration';
        const label=document.createElement('span');
        label.className='av2-field__label';label.textContent='זמן נסיעה בפועל';
        const selects=document.createElement('div');
        selects.className='av2-daily-travel__duration-selects';
        for(const [unit,limit] of [['hours',24],['minutes',59]]){
          const wrap=document.createElement('label');
          const caption=document.createElement('span');
          caption.textContent=unit==='hours'?'שעות':'דקות';
          const select=document.createElement('select');
          select.className='av2-field__select';
          select.dataset['duration'+(unit==='hours'?'Hours':'Minutes')]=String(index);
          const placeholder=document.createElement('option');
          placeholder.value='';placeholder.textContent='בחרי';select.append(placeholder);
          for(let value=0;value<=limit;value++){
            const option=document.createElement('option');
            option.value=String(value);option.textContent=String(value).padStart(2,'0');
            select.append(option);
          }
          const hasValue=Number.isInteger(leg.minutes)&&leg.minutes>=0;
          select.value=hasValue?String(unit==='hours'?Math.floor(leg.minutes/60):leg.minutes%60):'';
          select.addEventListener('change',showSummary);
          wrap.append(caption,select);selects.append(wrap);
        }
        durationWrap.append(label,selects);
        fields.append(durationWrap);
      }
      if(leg.kind==='between' && leg.sameLocation===true){
        const fixed=document.createElement('div');
        fixed.className='av2-daily-travel__calculated-field';
        const label=document.createElement('span');
        label.className='av2-field__label';label.textContent='קילומטרים';
        const value=document.createElement('strong');
        value.textContent='0 ק״מ · אותו מיקום';
        fixed.append(label,value);fields.append(fixed);
      }else{
        const km=createInputField({
          id:'av2-leg-'+index+'-kilometers',label:'קילומטרים',type:'number',
          value:leg.kilometers==null?'':String(leg.kilometers),
          attrs:{min:'0',max:'2000',step:'0.01'}
        });
        km.input.dataset.dailyTravelLeg=String(index);
        km.input.dataset.field='kilometers';
        km.input.addEventListener('input',showSummary);
        fields.append(km.wrap);
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
      const kmInput=fields.querySelector('[data-field="kilometers"]');
      const kmWrap=kmInput?.closest('.av2-field')||kmInput?.parentElement;
      let previousMode=leg.mode;
      let carDraft={minutes:leg.mode==='car'?leg.minutes:null,
        kilometers:leg.mode==='car'?leg.kilometers:null};
      let transitDraft=Number(leg.transportCost||0);
      function syncMode(){
        const nextMode=mode.value;
        if(leg.kind==='between' && leg.sameLocation===true){
          leg.mode='car';leg.kilometers=0;leg.transportCost=0;
          fare.wrap.hidden=true;fare.input.disabled=true;showSummary();return;
        }
        if(previousMode==='car' && nextMode==='public_transport'){
          showSummary();
          carDraft={minutes:leg.minutes,kilometers:leg.kilometers};
        }
        if(previousMode==='public_transport' && nextMode==='car'){
          transitDraft=Number(fare.input.value||0);
          leg.minutes=carDraft.minutes;
          leg.kilometers=carDraft.kilometers;
          if(kmInput)kmInput.value=leg.kilometers==null?'':String(leg.kilometers);
          for(const unit of ['Hours','Minutes']){
            const select=fields.querySelector('[data-duration-'+unit.toLowerCase()+'="'+index+'"]');
            if(select)select.value=Number.isInteger(leg.minutes)
              ?String(unit==='Hours'?Math.floor(leg.minutes/60):leg.minutes%60):'';
          }
        }
        leg.mode=nextMode;
        const transit=nextMode==='public_transport';
        fare.wrap.hidden=!transit;fare.input.disabled=!transit;
        if(kmInput)kmInput.disabled=transit;
        if(kmWrap)kmWrap.hidden=transit;
        if(durationWrap)durationWrap.hidden=transit;
        if(transit){
          if(previousMode==='car')fare.input.value=transitDraft?String(transitDraft):'';
          leg.minutes=leg.kind==='between'?leg.gapMinutes:0;
          leg.kilometers=0;
          if(kmInput)kmInput.value='0';
          leg.transportCost=fare.input.value===''?0:Number(fare.input.value);
        }else{
          leg.transportCost=0;
          fare.input.value='';
        }
        previousMode=nextMode;
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
      ? day.review_status==='rejected'?'נדרש תיקון'
        : ['approved','corrected','pending_review'].includes(day.review_status)?'נשמר':'טרם דווח'
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
    dayOptions=fetched.filter(item=>item.date>='2026-11-01' && item.date?.slice(0,7)===selectedMonth);
    if(selectedMonth==='2026-11'){
      const historical=await readHistoricalAttendance(empId,selectedMonth);
      historicalMonthApproval=historical.approval;
      historicalDays=historicalTravelDays(historical.rows.filter(row=>isLegacyDay(row.report_date)),[]);
      // Existing attendance days must be available even when not present in the
      // assigned-day RPC. Employees may complete travel later in the month.
      for(const day of historicalTravelDays(historical.rows,[])){
        if(dayOptions.some(item=>item.date===day.date))continue;
        const physical=day.records.filter(row=>row.generation_kind==null
          && row.start_time && row.end_time
          && row.activity_type!=='ביטול זמן' && row.activity_type!=='זום'
          && row.training_mode!=='online' && row.operation_meeting_mode!=='online');
        if(!physical.length)continue;
        dayOptions.push({
          date:day.date,
          activities:physical.map(row=>row.activity_name_snapshot||row.activity_type).filter(Boolean).join(' · ')||'פעילות',
          ready:true,review_status:'missing',legacy:isLegacyDay(day.date)
        });
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
    // A date chosen while a request is in flight must be loaded next.
    if(loading){
      if(force || requestedDay!==loadingDay || selectedMonth!==loadingMonth)reloadRequested=true;
      return;
    }
    if(!force && loadedDate===requestedDay && loadedDate!=='')return;
    loadingDay=requestedDay;
    loadingMonth=selectedMonth;
    loading=true;save.disabled=true;reload.disabled=true;
    savedCard.hidden=true;summary.hidden=false;legsArea.hidden=true;
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
      loadingDay=date;
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
      status.textContent=!legs.length?'לא נמצאו פעילויות הדורשות נסיעה בתאריך זה':'';
      const monthKey=date.slice(0,7);
      const monthApproval=await getMonthApproval(empId,monthKey,{force:true});
      if(token!==requestSequence || date!==dateField.input.value || monthKey!==selectedMonth)return;
      const [reportYear,reportMonth]=monthKey.split('-').map(Number);
      const monthEditable=canEditMonth(reportYear,reportMonth,monthApproval);
      locked=!monthEditable; // Manager review is separate from instructor edits while the month is open.
      save.disabled=locked || saving;
      if(!monthEditable)status.textContent='החודש אינו פתוח לעריכה';
      renderLegs();
      if(stored)showSavedReport(stored);
      else {savedCard.hidden=true;legsArea.hidden=noTravel.checked;summary.hidden=false;actions.replaceChildren(save);}
    }catch(err){
      status.textContent=err.message||'טעינת הנסיעות נכשלה';
      loadedDate='';
    }finally{
      loading=false;reload.disabled=false;
      if(loadedDate===dateField.input.value && !save.hidden && !locked && !saving)save.disabled=false;
      if(reloadRequested){
        reloadRequested=false;
        await load({force:true});
      }
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
    if(loading || saving || locked || loadedDate!==dateField.input.value)return;
    showSummary();
    if(!noTravel.checked && legs.some(leg=>leg.kind!=='between' && leg.mode!=='public_transport' && !Number.isInteger(leg.minutes))){
      status.textContent='יש לבחור שעות ודקות לכל נסיעה ברכב';
      return;
    }
    // Keep the clicked date and its values together across every await.
    const saveDate=loadedDate;
    const saveLegs=legs.map(leg=>({...leg}));
    const saveNoTravel=noTravel.checked;
    const showingSavedDate=()=>loadedDate===saveDate && dateField.input.value===saveDate;
    saving=true;save.disabled=true;
    status.textContent='שומר את הדיווח…';
    try{
      const monthKey=saveDate.slice(0,7);
      const [year,month]=monthKey.split('-').map(Number);
      const approval=await getMonthApproval(empId,monthKey,{force:true});
      if(!canEditMonth(year,month,approval)){
        if(showingSavedDate())status.textContent='החודש נעול לדיווח. נדרש לפתוח אותו מחדש לעריכה.';
        return;
      }
      const saved=await saveDailyTravel(saveDate,saveLegs,saveNoTravel);
      if(!saved || String(saved.travel_date)!==saveDate)
        throw new Error('לא התקבל אישור שמירה מהשרת. בדקי את הדיווח לפני ניסיון חוזר.');
      if(showingSavedDate()){
        legs=saved?.legs?.length?saved.legs:saveLegs;
        showSavedReport({...saved,reported_at:saved.reported_at||new Date().toISOString()});
      }
      const day=dayOptions.find(item=>item.date===saveDate);
      if(day){
        day.review_status='pending_review';
        const option=[...daySelect.options].find(item=>item.value===saveDate);
        if(option)option.textContent=displayDay(day);
        syncDayPicker();
      }
    }catch(error){
      if(showingSavedDate())status.textContent=error.message||'שמירת הנסיעות נכשלה';
    }finally{
      saving=false;
      save.disabled=loading || locked || loadedDate!==dateField.input.value;
    }
  });
  return {panel,load,setDate,dateInput:dateField.input};
}
