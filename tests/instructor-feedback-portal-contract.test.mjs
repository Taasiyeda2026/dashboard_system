import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
const nav=read('../frontend/src/main.js');
const screen=read('../frontend/src/screens/instructor-portal/feedback.js');
const css=read('../frontend/src/screens/instructor-portal/feedback.css');
const publicForm=read('../frontend/src/impact-feedback/feedback-public.js');
const sql=read('../supabase/migrations/20261013080000_instructor_feedback_portal_and_drafts.sql');

test('instructor feedback is a real route in desktop and mobile navigation',()=>{
  assert.match(nav,/'instructor-feedback': \(\) => import\('\.\/screens\/instructor-portal\/feedback\.js'\)/);
  assert.match(nav,/\{ route: 'instructor-feedback', label: 'משובים' \}/);
  assert.match(nav,/\{ route: 'instructor-feedback', short: 'משובים'/);
  assert.match(nav,/'instructor-feedback': 0/);
  assert.match(nav,/'instructor-feedback', \/\/ never/); // memory-only cache
  assert.match(screen,/supabase\.rpc\('feedback_instructor_portal_items'/);
  assert.match(screen,/waitForSupabaseAuthSession/);
  assert.match(screen,/data-feedback-tab="students"/);
  assert.match(screen,/data-feedback-tab="mine"/);
  assert.match(screen,/data-feedback-copy/);
  assert.match(screen,/data-feedback-qr/);
  assert.match(screen,/openQrProjection/);
  assert.match(css,/@media\(max-width:620px\)/);
});

test('server resolves each instructor only through auth.uid and discloses no student answers',()=>{
  assert.match(sql,/u\.auth_user_id=auth\.uid\(\)/);
  assert.match(sql,/u\.role='instructor' and u\.is_active is true/);
  assert.match(sql,/a\.emp_id=v_emp or a\.emp_id_2=v_emp/);
  assert.match(sql,/rc\.instructor_emp_id=v_emp/);
  assert.match(sql,/c\.opens_at<=now\(\)/);
  assert.match(sql,/c\.status='active'/);
  assert.match(sql,/revoke all on function public\.feedback_instructor_portal_items\(text\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.feedback_instructor_portal_items\(text\) to authenticated/);
  assert.doesNotMatch(sql,/feedback_answers|answer_facts|student_response/);
  assert.doesNotMatch(sql,/cron\.schedule|net\.http_post/);
});

test('instructor answers and extended review autosave on Supabase, not merely in sessionStorage',()=>{
  assert.match(publicForm,/feedback_public_instructor_draft/);
  assert.match(publicForm,/p_write: ?true/);
  assert.match(publicForm,/await writePending\(\)/);
  assert.match(sql,/feedback_instructor_drafts/);
  assert.match(sql,/private\.feedback_token_target\(p_token,p_write\)/);
  assert.match(sql,/v_campaign\.audience<>'instructor'/);
  assert.match(sql,/pg_column_size\(p_answers\)>65536/);
  assert.match(sql,/feedback_instructor_draft_cleanup_on_submit/);
  assert.match(sql,/revoke all on public\.feedback_instructor_drafts from public,anon,authenticated/);
});
