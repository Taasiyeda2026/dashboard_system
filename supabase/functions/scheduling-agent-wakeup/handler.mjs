// A durable reservation in the EXISTING job queue coalesces concurrent wakeups.
export function createWakeupHandler({secret,command,dispatch,notify,cryptoImpl=globalThis.crypto}) {
  const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  return async request=>{
    if(request.method!=='POST')return response({code:'post_required'},405);
    const supplied=request.headers.get('x-scheduling-wakeup-secret')||'';
    if(!secret||secret.length<32)return response({code:'wakeup_not_configured'},503);
    const digest=async value=>new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value)));
    const [a,b]=await Promise.all([digest(secret),digest(supplied)]);
    let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
    if(mismatch)return response({code:'unauthorized'},401);
    let body;
    try{
      const raw=await request.text();
      if(raw.length>256)return response({code:'invalid_wakeup_request'},400);
      body=raw?JSON.parse(raw):{};
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='action')
        ||(body.action!==undefined&&!['verify','wake'].includes(body.action)))throw Error();
    }catch{return response({code:'invalid_wakeup_request'},400);}
    if(body.action==='verify'){
      try{const github=await dispatch.verify();
        const alerts=notify?.verify?await notify.verify():{configured:false};
        return response({...github,alerts});}
      catch(error){return response({code:error?.code||'github_verification_failed'},503);}
    }
    // Alert delivery failure never prevents compute wakeup. Its own durable outbox retries.
    if(notify)try{await notify();}catch{}
    let reservation;
    try {
      reservation=await command('reserve',{});
      if(reservation?.reserved!==true)return response({status:'idle'});
      let failureCode=null;
      try{await dispatch();}catch(error){failureCode=error?.code||'github_dispatch_failed';}
      // Only fixed safe codes, never provider bodies, keys or tokens.
      failureCode=failureCode?String(failureCode).replace(/[^a-z0-9_]/g,'').slice(0,80):null;
      await command('ack',{jobId:reservation.jobId,dispatchToken:reservation.dispatchToken,
        accepted:!failureCode,failureCode});
      return response({status:failureCode?'retry_pending':'dispatch_accepted',code:failureCode},failureCode?503:200);
    }catch{return response({code:'wakeup_backend_unavailable'},503);}
    // If dispatch/ack response is lost, the DB reservation expires. Cron retries.
  };
}
