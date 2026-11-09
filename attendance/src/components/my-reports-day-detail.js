import {createIcon} from './icon.js';
import {instructorReportedCancellationMinutes} from '../services/cancellation-segments.js';

const amount=value=>Number.isFinite(Number(value))?Number(value):0;
const money=value=>'₪'+amount(value).toLocaleString('he-IL',{maximumFractionDigits:2});

/** Per-activity time remains HH:MM; daily and monthly totals use decimal hours. */
export function formatActivityHours(value){
  const minutes=Math.max(0,Math.round(amount(value)*60));
  return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}

export function formatDecimalHours(value){
  return Math.max(0,amount(value)).toLocaleString('he-IL',{
    minimumFractionDigits:2,maximumFractionDigits:2
  });
}

export function buildDayDetailModel({records=[],travelReport=null,expenseReports=[],modern=false}={}){
  const rows=Array.isArray(records)?records:[];
  const sourceExpenses=Array.isArray(expenseReports)?expenseReports:[];
  // The expense tab is the current source from November 2026.
  // Older months retain the expenses saved inside each activity report.
  const expenses=modern
    ?sourceExpenses.reduce((sum,row)=>sum+amount(row?.amount),0)
    :rows.reduce((sum,row)=>sum+amount(row?.expenses),0);
  const legs=Array.isArray(travelReport?.legs)?travelReport.legs:[];
  const hasCar=legs.some(leg=>leg.mode==='car' && !(leg.kind==='between' && leg.sameLocation));
  const hasTransit=legs.some(leg=>leg.mode==='public_transport')
    ||amount(travelReport?.public_transport_cost)>0;
  if(modern){
    return {
      hasReport:!!travelReport,
      noTravel:travelReport?.no_travel===true,
      kilometers:travelReport?amount(travelReport.total_km):null,
      publicTransportCost:travelReport?amount(travelReport.public_transport_cost):null,
      cancellationHours:travelReport?amount(travelReport.cancellation_minutes)/60:null,
      expenses,legs,hasCar,hasTransit,
    };
  }
  const kilometers=rows.reduce((sum,row)=>sum+amount(row?.roundtrip_km),0);
  const publicTransportCost=rows.reduce((sum,row)=>sum+amount(row?.public_transport_cost),0);
  const reportedMinutes=rows.map(row=>instructorReportedCancellationMinutes(row));
  const minutes=reportedMinutes.reduce((sum,value)=>sum+Math.max(0,amount(value)),0);
  return {
    hasReport:true,noTravel:false,kilometers,publicTransportCost,
    cancellationHours:reportedMinutes.some(value=>value!==null)?minutes/60:null,expenses,legs:[],
    hasCar:kilometers>0,hasTransit:publicTransportCost>0
  };
}

function metric(label, value, extraClass=''){
  const container=document.createElement('div');
  container.className='av2-day-detail__metric '+extraClass;
  const title=document.createElement('span');
  title.className='av2-day-detail__label';title.textContent=label;
  const display=document.createElement('strong');
  display.className='av2-day-detail__value';
  display.textContent=value;
  container.append(title,display);
  return {container,display};
}

export function createDayDetailRow({date,records,travelReport,expenseReports,modern,onTravelReport}={}){
  const model=buildDayDetailModel({records,travelReport,expenseReports,modern});
  const row=document.createElement('section');
  row.className='av2-report-day-detail';
  row.dataset.reportDate=date||'';
  row.setAttribute('aria-label','סיכום נסיעות והוצאות ליום '+(date||''));
  const strip=document.createElement('div');
  strip.className='av2-report-day-detail__strip';

  const route=document.createElement('div');
  route.className='av2-day-detail__metric av2-day-detail__route';
  const routeLabel=document.createElement('span');
  routeLabel.className='av2-day-detail__label';
  routeLabel.textContent=model.hasTransit&&!model.hasCar?'תחבורה ציבורית':model.hasCar&&!model.hasTransit?'סה״כ קילומטר':'נסיעות';
  route.append(routeLabel);

  const parts=[];
  if(!model.hasReport)parts.push('טרם דווח');
  else if(model.noTravel)parts.push('ללא נסיעה');
  else{
    if(model.hasCar)parts.push(model.kilometers.toLocaleString('he-IL',{maximumFractionDigits:2})+' ק״מ');
    if(model.hasTransit)parts.push(money(model.publicTransportCost)+' תחבורה ציבורית');
    if(!parts.length)parts.push('0 ק״מ');
  }
  const routeText=parts.join(' · ');
  if(model.legs.length){
    const btn=document.createElement('button');
    btn.type='button';btn.className='av2-day-detail__route-toggle';
    btn.textContent=routeText;
    btn.setAttribute('aria-expanded','false');
    btn.title='פירוט מסלול הנסיעה';
    const detail=document.createElement('div');
    detail.id='av2-day-route-'+String(date||'').replace(/[^0-9-]/g,'');
    detail.className='av2-day-detail__route-breakdown';
    detail.hidden=true;
    btn.setAttribute('aria-controls',detail.id);
    const kinds={outbound:'הלוך',between:'בין פעילויות',return:'חזור'};
    for(const leg of model.legs){
      const line=document.createElement('div');
      const items=[kinds[leg.kind]||'נסיעה',
        [leg.from,leg.to].filter(Boolean).join(' ← ')];
      if(leg.mode==='public_transport')
        items.push(money(leg.transportCost)+' תחבורה ציבורית');
      else{
        items.push(amount(leg.kilometers).toLocaleString('he-IL',{maximumFractionDigits:2})+' ק״מ');
        if(Number.isFinite(Number(leg.minutes)))items.push(amount(leg.minutes)+' דק׳');
      }
      line.textContent=items.filter(Boolean).join(' · ');
      detail.append(line);
    }
    btn.addEventListener('click',event=>{
      event.stopPropagation();
      detail.hidden=!detail.hidden;
      btn.setAttribute('aria-expanded',String(!detail.hidden));
    });
    route.append(btn);
    row.append(detail);
  }else{
    const value=document.createElement('strong');
    value.className='av2-day-detail__value';value.textContent=routeText;
    route.append(value);
  }
  strip.append(route);
  const cancellation=metric('ביטול זמן',
    model.cancellationHours===null?'—':formatDecimalHours(model.cancellationHours)+' שעות');
  strip.append(cancellation.container);
  if(model.expenses>0){
    const expense=metric('',money(model.expenses),'av2-day-detail__expense');
    expense.container.querySelector('.av2-day-detail__label')?.remove();
    expense.container.prepend(createIcon('receipt',{size:15}));
    expense.container.title='הוצאות שדווחו';
    strip.append(expense.container);
  }
  row.prepend(strip);
  return row;
}
