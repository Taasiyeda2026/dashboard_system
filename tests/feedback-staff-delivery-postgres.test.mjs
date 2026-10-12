import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { deliverClaim } from '../supabase/functions/feedback-staff-automation/delivery.mjs';
import { filterGroups, hasCourseStartDate, studentFeedbackPeriodForGroup,
  sortEducationalStaffFeedbackGroups, slotCampaign, groupHasFeedback } from '../frontend/src/impact-feedback/feedback-domain.js';

// This suite creates its own disposable database, never accepts a remote URL.
const url=process.env.STAFF_DELIVERY_TEST_DATABASE_URL;
const ADMIN='11111111-1111-1111-1111-111111111111';
const morning='2026-10-14T02:00:00Z'; // 05 Israel
const dispatch='2026-10-14T05:00:00Z';
const file=(path)=>readFile(new URL(path,import.meta.url),'utf8');

function visibleStaff(groups,half) {
  const sorted=sortEducationalStaffFeedbackGroups(filterGroups(groups.filter(hasCourseStartDate)
    .filter(g=>studentFeedbackPeriodForGroup(g)===half),{}));
  const unique=new Map();
  const slots=[{audience:'educational_staff',stage:'pre'},{audience:'educational_staff',stage:'final'}];
  for(const g of sorted) {
    const contact=String(g.contact_name||'').trim().replace(/\\s+/g,' ').toLocaleLowerCase('he');
    const school=String(g.school||'').trim().replace(/\\s+/g,' ').toLocaleLowerCase('he');
    const course=String(g.program_key||'').trim();
    const key=contact&&school&&course?JSON.stringify([course,contact,school]):JSON.stringify(['unidentified',g.row_id]);
    const previous=unique.get(key);const coverage=x=>slots.filter(s=>slotCampaign(x,s)).length;
    if(!previous||coverage(g)>coverage(previous)||(coverage(g)===coverage(previous)&&Number(groupHasFeedback(g))>Number(groupHasFeedback(previous)))||
      (coverage(g)===coverage(previous)&&Number(groupHasFeedback(g))===Number(groupHasFeedback(previous))&&String(g.end_date||'')>String(previous.end_date||'')))unique.set(key,g);
  }
  return [...unique.values()].map(g=>g.row_id).sort();
}

test('staff delivery PostgreSQL end-to-end, fake Graph only',async(t)=>{
  assert.ok(url,'STAFF_DELIVERY_TEST_DATABASE_URL is required; no silent DB skip');
  const parsed=new URL(url);
  assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname),'disposable local Postgres only');
  const client=new pg.Client({connectionString:url});await client.connect();
  const q=async(sql,params=[])=>(await client.query(sql,params)).rows;
  const rpc=async(name,args={})=>{
    const entries=Object.entries({...args,...(['feedback_staff_auto_claim','feedback_staff_auto_begin_send'].includes(name)?{p_now:dispatch}:{})});
    const bindings=entries.map(([key],i)=>`${key}:=$${i+1}`).join(',');
    return (await q(`select public.${name}(${bindings}) result`,entries.map(([,v])=>v)))[0].result;
  };
  const reset=async()=>{
    await q('reset role');await q("truncate feedback_staff_auto_attempts,feedback_staff_auto_outbox,feedback_responses,feedback_recipients,feedback_campaigns,course_meeting_cancellations,activities cascade");
    await q("update feedback_staff_auto_control set enabled=true,activation_at='2026-10-01T00:00Z'");
  };
  const activity=async(id,extra={})=>{
    const data={row_id:id,activity_season:'school_2027',activity_type:'course',activity_family:'program',
      activity_name:'פורצות דרך וצועדות קדימה',school:`School ${id}`,grade:'ח',start_date:'2026-10-12',end_date:'2026-10-13',
      date_1:'2026-10-12',date_2:'2026-10-13',sessions:'2',end_time:'12:00',school_contact_id:7,...extra};
    const entries=Object.entries(data);
    await q(`insert into activities(${entries.map(([k])=>k).join(',')}) values(${entries.map((_,i)=>`$${i+1}`).join(',')})`,entries.map(([,v])=>v));
  };
  try {
    await q('drop schema if exists public cascade;drop schema if exists private cascade;drop schema if exists auth cascade;create schema public');
    await q(await file('./fixtures/impact-feedback-stub-schema.sql'));
    // Existing module fixture migration chain, reused instead of another feedback implementation.
    const original=await file('./impact-feedback-postgres.test.mjs');
    const paths=[...original.match(/const MIGRATIONS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
    for(const path of paths)await q(await file(path));
    for(const name of ['20261009162000_feedback_groups_activity_manager_filter','20261010193000_feedback_admin_groups_perf',
      '20261010141000_feedback_bilingual_introductions',
      '20261011210500_feedback_admin_israa_readonly_access','20261012192500_feedback_staff_pre_and_final',
      '20261012193000_feedback_staff_date_validation_fix','20261012194000_feedback_staff_date_gate_portable_regex'])
      await q(await file(`../supabase/migrations/${name}.sql`));
    await q('alter table activities alter column start_date type date using nullif(start_date,\'\')::date,alter column end_date type date using nullif(end_date,\'\')::date');
    for(let n=1;n<=35;n++)await q(`alter table activities add column date_${n} date`);
    await q(`alter table activities add column sessions text,add column end_time time;
      create table course_meeting_cancellations(activity_id text,meeting_date date);
      create function public.scheduling_effective_end_time(text,date,time) returns time language sql as $$select $3$$;`);
    await q(await file('../supabase/migrations/20261012224500_feedback_staff_automation_dry_run_foundation.sql'));
    await q(await file('../supabase/migrations/20261012230000_feedback_staff_delivery_disabled.sql'));
    await q("insert into users(user_id,auth_user_id,role,is_active) values('admin',$1,'admin',true),('other','22222222-2222-2222-2222-222222222222','operation_manager',true)",[ADMIN]);
    await q("insert into contacts_schools(id,contact_name,email) values(7,'רונית','selected@school.test'),(8,'דנה','new@school.test'),(9,'ללא מייל',null)");

    await t.test('migration is OFF, has no Cron jobs and has no side effects',async()=>{
      assert.deepEqual(await rpc('feedback_staff_auto_prepare',{p_now:morning}),{disabled:true,prepared:0});
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{disabled:true});
      assert.equal((await q('select count(*)::int n from feedback_staff_auto_outbox'))[0].n,0);
      assert.equal((await q("select to_regclass('cron.job') name"))[0].name,null);
    });

    await t.test('exact staff list in BOTH halves, cancellations, official dates and full final schedule',async()=>{
      await reset();await activity('A',{school:'Shared'});await activity('B',{school:'Shared',end_date:'2026-10-14'});
      await activity('SECOND',{start_date:'2027-01-01',end_date:'2027-01-02',date_1:'2027-01-01',date_2:'2027-01-02'});
      await activity('OTHER_YEAR',{activity_season:'regular'});await activity('NO_START',{start_date:null});
      await activity('WORKSHOP',{activity_type:'workshop',activity_family:'workshop',activity_name:'סדנה'});
      await activity('EXCLUDED');await q("insert into feedback_program_mappings(scope,activity_row_id,excluded) values('activity','EXCLUDED',true)");
      await q("select set_config('test.uid',$1,false)",[ADMIN]);
      const groups=await q("select * from feedback_admin_groups('school_2027')");
      const candidates=await q("select * from feedback_staff_auto_candidates('2027-02-01')");
      for(const half of ['first','second'])assert.deepEqual(candidates.filter(c=>c.stage==='pre'&&c.cohort===half).map(c=>c.representative_row_id).sort(),visibleStaff(groups,half));
      assert.equal(candidates.filter(c=>c.stage==='pre'&&c.cohort==='first').length,1);
      await reset();await activity('INCOMPLETE',{sessions:'3'});
      let rows=await q('select * from feedback_staff_auto_candidates($1)',[morning]);
      assert.equal(rows.find(c=>c.stage==='pre').status,'eligible');
      assert.equal(rows.find(c=>c.stage==='final').status,'unscheduled');
      await q("alter table activities add column if not exists draft_proposed_meetings jsonb");
      await q("update activities set draft_proposed_meetings='[{\"date\":\"2026-10-13\"}]'");
      assert.equal((await q('select * from feedback_staff_auto_candidates($1)',[morning])).find(c=>c.stage==='final').status,'unscheduled');
      await q("update activities set date_3='2026-10-14'");
      await q("insert into course_meeting_cancellations values('INCOMPLETE','2026-10-13')");
      rows=await q('select * from feedback_staff_auto_candidates($1)',[morning]);
      assert.equal(rows.find(c=>c.stage==='pre').status,'not_due');
      assert.equal(rows.find(c=>c.stage==='final').status,'not_due');
      rows=await q("select * from feedback_staff_auto_candidates('2026-10-14T09:01Z')");
      assert.ok(rows.every(c=>c.status==='eligible'));
    });

    await t.test('strict selected contact, no fallback; UI exposes only required statuses',async()=>{
      await reset();await activity('MISSING',{school_contact_id:null,contact_email:'fallback@school.test'});
      await activity('NO_EMAIL',{school_contact_id:9,contact_email:'fallback@school.test'});
      const rows=await q('select * from feedback_staff_auto_candidates($1)',[morning]);
      assert.ok(rows.every(c=>['missing_selected_contact','missing_contact_email'].includes(c.status)));
      await rpc('feedback_staff_auto_prepare',{p_now:morning});
      assert.equal((await q('select count(*)::int n from feedback_staff_auto_outbox'))[0].n,0);
      await q("select set_config('test.uid',$1,false)",[ADMIN]);await q('set role authenticated');
      const states=await q('select * from feedback_staff_auto_status()');
      assert.ok(states.every(s=>s.status==='needs_attention'));
      assert.deepEqual(Object.keys(states[0]).sort(),['activity_row_id','reason','stage','status']);
      await assert.rejects(q('select feedback_staff_auto_claim()'),/permission denied/);
      await q("select set_config('test.uid','22222222-2222-2222-2222-222222222222',false)");
      await assert.rejects(q('select * from feedback_staff_auto_status()'),/feedback_forbidden/);await q('reset role');
      await q('set role anon');await assert.rejects(q('select * from feedback_staff_auto_status()'),/permission denied/);await q('reset role');
    });

    await t.test('missing contact/email never blocks other groups; day-after correction catches up exactly once',async()=>{
      await reset();
      // All 3 groups have already passed the second and last official meeting.
      // Missing metadata is NEVER treated as a sendable recipient.
      await activity('READY');
      await activity('LATE_CONTACT',{school_contact_id:null,contact_email:'old-fallback@school.test'});
      await activity('LATE_EMAIL',{school_contact_id:9,contact_email:'old-fallback@school.test'});
      const firstCandidates=await q('select * from feedback_staff_auto_candidates($1)',[morning]);
      for(const stage of ['pre','final']) {
        assert.equal(firstCandidates.find(c=>c.representative_row_id==='READY'&&c.stage===stage).status,'eligible');
        assert.equal(firstCandidates.find(c=>c.representative_row_id==='LATE_CONTACT'&&c.stage===stage).status,'missing_selected_contact');
        assert.equal(firstCandidates.find(c=>c.representative_row_id==='LATE_EMAIL'&&c.stage===stage).status,'missing_contact_email');
      }
      assert.equal((await rpc('feedback_staff_auto_prepare',{p_now:morning})).prepared,2);
      const initial=await q('select group_key,stage,status from feedback_staff_auto_outbox');
      assert.equal(initial.length,2);
      let sent=0;
      const graphFake=async()=>{sent++;return new Response(null,{status:202,headers:{'request-id':'test-only'}});};
      for(let i=0;i<2;i++){
        const claim=await rpc('feedback_staff_auto_claim');
        assert.ok(claim.id);
        assert.equal(await deliverClaim(claim,{rpc,baseUrl:'https://example.test/',
          getAccessToken:async()=> 'test-only-token',send:graphFake}),'accepted');
      }
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      assert.equal(sent,2);

      // Fix only the missing source data AFTER the original date passed.
      // Both stages stay eligible because due_at <= now, NOT due_at = today.
      await q("update activities set school_contact_id=7 where row_id='LATE_CONTACT'");
      await q("update contacts_schools set email='recovered@school.test' where id=9");
      const nextMorning='2026-10-15T02:00:00Z';
      const nextDispatch='2026-10-15T05:00:00Z';
      const nextCandidates=await q('select * from feedback_staff_auto_candidates($1)',[nextMorning]);
      for(const id of ['LATE_CONTACT','LATE_EMAIL'])
        for(const stage of ['pre','final']) {
          const c=nextCandidates.find(c=>c.representative_row_id===id&&c.stage===stage);
          assert.equal(c.status,'eligible');
          assert.ok(new Date(c.eligibility_at)<new Date(nextMorning));
        }
      assert.equal((await rpc('feedback_staff_auto_prepare',{p_now:nextMorning})).prepared,4);
      const nextQueued=await q("select count(*)::int n from feedback_staff_auto_outbox where status='pending'");
      assert.equal(nextQueued[0].n,4);
      assert.equal((await q("select count(*)::int n from feedback_staff_auto_outbox where status='accepted'"))[0].n,2);
      // Date override affects only the fake test clock (never a production Cron).
      const nextRpc=async(name,args={})=>{
        const input={...args,...(['feedback_staff_auto_claim','feedback_staff_auto_begin_send'].includes(name)?{p_now:nextDispatch}:{})};
        const entries=Object.entries(input);
        const bindings=entries.map(([key],i)=>`${key}:=${i+1}`).join(',');
        return (await q(`select public.${name}(${bindings}) result`,entries.map(([,v])=>v)))[0].result;
      };
      for(let i=0;i<4;i++){
        const claim=await nextRpc('feedback_staff_auto_claim');
        assert.ok(claim.id);
        assert.ok(['selected@school.test','recovered@school.test'].includes(claim.recipient_email));
        assert.equal(await deliverClaim(claim,{rpc:nextRpc,baseUrl:'https://example.test/',
          getAccessToken:async()=> 'test-only-token',send:graphFake}),'accepted');
      }
      assert.deepEqual(await nextRpc('feedback_staff_auto_claim'),{});
      assert.equal(sent,6);
      assert.equal((await q("select count(*)::int n from feedback_staff_auto_outbox where status='accepted'"))[0].n,6);
      // Next day map sees the already-accepted historical stages and does not duplicate.
      assert.equal((await rpc('feedback_staff_auto_prepare',{p_now:'2026-10-16T02:00:00Z'})).prepared,0);
      assert.equal((await q('select count(*)::int n from feedback_staff_auto_outbox'))[0].n,6);
      await q("update contacts_schools set email=null where id=9");
    });

    await t.test('date/contact/email/representative changes from 05 to 08 cancel stale dispatch',async()=>{
      for(const change of ["date_2='2026-10-20'","school_contact_id=8","end_time='13:00'"]) {
        await reset();await activity('A');await rpc('feedback_staff_auto_prepare',{p_now:morning});
        await q(`update activities set ${change} where row_id='A'`);
        assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
        assert.ok((await q('select status from feedback_staff_auto_outbox')).every(o=>o.status==='cancelled'));
      }
      await reset();await activity('A');await activity('B',{school:'School A',end_date:'2026-10-12'});
      await rpc('feedback_staff_auto_prepare',{p_now:morning});await q("update activities set end_date='2026-10-15' where row_id='B'");
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      await reset();await activity('A');await rpc('feedback_staff_auto_prepare',{p_now:morning});
      await q("update contacts_schools set email='changed@school.test' where id=7");
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      await q("update contacts_schools set email='selected@school.test' where id=7");
    });

    await t.test('claim uses personal templates; fake Graph 202 is permanent; consolidated renamed groups do not resend',async()=>{
      await reset();await activity('A');await activity('B',{school:'School A',end_date:'2026-10-12'});
      await rpc('feedback_staff_auto_prepare',{p_now:morning});
      assert.equal((await q('select count(*)::int n from feedback_staff_auto_outbox'))[0].n,2);
      let sent=0;
      for(let i=0;i<2;i++) {
        const claim=await rpc('feedback_staff_auto_claim');assert.ok(claim.id);
        const recipient=(await q('select * from feedback_recipients where token=$1',[claim.token]))[0];
        assert.equal(String(recipient.contact_id),'7');assert.equal(recipient.email,'selected@school.test');
        const form=(await q('select feedback_public_get($1) form',[claim.token]))[0].form;
        assert.equal(form.audience,'educational_staff');assert.equal(form.stage,claim.stage);
        assert.equal(await deliverClaim(claim,{rpc,baseUrl:'https://example.test/',getAccessToken:async()=> 'fake',send:async(mail)=>{
          assert.equal(mail.toRecipients[0].emailAddress.address,recipient.email);sent++;return new Response(null,{status:202});}}),'accepted');
      }
      assert.equal(sent,2);assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      await q("update contacts_schools set contact_name='Changed identity' where id=7");
      await rpc('feedback_staff_auto_prepare',{p_now:morning});assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      assert.equal((await q("select count(*)::int n from feedback_staff_auto_outbox where status='accepted'"))[0].n,2);
      await q("update contacts_schools set contact_name='רונית' where id=7");
    });

    await t.test('unknown and lost acknowledgement never retry; abandoned started claims become unknown',async()=>{
      await reset();await activity('A');await rpc('feedback_staff_auto_prepare',{p_now:morning});
      const claim=await rpc('feedback_staff_auto_claim');
      assert.equal(await deliverClaim(claim,{rpc,baseUrl:'https://example.test/',getAccessToken:async()=> 'fake',send:async()=>{throw Error('lost');}}),'unknown');
      await rpc('feedback_staff_auto_prepare',{p_now:morning});
      const next=await rpc('feedback_staff_auto_claim');assert.notEqual(next.id,claim.id);
      assert.equal((await rpc('feedback_staff_auto_begin_send',{p_id:next.id,p_claim:next.claim_token,p_token:next.token})).ready,true);
      await q("update feedback_staff_auto_outbox set claimed_at=claimed_at-interval '20 minutes' where id=$1",[next.id]);
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      assert.ok((await q('select status from feedback_staff_auto_outbox')).every(o=>o.status==='unknown'));
      assert.equal((await q('select count(*)::int n from feedback_staff_auto_attempts'))[0].n,2);
    });

    await t.test('two real concurrent workers cannot claim the same consolidated stage',async()=>{
      await reset();await activity('A');await rpc('feedback_staff_auto_prepare',{p_now:morning});
      const other=new pg.Client({connectionString:url});await other.connect();
      try {
        const [one,two]=await Promise.all([rpc('feedback_staff_auto_claim'),other.query('select feedback_staff_auto_claim($1) result',[dispatch]).then(r=>r.rows[0].result)]);
        assert.ok(one.id&&two.id);assert.notEqual(one.id,two.id);assert.notEqual(one.stage,two.stage);
        assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
        assert.equal((await q('select count(*)::int n from feedback_staff_auto_attempts'))[0].n,2);
      } finally {await other.end();}
    });

    await t.test('stale manual personal link rotates only unanswered tokens; source change immediately before Graph blocks',async()=>{
      await reset();await activity('A');
      await q("select set_config('test.uid',$1,false)",[ADMIN]);
      const old=(await q("select feedback_admin_open_campaign('A','educational_staff','pre') c"))[0].c;
      await q('update feedback_recipients set contact_id=8 where campaign_id=$1',[old.id]);
      await rpc('feedback_staff_auto_prepare',{p_now:morning});
      const first=await rpc('feedback_staff_auto_claim');
      const second=await rpc('feedback_staff_auto_claim');
      const pre=[first,second].find(c=>c.stage==='pre');
      assert.notEqual(pre.token,old.recipient.token);
      assert.equal((await q('select feedback_public_get($1) form',[old.recipient.token]))[0].form.state,'invalid');
      assert.equal((await q('select contact_id::int from feedback_recipients where token=$1',[pre.token]))[0].contact_id,7);
      await q("update activities set school_contact_id=8 where row_id='A'");
      let sent=0;
      assert.equal(await deliverClaim(pre,{rpc,baseUrl:'https://example.test/',getAccessToken:async()=> 'fake',send:async()=>{sent++;}}),'blocked');
      assert.equal(sent,0);
    });

    await t.test('definitive Graph failure stays failed through repeated preparation, claims and result replay',async()=>{
      await reset();await activity('A');await rpc('feedback_staff_auto_prepare',{p_now:morning});
      const claim=await rpc('feedback_staff_auto_claim');
      assert.equal(await deliverClaim(claim,{rpc,baseUrl:'https://example.test/',getAccessToken:async()=> 'fake',send:async()=>new Response(null,{status:429})}),'failed');
      assert.equal((await rpc('feedback_staff_auto_finish',{p_id:claim.id,p_claim:claim.claim_token,p_result:'failed',p_http_status:429})).recorded,true);
      await rpc('feedback_staff_auto_prepare',{p_now:morning});
      const next=await rpc('feedback_staff_auto_claim');assert.notEqual(next.id,claim.id);
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      assert.equal((await q('select attempts from feedback_staff_auto_outbox where id=$1',[claim.id]))[0].attempts,1);
    });

    await t.test('future activation bound blocks historical meetings in prepare and claim',async()=>{
      await reset();await activity('PAST');await q("update feedback_staff_auto_control set activation_at='2026-10-14T00:00Z'");
      assert.equal((await rpc('feedback_staff_auto_prepare',{p_now:morning})).prepared,0);
      assert.deepEqual(await rpc('feedback_staff_auto_claim'),{});
      await q("update feedback_staff_auto_control set enabled=false,activation_at=null");
    });

    await t.test('existing student and instructor personal/public flows still work after the new migration',async()=>{
      await reset();await activity('UNCHANGED',{emp_id:'1501',instructor_name:'דנה',instructor_assignment_locked:true,instructor_assignment_status:'שובץ'});
      await q("insert into contacts_instructors(emp_id,full_name,mobile,email,active) values(1501,'דנה','0500000000','instructor@example.test','פעיל') on conflict do nothing");
      await q("select set_config('test.uid',$1,false)",[ADMIN]);
      const student=(await q("select feedback_admin_open_campaign('UNCHANGED','student','pre') c"))[0].c;
      const instructor=(await q("select feedback_admin_open_instructor_campaign('1501','trailblazers','school_2027','pre') c"))[0].c;
      assert.equal(student.audience,'student');assert.equal(instructor.audience,'instructor');
      await q('set role anon');
      const studentForm=(await q('select feedback_public_get($1) form',[student.public_token]))[0].form;
      const instructorForm=(await q('select feedback_public_get($1) form',[instructor.recipient.token]))[0].form;
      assert.equal(studentForm.state,'ok');assert.equal(instructorForm.state,'ok');
      assert.ok(studentForm.questions.length>0);assert.ok(instructorForm.questions.length>0);
      await q('reset role');
      await q("update feedback_staff_auto_control set enabled=false,activation_at=null");
    });
  } finally {await client.end();}
});
