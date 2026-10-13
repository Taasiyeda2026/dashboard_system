import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const foundation=load('supabase/migrations/20261013210000_feedback_all_audience_scheduler_foundation.sql');
const flow=load('supabase/migrations/20261013211500_feedback_all_audience_delivery_flow.sql');
const admin=load('supabase/migrations/20261013212500_feedback_auto_pre_schedule_view.sql');
const fix=load('supabase/migrations/20261013212800_feedback_pre_schedule_assignment_scope.sql');
const cron=load('supabase/migrations/20261013214000_feedback_auto_activate_cron.sql');
const edge=load('supabase/functions/feedback-auto-delivery/index.ts');
const api=load('frontend/src/impact-feedback/feedback-api.js');
const page=load('frontend/src/screens/impact-feedback.js');

test('student pre/post use past valid meetings and actual instructor attendance evidence',()=>{
 assert.match(foundation, /student:.*?\|\|a\.row_id/);
 assert.match(foundation, /cross join lateral \(values \('pre'::text,a\.first_meeting/);
 assert.match(foundation, /'post'::text,a\.third_last_meeting/);
 assert.match(foundation, /a\.active_count >= a\.expected_sessions/);
 assert.match(foundation, /course_meeting_cancellations/);
 assert.match(foundation, /attendance_records ar/);
 assert.match(foundation, /ar\.report_date=v\.dt/);
 assert.match(foundation, /ar\.total_hours>0/);
 assert.match(foundation, /a\.start_date < date '2027-01-31'/);
 assert.match(foundation, /private\.feedback_is_course_activity/);
});
test('instructor finals use separate last course end in the relevant semester',()=>{
 assert.match(foundation, /'final'::text,a\.start_date < date '2027-01-31'/);
 assert.match(foundation, /'final_b'::text,a\.start_date >= date '2027-01-31'/);
 assert.match(foundation, /max\(a\.end_date\)\+1/);
 assert.match(foundation, /'school_2027'/);
 assert.match(fix, /select 1 from shaped a/);
});
test('admin sets PRE delivery date within the application (never ChatGPT)',()=>{
 assert.match(foundation, /feedback_auto_schedule_instructor_pre/);
 assert.match(foundation, /private\.feedback_is_admin/);
 assert.match(foundation, /feedback_already_shared/);
 assert.match(admin, /feedback_auto_admin_pre_schedules/);
 assert.match(admin, /feedback_auto_cancel_instructor_pre/);
 assert.match(page, /scheduleInstructorPreFeedback/);
 assert.match(page, /name="sendAt"/);
 assert.match(page, /תזמון ושליחה אוטומטית/);
 assert.match(page, /מתוזמן:/);
 assert.match(api, /feedback_auto_schedule_instructor_pre/);
});
test('messages wait for approved Israel local business windows',()=>{
 assert.match(cron, /feedback-auto-daily-prepare/);
 assert.match(cron, /feedback-auto-daily-dispatch/);
 assert.match(cron, /feedback-auto-manual-pre/);
 assert.match(cron, /Asia\/Jerusalem/);
 assert.match(cron, /between 15 and 44/);
 assert.match(flow, /time '09:15'/);
 assert.match(flow, /time '05:30'/);
 assert.match(edge, /local!==['"]05:30['"]/);
 assert.match(edge, /local<'09:15'/);
 assert.doesNotMatch(cron, /cron\.unschedule\('feedback-staff-/);
});
test('delivery guard revalidates recipient, CC, assignment, activity and campaign immediately before Graph',()=>{
 assert.match(flow, /feedback_auto_begin/);
 assert.match(flow, /feedback_auto_candidates\(p_now\)/);
 assert.match(flow, /coalesce\(c\.recipient_email,''\)<>coalesce\(d\.recipient_email,''\)/);
 assert.match(flow, /coalesce\(c\.cc_email,''\)<>coalesce\(d\.cc_email,''\)/);
 assert.match(flow, /c\.activity_row_id<>d\.activity_row_id/);
 assert.match(flow, /eligibility_changed_before_send/);
 assert.match(flow, /feedback_auto_delivery\.status in \('pending','needs_attention','invalidated'\)/);
 assert.match(flow, /a\.graph_started_at is null/);
 assert.match(flow, /last_shared_at is not null or r\.completed_at is not null/);
});
test('private Graph transport sends personal instructor links and student links with inline QR and manager CC',()=>{
 assert.match(edge, /SENDER='office@think.org.il'/);
 assert.match(edge, /GRAPH_TENANT/);
 assert.match(edge, /Mail\.Send/);
 assert.match(edge, /QRCode\.toDataURL/);
 assert.match(edge, /cid:student-feedback-qr/);
 assert.match(edge, /ccRecipients/);
 assert.match(edge, /item\.audience==='student'/);
 assert.match(edge, /status=r\.status===202\?'accepted'/);
 assert.match(edge, /'graph_response_uncertain'/);
 assert.match(edge, /outcomes\[status as 'accepted'/);
 assert.doesNotMatch(edge, /Deno\.env\.get\('MS_CLIENT_SECRET'\)/);
});
test('outbox stores one durable key and does not retry unknown Graph responses',()=>{
 assert.match(foundation, /delivery_key text not null unique/);
 assert.match(foundation, /graph_started_at timestamptz/);
 assert.match(flow, /where a\.status='pending'/);
 assert.match(flow, /status='sending'/);
 assert.match(flow, /p_status not in \('accepted','failed','unknown'\)/);
 assert.match(flow, /status='invalidated'/);
 assert.match(cron, /feedback_auto_control/);
 assert.match(foundation, /enable row level security/);
 assert.match(foundation, /revoke all on public\.feedback_auto_delivery from public,anon,authenticated/);
});
