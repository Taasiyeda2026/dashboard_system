import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const BIND_FORM_FILE = new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const EDIT_REQUESTS_FILE = new URL('../frontend/src/screens/edit-requests.js', import.meta.url);
const EXCEPTIONS_FILE = new URL('../frontend/src/screens/exceptions.js', import.meta.url);

test('edit request submission keeps persistent pending status with request id', async () => {
  const source = await readFile(BIND_FORM_FILE, 'utf8');
  assert.match(source, /הבקשה נשלחה לאישור\. סטטוס: ממתין לאישור/);
  assert.match(source, /lastEditRequestId/);
  assert.match(source, /requestResult\?\.request_id/);
});

test('admin edit request badge and review permission include can_review_requests', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  assert.match(apiSource, /canReviewEditRequestsUser/);
  assert.match(apiSource, /permissionFlagYes\(user\?\.can_review_requests\)/);
  assert.match(apiSource, /\.in\('status', openStatuses\)/);
  assert.match(mainSource, /ds-nav-count-badge--edit-requests/);
  assert.match(mainSource, /app:edit-requests-updated/);
});

test('review approval applies requested values to activities and refreshes requests', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const screenSource = await readFile(EDIT_REQUESTS_FILE, 'utf8');
  assert.match(apiSource, /\.from\('activities'\)\s*\.update\(sanitizedRequestedValues\)/);
  assert.match(apiSource, /edit_request_already_reviewed/);
  assert.match(apiSource, /activity_not_found_or_forbidden/);
  assert.match(screenSource, /הבקשה אושרה והשינוי נשמר בפעילויות/);
  assert.match(screenSource, /app:edit-requests-updated/);
});

test('exceptions save flow explains resolved exception removal and offers activities navigation', async () => {
  const source = await readFile(EXCEPTIONS_FILE, 'utf8');
  assert.match(source, /הפעילות נשמרה בהצלחה\. החריגה תוקנה ולכן הפעילות הוסרה ממסך החריגות/);
  assert.match(source, /data-exception-go-activities/);
  assert.match(source, /route: 'activities'/);
});


test('approval header distinguishes approvals awaiting my action from approvals I sent',async()=>{
 const navSource=await readFile(new URL('../frontend/src/screens/shared/act-nav-grid.js',import.meta.url),'utf8');
 const code=navSource.replace(/^import .*?;\\s*$/gm,'').replace(/^export /gm,'');
 const {headerNavGridHtml}=runInNewContext(code+'\n({headerNavGridHtml})',{escapeHtml:v=>String(v)});
 const html=headerNavGridHtml({routes:['activities','edit-requests'],route:'edit-requests'},
   {editRequests:5,editRequestsIncoming:3,editRequestsSent:2});
 assert.match(html,/title="ממתינות לטיפולי"/);
 assert.match(html,/title="שלחתי – ממתינות לתשובה"/);
 assert.match(html,/ds-nav-count-badge--edit-requests-sent[^>]+>2<\/span>/);
 assert.match(html,/ds-nav-count-badge--edit-requests[^>]+>3<\/span>/);
 const empty=headerNavGridHtml({routes:['edit-requests'],route:'edit-requests'},
   {editRequests:0,editRequestsIncoming:0,editRequestsSent:0});
 assert.doesNotMatch(empty,/ds-nav-count-badge/);
});
test('approval buckets keep requests I submitted, including approved and rejected statuses',async()=>{
 const source=await readFile(EDIT_REQUESTS_FILE,'utf8');
 const start=source.indexOf('const OPEN_STATUSES = ');
 const end=source.indexOf('export const editRequestsScreen = ',start);
 assert.ok(start>0 && end>start);
 const code=source.slice(start,end).replace('export function ','function ');
 const {approvalViewBuckets}=runInNewContext(code+'\n({approvalViewBuckets})',{
   COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE:'course_assignment_exception',
   COURSE_MEETING_SUBSTITUTE_REQUEST_TYPE:'course_meeting_substitution'
 });
 const mk=(id,owner,status,type='edit_activity')=>({
   request_id:id,requested_by_user_id:owner,requested_at:'2026-10-21',status,
   request_type:type,fields:type==='edit_activity'?[{field_name:'notes',new_value:'test'}]:[],
   can_approve:true
 });
 const result=approvalViewBuckets({currentUserId:'admin1',canReview:true,groups:[
   mk('one','other','pending'),mk('two','admin1','pending'),mk('three','admin1','approved'),
   mk('four','admin1','rejected'),mk('five','admin1','conflict'),
   mk('six','other','approved')
 ]});
 assert.equal(result.incoming.length,1);
 assert.equal(result.ownOpen.length,1);
 assert.equal(result.ownResolved.length,3);
 assert.deepEqual(Array.from(result.ownResolved,x=>x.status).sort(),['approved','conflict','rejected']);
 const ownOnly=approvalViewBuckets({currentUserId:'sender',canReview:false,groups:[mk('other','other','pending'),mk('my','sender','pending')]});
 assert.equal(ownOnly.incoming.length,0);
 assert.equal(ownOnly.ownOpen.length,1);
});
test('badge count deduplicates specialized requests and includes own pending submissions',async()=>{
 const source=await readFile(API_FILE,'utf8');
 const start=source.indexOf('  editRequestsBadgeCounts: async () => {');
 const end=source.indexOf('  editRequestsOpenCount: async () => {',start);
 assert.ok(start>=0 && end>start);
 const code=source.slice(start,end).trim().replace(/,\\s*$/,'');
 const rows=[
   {request_id:'in-1',requested_by_user_id:'other',status:'pending',request_type:'edit_activity'},
   {request_id:'out-1',requested_by_user_id:'u1',status:'pending',request_type:'edit_activity'},
   {request_id:'schedule-1',requested_by_user_id:'other',status:'pending',request_type:'course_assignment_exception'}
 ];
 const query={select(){return this},in(){return Promise.resolve({data:rows,error:null})}};
 const supabase={
   from:()=>query,
   rpc:async name=>({error:null,data:name==='course_assignment_manager_approval_requests'
     ? [rows[2],{request_id:'schedule-2',requested_by_user_id:'u1',status:'pending',request_type:'course_assignment_exception'}]
     : [{request_id:'sub-1',requested_by_user_id:'other',status:'pending',request_type:'course_meeting_substitution'}]})
 };
 const object=runInNewContext('({'+code+'})',{supabase,state:{user:{user_id:'u1',role:'admin'}},
   canReviewEditRequestsUser:()=>true});
 const counts=await object.editRequestsBadgeCounts();
 assert.deepEqual(JSON.parse(JSON.stringify(counts)),{incoming:3,sent:2,total:5});
});
test('approval indicator refreshes on request changes and when another user completes review',async()=>{
 const source=await readFile(MAIN_FILE,'utf8');
 assert.match(source,/editRequestsBadgeCounts\(\)/);
 assert.match(source,/app:edit-requests-updated/);
 assert.match(source,/visibilitychange/);
 assert.match(source,/setInterval\(\(\) =>/);
 assert.match(source,/openEditRequestsSentCount/);
 assert.match(source,/openEditRequestsIncomingCount/);
 assert.match(source,/ds-nav-count-badge--edit-requests-sent/);
 const screen=await readFile(EDIT_REQUESTS_FILE,'utf8');
 assert.match(screen,/data-er-sent-pending/);
 assert.match(screen,/data-er-sent-resolved/);
 assert.match(screen,/readOnly:true/);
});
