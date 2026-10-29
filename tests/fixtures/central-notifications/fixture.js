// Manual test fixture only. Never imported by the production entry point.
import { createClient } from '@supabase/supabase-js';
import { editRequestsScreen } from '../../../frontend/src/screens/edit-requests.js';
import { bindNotificationInbox } from '../../../frontend/src/notifications/view.js';
import { createNotificationService } from '../../../frontend/src/notifications/service.js';
import { createNotificationRuntime } from '../../../frontend/src/notifications/runtime.js';
import { headerNavGridHtml } from '../../../frontend/src/screens/shared/act-nav-grid.js';
const root=document.querySelector('#screenRoot');
let runtime;
const legacyGroups=[{request_id:'test-edit-incoming',request_type:'edit_activity',status:'pending',requested_by_user_id:'requester',requested_by_name:'עובד בדיקה',requested_at:'2026-10-29T12:00:00Z',activity_name:'סדנת בדיקה',fields:[{field_name:'notes',old_value:'פרט קודם',new_value:'פרט מעודכן'}]},
{request_id:'test-edit-sent',request_type:'edit_activity',status:'pending',requested_by_user_id:'viewer',requested_at:'2026-10-29T11:00:00Z',activity_name:'בקשה ששלחתי',fields:[{field_name:'notes',old_value:'קודם',new_value:'חדש'}]},
{request_id:'test-edit-resolved',request_type:'edit_activity',status:'approved',requested_by_user_id:'viewer',requested_at:'2026-10-28T11:00:00Z',activity_name:'בקשה שטופלה',fields:[{field_name:'notes',old_value:'קודם',new_value:'חדש'}]}];
function mount(state,service,client=null,groups=[]) {
 runtime?.dispose();
 root.__notificationInboxAbort?.abort();
 const data={currentUserId:'viewer',canReview:true,groups};
 root.innerHTML=editRequestsScreen.render(data);
 const updateNav=counts=>{
  state.notificationTaskCount=counts.tasks;state.notificationUnreadCount=counts.unread;
  document.querySelector('#test-nav').innerHTML=headerNavGridHtml({route:'edit-requests',routes:['edit-requests']},{notificationTasks:counts.tasks,notificationUnread:counts.unread,editRequestsIncoming:groups.some(x=>x.request_id==='test-edit-incoming')?1:0,editRequestsSent:groups.some(x=>x.request_id==='test-edit-sent')?1:0});
 };
 const refresh=async()=>{updateNav(await service.counts());document.dispatchEvent(new CustomEvent('app:notifications-changed'));};
 bindNotificationInbox({root,service,state,refreshCounts:refresh,openAttendance:()=>{window.openedAttendance=true;}});
 if(client){runtime=createNotificationRuntime({client,service,onCounts:updateNav,onChange:()=>document.dispatchEvent(new CustomEvent('app:notifications-changed'))});runtime.switchUser(state.user.auth_user_id);}
 else void refresh();
 window.fixtureState=state;window.fixtureService=service;
}
window.visualScenario=(scenario='populated',count=3)=>{
 const state={user:{auth_user_id:'visual-user',role:'admin'},notificationUnreadCount:count};
 const rows=scenario==='empty'?[]:Array.from({length:count},(_,i)=>({id:`visual-${i}`,domain:['proposal','attendance','personal_report'][i%3],entity_key:i%3===1?'10|2026-10':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stage:['sign','final_review','review'][i%3],event_type:['awaiting_signature','manager_approved','submitted'][i%3],created_at:'2026-10-29T12:00:00Z',read_at:null}));
 const labels=Object.fromEntries(rows.map((r,i)=>[r.id,{subject_label:['הצעת מחיר מס׳ 1045 — לקוח בדיקה','גיל נאמן — עובד בדיקה','הילה רוזן — עובדת בדיקה'][i%3],month_key:i%3?'2026-10':null}]));
 const service={counts:async()=>({tasks:rows.length,unread:rows.filter(r=>!r.read_at).length}),tasks:async()=>rows,page:async()=>({rows,hasMore:false}),closedTasks:async()=>({rows:[],hasMore:false}),details:async()=>labels,issues:async()=>[],markRead:async id=>{rows.find(r=>r.id===id).read_at=new Date().toISOString();return true;}};
 mount(state,service,null,scenario==='empty'?[]:legacyGroups);
};
window.localSupabaseScenario=async config=>{
 const url=new URL(config.url);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Only disposable localhost Supabase is allowed');
 const client=createClient(config.url,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data,error}=await client.auth.signInWithPassword({email:config.email,password:config.password});if(error)throw error;
 window.localClient=client;
 const state={user:{auth_user_id:data.user.id,role:config.role},notificationUnreadCount:0};
 mount(state,createNotificationService(client),client,[]);
 return data.user.id;
};
window.visualScenario(new URL(location.href).searchParams.get('scenario')||'populated');
window.fixtureReady=true;
