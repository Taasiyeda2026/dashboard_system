/**
 * Instructor-visible daily travel values come from the saved daily report,
 * NOT from attendance rows or manager-approved payroll amounts.
 */
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function formatTravelMinutes(value) {
  const minutes=Math.max(0,Math.round(number(value)));
  return `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;
}

export function formatTravelDistance(value) {
  return number(value).toLocaleString('he-IL',{maximumFractionDigits:2})+' ק״מ';
}

export function sumReportedDailyTravel(reports=[]) {
  const valid=Array.isArray(reports)?reports.filter(row=>row?.travel_date):[];
  return valid.reduce((totals,row)=>{
    totals.count++;
    if(!row.no_travel){
      totals.kilometers+=number(row.total_km);
      totals.cancellationMinutes+=number(row.cancellation_minutes);
      totals.publicTransportCost+=number(row.public_transport_cost);
    }
    return totals;
  },{count:0,kilometers:0,cancellationMinutes:0,publicTransportCost:0});
}

export function dailyTravelDetails(row) {
  if(!row)return '';
  if(row.no_travel)return 'נסיעות: ללא נסיעה';
  const parts=['נסיעות: '+formatTravelDistance(row.total_km),
    'ביטול זמן: '+formatTravelMinutes(row.cancellation_minutes)];
  const transit=number(row.public_transport_cost);
  if(transit>0 || (row.legs||[]).some(leg=>leg.mode==='public_transport'))
    parts.push('תחבורה ציבורית: ₪'+transit.toLocaleString('he-IL',{maximumFractionDigits:2}));
  return parts.join(' · ');
}

export function createReportedTravelTable(reports=[],{title='נסיעות שדווחו'}={}) {
  const rows=Array.isArray(reports)?[...reports].filter(row=>row?.travel_date)
    .sort((a,b)=>String(b.travel_date).localeCompare(String(a.travel_date))):[];
  const section=document.createElement('section');
  section.className='av2-reported-travel';
  const heading=document.createElement('h3');
  heading.className='av2-reported-travel__heading';
  heading.textContent=title;
  section.append(heading);
  if(!rows.length){
    const empty=document.createElement('p');
    empty.className='av2-reported-travel__empty';
    empty.textContent='אין דיווחי נסיעות שמורים בחודש זה';
    section.append(empty);
    return section;
  }
  const scroll=document.createElement('div');
  scroll.className='av2-reported-travel__scroll';
  const table=document.createElement('table');
  table.className='av2-reported-travel__table';
  const head=document.createElement('thead');
  const headerRow=document.createElement('tr');
  for(const label of ['תאריך','קילומטרים','ביטול זמן','תחבורה ציבורית','דיווח']){
    const th=document.createElement('th');
    th.scope='col';th.textContent=label;headerRow.append(th);
  }
  head.append(headerRow);
  const body=document.createElement('tbody');
  for(const report of rows){
    const tr=document.createElement('tr');
    const date=String(report.travel_date).slice(0,10).split('-').reverse().join('.');
    const transit=number(report.public_transport_cost);
    const hasTransit=transit>0||(report.legs||[]).some(leg=>leg.mode==='public_transport');
    const values=[
      date,
      report.no_travel?'ללא נסיעה':formatTravelDistance(report.total_km),
      report.no_travel?'—':formatTravelMinutes(report.cancellation_minutes),
      hasTransit?'₪'+transit.toLocaleString('he-IL',{maximumFractionDigits:2}):'—',
      report.review_status==='rejected'?'נדרש תיקון':'נשמר'
    ];
    values.forEach((value,index)=>{
      const td=document.createElement('td');
      td.textContent=value;
      if(index===4 && report.review_status==='rejected')
        td.className='av2-reported-travel__needs-fix';
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(head,body);
  scroll.append(table);
  section.append(scroll);
  return section;
}
