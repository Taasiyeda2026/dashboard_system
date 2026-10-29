import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNotificationRuntime } from '../frontend/src/notifications/runtime.js';
import { notificationTarget, consumeNotificationTarget } from '../frontend/src/notifications/target.js';
import { notificationBadgeHtml } from '../frontend/src/notifications/badges.js';
import { notificationRowsHtml, bindNotificationInbox } from '../frontend/src/notifications/view.js';
import { editRequestsScreen } from '../frontend/src/screens/edit-requests.js';
import { headerNavGridHtml } from '../frontend/src/screens/shared/act-nav-grid.js';
const tick = () => new Promise(resolve=>setTimeout(resolve,0));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('typed deep links reject arbitrary URLs and select exact document, month and approval stage',()=>{
 assert.equal(notificationTarget({domain:'proposal',entity_key:'https://evil.test'}),null);
 assert.deepEqual(notificationTarget({domain:'proposal',entity_key:id}),{route:'proposals-agreements',proposalId:id});
 assert.deepEqual(notificationTarget({domain:'attendance',entity_key:'10|2026-10',stage:'payroll'}),{route:'finance',employeeId:'10',monthKey:'2026-10'});
 assert.equal(notificationTarget({domain:'attendance',entity_key:'10|2026-13'}),null);
 assert.equal(notificationTarget({domain:'attendance',entity_key:'10|2026-10',stage:'final_review'}).route,'admin-home');
 const state={user:{auth_user_id:'b'},notificationTarget:{route:'personal-reports',authUserId:'a',reportId:id}};
 assert.equal(consumeNotificationTarget(state,'personal-reports'),null);
 state.user.auth_user_id='a'; assert.equal(consumeNotificationTarget(state,'personal-reports').reportId,id);assert.equal(state.notificationTarget,null);
});

test('Realtime, reconnect and visible fallback refresh counts without leaking late user responses',async()=>{
 const dom=new JSDOM('');const subscriptions=[],counts=[],removed=[],intervals=[],timeouts=[];
 let resolveOld;
 const service={counts:()=>new Promise(resolve=>{resolveOld=resolve;})};
 const client={channel(name){const channel={name,handlers:[],on(event,filter,fn){this.handlers.push({filter,fn});return this;},subscribe(fn){this.status=fn;subscriptions.push(this);return this;}};return channel;},removeChannel(channel){removed.push(channel);return Promise.resolve();}};
 const timers={setInterval(fn){intervals.push(fn);return 1;},clearInterval(){},setTimeout(fn){timeouts.push(fn);return timeouts.length;},clearTimeout(){}};
 const runtime=createNotificationRuntime({client,service,onCounts:c=>counts.push(c),document:dom.window.document,timers});
 runtime.switchUser('a');await tick();const oldResolve=resolveOld;
 runtime.switchUser('b');await tick();oldResolve({tasks:99,unread:99});resolveOld({tasks:2,unread:3});await tick();
 assert.equal(counts.some(c=>c.tasks===99),false);assert.deepEqual(counts.at(-1),{tasks:2,unread:3});
 assert.equal(removed.length,1);assert.equal(subscriptions[1].handlers.length,2);
 assert.equal(subscriptions[1].handlers[0].filter.filter,'recipient_auth_user_id=eq.b');
 subscriptions[1].status('TIMED_OUT');assert.equal(timeouts.length,1);timeouts[0]();assert.equal(subscriptions.length,3);
 intervals[0]();await tick();resolveOld({tasks:0,unread:1});await tick();assert.equal(counts.at(-1).unread,1);
 runtime.dispose();assert.deepEqual(counts.at(-1),{tasks:0,unread:0});dom.window.close();
});

test('compact tabs preserve legacy requests and show only one empty message, without placeholder cards',()=>{
 const html=editRequestsScreen.render({currentUserId:'me',groups:[]});const dom=new JSDOM(html);const doc=dom.window.document;
 assert.equal(doc.querySelector('h1').textContent,'אישורים');assert.equal(doc.querySelectorAll('[role=tab]').length,3);
 assert.equal(doc.querySelectorAll('.ds-notification-empty').length,1);assert.equal(doc.querySelectorAll('.ds-card').length,0);
 assert.equal(doc.querySelectorAll('[data-notification-panel]:not([hidden])').length,1);dom.window.close();
});

test('unread and task counts remain separate and navigation retains sent-request count',()=>{
 const badge=notificationBadgeHtml({tasks:3,unread:2});assert.match(badge,/3 משימות/);assert.match(badge,/2 עדכונים/);assert.match(badge,/ds-notification-dot/);
 const html=headerNavGridHtml({routes:['edit-requests']},{editRequestsIncoming:4,editRequestsSent:5,notificationTasks:3,notificationUnread:2});
 assert.match(html,/7 משימות ממתינות/);assert.match(html,/5 בקשות ששלחתי/);assert.match(html,/מתוכן 4 בקשות עריכה/);
 assert.doesNotMatch(notificationBadgeHtml({tasks:0,unread:0}),/dot/);
});

test('rows display canonical names, month and process icon, escape content and never show internal IDs',()=>{
 const html=notificationRowsHtml([{id,domain:'attendance',entity_key:'10|2026-10',subject_label:'גיל <script>',month_key:'2026-10',stage:'final_review',created_at:'2026-10-29T12:00:00Z'}],{tasks:true});
 const dom=new JSDOM(html);const text=dom.window.document.body.textContent;
 assert.match(text,/גיל <script>/);assert.match(text,/אוקטובר 2026/);assert.match(text,/ממתין לאישור סופי/);assert.doesNotMatch(text,/aaaaaaaa|entity_key|10\|/);
 assert.equal(dom.window.document.querySelectorAll('script').length,0);assert.ok(dom.window.document.querySelector('svg'));dom.window.close();
});

test('mark read keeps task open, tabs and history filters work, and many tasks remain individual compact rows',async()=>{
 const dom=new JSDOM(editRequestsScreen.render({currentUserId:'me',groups:[]}),{url:'https://example.test'});
 const oldAbort=globalThis.AbortController,oldCustom=globalThis.CustomEvent;
 globalThis.AbortController=dom.window.AbortController;globalThis.CustomEvent=dom.window.CustomEvent;
 const row={id,domain:'personal_report',entity_key:id,event_type:'approved',stage:'employee',created_at:'2026-10-29T12:00:00Z'};
 const pending=Array.from({length:150},(_,i)=>({...row,id:`task-${i}`,stage:'review'}));
 const state={user:{auth_user_id:'me'},notificationUnreadCount:1};let marked=0,filters;
 const service={page:async options=>{filters=options?.filters;return {rows:[row],hasMore:false};},tasks:async()=>pending,
  details:async rows=>Object.fromEntries(rows.map(r=>[r.id,{subject_label:'עובד',month_key:'2026-10'}])),markRead:async()=>{marked++;return true;},closedTasks:async()=>({rows:[],hasMore:false})};
 try {
  bindNotificationInbox({root:dom.window.document.body,service,state,refreshCounts(){},openAttendance(){}});await tick();await tick();
  const doc=dom.window.document;assert.equal(doc.querySelectorAll('[data-notification-tasks] article').length,150);
  assert.equal(doc.querySelector('[data-notification-task-count]').textContent,'150');
  doc.querySelector('[data-notification-tab=updates]').click();doc.querySelector('[data-notification-read]').click();await tick();
  assert.equal(marked,1);assert.equal(doc.querySelectorAll('[data-notification-tasks] article').length,150);
  doc.querySelector('[data-notification-tab=history]').click();await tick();const filter=doc.querySelector('[data-notification-filter=domain]');filter.value='attendance';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.equal(filters.domain,'attendance');assert.equal(doc.querySelector('[data-notification-panel=history]').hidden,false);
 } finally {globalThis.AbortController=oldAbort;globalThis.CustomEvent=oldCustom;dom.window.close();}
});

test('an active employee can open their own inbox without gaining approval permission',async()=>{
 const { canOpenRoute, hasPermission }=await import('../frontend/src/permission-policy.js');
 for(const role of ['finance','employee','instructor','activities_manager']) {
  const user={role,is_active:true,permissions:{}};
  assert.equal(canOpenRoute(user,'edit-requests'),true);
  assert.equal(hasPermission(user,'can_review_requests'),false);
 }
 assert.equal(canOpenRoute({role:'employee',is_active:false},'edit-requests'),false);
});
