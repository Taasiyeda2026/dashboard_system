// Reuses the existing server-only MS_* Graph application, never feedback-specific credentials.
// A durable begin_send barrier prevents replay after an ambiguous send/crash.
// Unknown delivery is visible in the dashboard; never automatically resend it.
const mailError=code=>Object.assign(new Error(code),{code});
export function createAlertDelivery({tenantId='',clientId='',clientSecret='',sender='',command,fetchImpl=fetch}) {
  const configured=()=>[tenantId,clientId,clientSecret,sender].every(Boolean);
  async function accessToken(){
    if(!configured())throw mailError('alert_mail_not_configured');
    if(!/^[0-9a-f-]{36}$/i.test(tenantId)||!/^[0-9a-f-]{36}$/i.test(clientId)
      ||!/^\S+@[^\s@]+\.[^\s@]+$/.test(sender))throw mailError('alert_configuration_invalid');
    const response=await fetchImpl('https://login.microsoftonline.com/'+tenantId+'/oauth2/v2.0/token',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,
        scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})
    });
    if(!response.ok)throw mailError('alert_graph_token_failed');
    const {access_token:token}=await response.json();
    try{
      const raw=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const claims=JSON.parse(atob(raw.padEnd(Math.ceil(raw.length/4)*4,'=')));
      if(String(claims.appid||claims.azp).toLowerCase()!==clientId.toLowerCase()
        ||String(claims.tid).toLowerCase()!==tenantId.toLowerCase()
        ||!Array.isArray(claims.roles)||!claims.roles.includes('Mail.Send'))throw Error();
    }catch{throw mailError('alert_graph_mail_send_required');}
    return token;
  }
  const deliver=async()=>{
    if(!configured())return {status:'not_configured'};
    // Token acquisition precedes reservation: an identity outage cannot lose an alert.
    const token=await accessToken();
    const item=await command('reserve',{});
    if(item?.reserved!==true)return {status:'idle'};
    const started=await command('begin_send',{alertId:item.alertId,deliveryToken:item.deliveryToken});
    if(started?.started!==true)throw mailError('alert_reservation_lost');
    let accepted=false,uncertain=true,retrySafe=false;
    try{
      if(!/^\S+@[^\s@]+\.[^\s@]+$/.test(item.recipient||''))throw mailError('alert_recipient_unavailable');
      const response=await fetchImpl('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(sender)+'/sendMail',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify({message:{subject:'סוכן השיבוצים: נדרשת בדיקת מנהל',
          body:{contentType:'Text',content:'משימת שיבוץ '+item.jobId+': '+({failed:'נכשלה סופית',queue_overdue:'ממתינה בתור זמן חריג',worker_unresponsive:'מנוע החישוב אינו מגיב',dispatch_failure:'תקלה מתמשכת בהפעלת GitHub Actions'}[item.kind]||'נדרשת בדיקת מנהל')+
            '. זמן זיהוי UTC: '+item.eventAt+'. פעולה נדרשת: בדיקת תור המשימות, לוגי הסוכן והרשאות GitHub Actions; אין לפתוח משימה כפולה. מזהה התראה: '+item.alertId},
          toRecipients:[{emailAddress:{address:item.recipient}}],
          internetMessageHeaders:[{name:'X-Scheduling-Alert-Id',value:item.alertId}]},saveToSentItems:true})
      });
      accepted=response.status===202;
      retrySafe=response.status===429;
      uncertain=!accepted&&!retrySafe; // Explicitly rejected by Graph, safe bounded retry.
    }catch{/* Never expose provider responses, credentials or recipient addresses. */}
    await command('ack',{alertId:item.alertId,deliveryToken:item.deliveryToken,accepted,uncertain,retrySafe});
    return {status:accepted?'accepted':uncertain?'delivery_unknown':retrySafe?'retry_pending':'rejected'};
  };
  deliver.verify=async()=>{await accessToken();const facts=await command('verify',{});
    if(facts?.recipientReady!==true)throw mailError('alert_recipient_unavailable');
    return {configured:true,mailSend:true,recipientReady:true};};
  return deliver;
}
