// Account-only billing values. Source rows and real meeting slots stay immutable.
export const gefenBillingKey = row => JSON.stringify([row.activityRowId,row.fundingSourceId]);
export function gefenBillingGroups(lines) {
  const groups=new Map();
  for(const row of lines){
    const key=gefenBillingKey(row);
    if(!groups.has(key))groups.set(key,{key,rows:[],activityRowId:row.activityRowId,fundingSourceId:row.fundingSourceId,activityName:row.activityName,meetings:0,hours:0,amount:0});
    const group=groups.get(key);group.rows.push(row);group.meetings+=Number(row.unbilledCount||0);group.hours+=Number(row.unbilledHours||0);group.amount+=Number(row.issuableAmount||0);
  }
  return [...groups.values()].map(g=>({...g,rate:Number((g.hours>0?g.amount/g.hours:Number(g.rows[0].hourlyRate||g.amount)).toFixed(6))}));
}
export function gefenBillingValues(data,group){
  const saved=data.gefenBillingOverrides?.[group.key];
  // Bind edits to the exact source periods/revisions; refreshing changed source
  // must never silently reuse approval for a different set of meetings.
  const sourceKey=JSON.stringify(group.rows.map(r=>[r.period,r.billingSourceRevision]));
  return {...{meetings:group.meetings,hours:group.hours,rate:group.rate},...(saved?.sourceKey===sourceKey?saved.values:{}),meetings:group.meetings,sourceKey};
}
export function gefenBillingAmount(values){return Math.round((Number(values.hours)*Number(values.rate)+Number.EPSILON)*100)/100;}
export function updateGefenBillingValue(data,lines,key,field,value){
  if(!['hours','rate'].includes(field))return false;
  const group=gefenBillingGroups(lines).find(g=>g.key===key);if(!group)return false;
  const current=gefenBillingValues(data,group);
  data.gefenBillingOverrides||={};
  data.gefenBillingOverrides[key]={sourceKey:current.sourceKey,values:{hours:current.hours,rate:current.rate,[field]:value}};
  data.transactionIssuancePreview=null;data.pendingTransactionApproval=null;
  return true;
}
export function gefenBillingRequest(data,account,cutoffDate){
  return {cutoffDate,groups:gefenBillingGroups(account.lines).map(group=>{
    const v=gefenBillingValues(data,group);
    if(!Number.isInteger(Number(v.meetings))||Number(v.meetings)<=0||!Number.isFinite(Number(v.hours))||Number(v.hours)<=0||!Number.isFinite(Number(v.rate))||Number(v.rate)<=0||!(gefenBillingAmount(v)>0))throw Error('יש להזין שעות ומחיר לשעה חיוביים. מספר המפגשים נקבע לפי מועדי הפעילות.');
    return {activity:group.activityRowId,funder:group.fundingSourceId,meetings:Number(v.meetings),hours:Number(v.hours),rate:Number(v.rate),periods:group.rows.map(row=>({month:row.period,revision:row.billingSourceRevision}))};
  })};
}
