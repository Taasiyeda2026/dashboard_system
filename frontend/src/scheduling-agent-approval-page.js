import {supabase} from './supabase-client.js';
import {agentRequestHtml,escapeAgentHtml as e} from './screens/shared/scheduling-agent-approvals-view.js';
const root=document.getElementById('requests');
const rpc=async(name,args={})=>{const {data,error}=await supabase.rpc(name,args);if(error)throw Error('הפעולה לא אושרה על ידי השרת. יש לבדוק הרשאה ותוקף הבקשה.');return data;};
async function start(){
 if(!supabase)throw Error('אין חיבור למערכת.');
 const {data,error}=await supabase.auth.getUser();
 if(error||!data.user){root.innerHTML='<p>יש להתחבר תחילה לדשבורד בחשבון האישי שלך, ואז לחזור לעמוד הזה ולרענן.</p>';return;}
 // OAuth consent can be granted by *any authorized scheduling team member*,
 // but only after the actual Supabase session is verified on the server. This
 // must not inherit the old owner's broader scheduling approval permissions.
 const authorizationId=new URL(location.href).searchParams.get('authorization_id');
 if(authorizationId){
  if(!/^[a-zA-Z0-9_-]{1,200}$/.test(authorizationId))throw Error('בקשת הרשאה לא תקינה.');
  const {data:teamAccess,error:teamError}=await supabase.rpc('scheduling_agent_team_identity');
  if(teamError||teamAccess?.authorized!==true)throw Error('אין הרשאה להתחבר לסוכן השיבוצים הארגוני.');
  const details=await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if(details.error)throw Error('בקשת הרשאת הסוכן אינה זמינה.');
  const d=details.data;
  if(d.redirect_url){redirect(d.redirect_url);return;}
  root.innerHTML=`<article><h2>הרשאת חיבור לסוכן</h2><p>היישום: ${e(d.client?.name||d.client?.client_name||'לקוח MCP')}</p><p>ההרשאות המבוקשות: ${e(d.scope)}</p><p>גישה לסוכן אינה אישור לביצוע שיבוץ. כל שינוי דורש בקשה ואישור נפרדים.</p><button data-consent="yes">מאשר את החיבור</button> <button class="secondary" data-consent="no">דוחה</button></article>`;
  root.onclick=async event=>{const button=event.target.closest('[data-consent]');if(!button)return;button.disabled=true;
   const result=button.dataset.consent==='yes'?await supabase.auth.oauth.approveAuthorization(authorizationId):await supabase.auth.oauth.denyAuthorization(authorizationId);
   if(result.error){showError('לא ניתן להשלים את ההרשאה.');return;}redirect(result.data.redirect_url);
  };return;
 }
 // Approval of actual scheduling changes is still OWNER-ONLY, and never
 // becomes available to staff merely because they may authorize their MCP.
 await rpc('scheduling_agent_read_snapshot');
 const requests=await rpc('scheduling_agent_list_requests');
 root.innerHTML=requests.length?requests.map(r=>agentRequestHtml(r)).join(''):'<p>אין בקשות שינוי. לא נשלחו שיבוצים לאישור במסגרת ההקמה.</p>';
 root.onchange=event=>{const input=event.target.closest('[data-reviewed]');if(input){const button=root.querySelector(`[data-approve="${CSS.escape(input.dataset.reviewed)}"]`);if(button)button.disabled=!input.checked;}};
 root.onclick=async event=>{const button=event.target.closest('[data-approve]');if(!button||button.disabled)return;
  const request=requests.find(r=>r.id===button.dataset.approve);if(!request||new Date(request.expires_at).getTime()<=Date.now()){showError('הבקשה פגה. יש להפיק הצעה חדשה.');return;}
  button.disabled=true;
  try{await rpc('scheduling_agent_approve',{p_request_id:request.id,p_preview_hash:request.preview_hash});await start();}catch(error){showError(error.message);}
 };
}
function redirect(value){const target=new URL(value);if(target.protocol!=='https:')throw Error('כתובת חזרה לא תקינה.');location.assign(target.href);}
function showError(message){root.innerHTML=`<p class="error">${e(message)}</p>`;}
start().catch(error=>showError(error.message));
