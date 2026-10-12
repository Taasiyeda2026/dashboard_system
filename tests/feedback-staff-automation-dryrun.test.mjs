import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { israelClock,previewEligibility,revalidateSend,summarizeCandidatePreview } from '../supabase/functions/feedback-staff-automation/planner.mjs';
const sql = readFileSync(new URL('../supabase/migrations/20261012224500_feedback_staff_automation_dry_run_foundation.sql',import.meta.url),'utf8');
const edge = readFileSync(new URL('../supabase/functions/feedback-staff-automation/index.ts',import.meta.url),'utf8');

const row = (changes={}) => ({group_key:'group-A',stage:'pre',representative_row_id:'activity-1',
 contact_id:42,contact_email:'contact@school.test',eligibility_at:'2026-10-13T08:00:00Z',
 member_row_ids:['activity-1','activity-2'],status:'eligible',...changes});

test('simulation will not retro-send and has one candidate per group/stage',()=>{
 const pre = row();
 const final = row({stage:'final',eligibility_at:'2026-10-14T08:00:00Z'});
 const rows=[pre,final];
 assert.deepEqual(previewEligibility(rows).map(x=>x.status),['not_activated','not_activated']);
 assert.deepEqual(previewEligibility(rows,{activationAt:'2026-10-13T09:00:00Z'}).map(x=>x.status),['before_activation','would_queue']);
 assert.deepEqual(previewEligibility(rows,{activationAt:'2026-10-13T00:00:00Z',queuedKeys:new Set(['group-A:pre'])}).map(x=>x.status),['already_queued','would_queue']);
 assert.deepEqual(summarizeCandidatePreview(rows,{activationAt:'2026-10-13T00:00:00Z'}),{'pre:would_queue':1,'final:would_queue':1});
});

test('missing contact/email is skipped independently and a past-due unsent stage stays queueable the next day',()=>{
 const activationAt='2026-10-12T00:00:00Z';
 const pastDue='2026-10-13T09:00:00Z';
 const rows=[
   row({group_key:'ready',status:'eligible',eligibility_at:pastDue}),
   row({group_key:'needs-contact',status:'missing_selected_contact',eligibility_at:pastDue}),
   row({group_key:'needs-email',status:'missing_contact_email',eligibility_at:pastDue})
 ];
 assert.deepEqual(previewEligibility(rows,{activationAt}).map(x=>x.status),
   ['would_queue','missing_selected_contact','missing_contact_email']);
 const corrected=[
   rows[0],
   {...rows[1],status:'eligible',contact_id:4,contact_email:'fixed-contact@school.test'},
   {...rows[2],status:'eligible',contact_email:'fixed-email@school.test'}
 ];
 const alreadyQueued=new Set(['ready:pre']);
 assert.deepEqual(previewEligibility(corrected,{activationAt,queuedKeys:alreadyQueued}).map(x=>x.status),
   ['already_queued','would_queue','would_queue']);
 const earlierActivation='2026-10-14T00:00:00Z';
 assert.deepEqual(previewEligibility(corrected,{activationAt:earlierActivation}).map(x=>x.status),
   ['before_activation','before_activation','before_activation']);
 const migration=readFileSync(new URL('../supabase/migrations/20261012230000_feedback_staff_delivery_disabled.sql',import.meta.url),'utf8');
 assert.match(sql,/when e\.due_at > p_now then 'not_due'/);
 assert.match(sql,/else 'eligible'/);
 assert.match(migration,/where status='eligible' and eligibility_at>=ctl\.activation_at/);
 assert.doesNotMatch(migration,/where status='eligible' and eligibility_at::date\s*=\s*p_now::date/);
});

test('08:00 revalidation rejects stale contact, date, representative and duplicates',()=>{
 const prepared=row();
 assert.equal(revalidateSend(prepared,row()),'ready');
 assert.equal(revalidateSend(prepared,row({contact_id:99})),'contact_changed');
 assert.equal(revalidateSend(prepared,row({contact_email:'new@school.test'})),'email_changed');
 assert.equal(revalidateSend(prepared,row({representative_row_id:'activity-2'})),'representative_changed');
 assert.equal(revalidateSend(prepared,row({eligibility_at:'2026-10-14T08:00:00Z'})),'meeting_schedule_changed');
 assert.equal(revalidateSend(prepared,row({status:'not_due'})),'no_longer_eligible');
 assert.equal(revalidateSend(prepared,row(),{acceptedKeys:new Set(['group-A:pre'])}),'already_sent');
});

test('Israel hours work both in summer and winter timezone',()=>{
 assert.deepEqual(israelClock(new Date('2026-07-10T02:00:00Z')),{day:'2026-07-10',hour:5});
 assert.deepEqual(israelClock(new Date('2026-12-10T03:00:00Z')),{day:'2026-12-10',hour:5});
 assert.deepEqual(israelClock(new Date('2026-07-10T05:00:00Z')),{day:'2026-07-10',hour:8});
 assert.deepEqual(israelClock(new Date('2026-12-10T06:00:00Z')),{day:'2026-12-10',hour:8});
});

test('server preview is service-only, derives recipient from selected contact and uses official dates',()=>{
 assert.match(sql,/a\.activity_season = 'school_2027'/);
 assert.match(sql,/a\.start_date between date '2026-09-01' and date '2027-06-30'/);
 assert.match(sql,/private\.feedback_activity_program\(to_jsonb\(a\)\)/);
 assert.match(sql,/private\.feedback_is_course_activity\(to_jsonb\(a\)\)/);
 assert.match(sql,/a\.school_contact_id/);
 assert.match(sql,/nullif\(btrim\(cs\.email\),''\)/);
 assert.match(sql,/generate_series\(1,35\)/);
 assert.match(sql,/course_meeting_cancellations/);
 assert.match(sql,/scheduling_effective_end_time/);
 assert.match(sql,/Asia\/Jerusalem/);
 assert.match(sql,/unique\(group_key,stage\)/);
 assert.match(sql,/grant execute on function public\.feedback_staff_auto_candidates\(timestamptz\) to service_role/);
 assert.doesNotMatch(sql,/cron\.schedule\(/);
 assert.doesNotMatch(sql,/net\.http_post\(/);
});

test('preview remains read-only and delivery is separately disabled by default',()=>{
 assert.match(edge,/const action = body\?\.action \|\| 'preview'/);
 assert.match(edge,/FEEDBACK_STAFF_DRY_RUN_SECRET/);
 assert.match(edge,/feedback_staff_auto_candidates/);
 assert.match(edge,/mail_sent:0,outbox_written:0/);
 assert.match(edge,/FEEDBACK_STAFF_DELIVERY_ENABLED'\) === 'true'/);
 const preview = edge.slice(edge.indexOf('const response = await fetch(`${url}/rest/v1/rpc/feedback_staff_auto_candidates`'));
 assert.doesNotMatch(preview,/sendMail|feedback_staff_auto_prepare|feedback_staff_auto_claim/);
});
