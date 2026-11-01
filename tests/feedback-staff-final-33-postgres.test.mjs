import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as XLSX from 'xlsx';
import { buildAiPackage } from '../frontend/src/impact-feedback/feedback-ai-package.js';
const url=process.env.STAFF_FINAL_TEST_DATABASE_URL;
const spec=JSON.parse(await readFile(new URL('./fixtures/staff-final-approved.json',import.meta.url),'utf8'));
const programs=['ai_applications','ai_foundations','biomimicry','biomimicry_secondary','board_games','green_leadership','ofek','pharma','sky_limit','space_tech','trailblazers'];
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('disposable Postgres: migrate 11 existing drafts; publish and submit both languages; retain historical snapshots and validate server rules',async t=>{
 if(!url){t.skip('STAFF_FINAL_TEST_DATABASE_URL must point to a disposable database');return;}
 const db=new pg.Client({connectionString:url});await db.connect();
 try {
  await db.query('drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; create schema public');
  await db.query(await read('tests/fixtures/impact-feedback-stub-schema.sql'));
  await db.query(await read('supabase/migrations/20261008120000_impact_feedback_schema.sql'));
  await db.query(await read('supabase/migrations/20261008120500_impact_feedback_seed.sql'));
  await db.query(`alter table feedback_template_versions add column intro_text_ar text;
    create table private.feedback_student_syllabus_intros(program_key text,stage text,intro_text_he text,intro_text_ar text);
    create table private.feedback_biomimicry_approved_intro_ar(stage text,intro_text_ar text);
    create table private.feedback_biomimicry_approved_question_ar(question_id uuid,wording_ar text);
    create table private.feedback_arabic_translations(kind text,he text,ar text);`);
  const versions=[];
  for(const program of programs){
   await db.query('insert into feedback_programs(key,title,topic) values($1,$1,$1) on conflict do nothing',[program]);
   const {rows:[template]}=await db.query(`insert into feedback_templates(program_key,audience,stage,title) values($1,'educational_staff','final',$1) on conflict(program_key,audience,stage) do update set title=excluded.title returning id`,[program]);
   const {rows:[version]}=await db.query(`insert into feedback_template_versions(template_id,version_no,notes) values($1,99,'Approved Hebrew final 2026; pending Arabic and conditional UI') returning id`,[template.id]);versions.push(version.id);
   for(const q of spec){
    const {rows:[lib]}=await db.query(`insert into feedback_questions(question_key,metric_key,question_type,audiences,stages,wording,options) values($1,'content',$2,array['educational_staff'],array['final'],$3,$4) on conflict(question_key) do update set question_key=excluded.question_key returning id`,['staff_final_test_'+q.number,q.type,q.wording,JSON.stringify(q.options)]);
    await db.query(`insert into feedback_template_questions(version_id,question_id,sort_order,metric_key,question_type,wording,options) values($1,$2,$3,'content',$4,$5,$6)`,[version.id,lib.id,q.number*10,q.type,q.wording,JSON.stringify(q.options)]);
   }
  }
  const historySql=`select md5(string_agg(to_jsonb(q)::text,'' order by q.id)) as hash from feedback_template_questions q where not(q.version_id=any($1::uuid[]))`;
  const before=(await db.query(historySql,[versions])).rows[0].hash;
  await db.query(await read('supabase/migrations/20261101011222_feedback_staff_final_33_rules.sql'));
  assert.equal((await db.query(historySql,[versions])).rows[0].hash,before);
  assert.equal((await db.query('select count(*)::int as n from feedback_template_questions where version_id=any($1::uuid[])',[versions])).rows[0].n,363);
  const {rows:[old]}=await db.query(`select v.id from feedback_template_versions v join feedback_templates t on t.id=v.template_id where t.program_key='biomimicry' and t.audience='educational_staff' and t.stage='final' and v.status='published'`);
  const oldCampaign=async()=> (await db.query(`insert into feedback_campaigns(program_key,template_version_id,audience,stage) values('biomimicry',$1,'educational_staff','final') returning id`,[old.id])).rows[0].id;
  const answeredCampaign=await oldCampaign(),pendingCampaign=await oldCampaign();
  await db.query('insert into feedback_responses(campaign_id,template_version_id,client_submission_id) values($1,$2,$3)',[answeredCampaign,old.id,randomUUID()]);
  await db.query(await read('scripts/feedback/publish-staff-final-2546.sql'));
  const pinned=(await db.query('select id,template_version_id,status from feedback_campaigns where id=any($1::uuid[])',[[answeredCampaign,pendingCampaign]])).rows;
  assert.equal(pinned.find(c=>c.id===answeredCampaign).template_version_id,old.id);
  assert.notEqual(pinned.find(c=>c.id===pendingCampaign).template_version_id,old.id);
  assert.ok(pinned.every(c=>c.status==='active'));
  for(const version of versions){
   for(const language of ['he','ar']){
    const {rows:qs}=await db.query('select * from feedback_template_questions where version_id=$1 order by sort_order',[version]);
    const {rows:[campaign]}=await db.query(`insert into feedback_campaigns(program_key,template_version_id,audience,stage,school_name) select t.program_key,$1,'educational_staff','final','isolated QA school' from feedback_template_versions v join feedback_templates t on t.id=v.template_id where v.id=$1 returning id`,[version]);
    const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');
    await db.query(`insert into feedback_recipients(campaign_id,recipient_type,token,locked) values($1,'educational_staff',$2,false)`,[campaign.id,token]);
    const payload=(await db.query('select feedback_public_get($1) as result',[token])).rows[0].result;
    assert.equal(payload.state,'ok');assert.equal(payload.questions.length,33);assert.equal(payload.questions[0].scoring.rating_scale,'staff_final');
    for(let i=0;i<33;i++){assert.equal(payload.questions[i].text,spec[i].wording.default);assert.equal(payload.questions[i].text_ar,spec[i].wording.ar);}
    const answers=Object.fromEntries(qs.map(q=>[q.id,q.question_type==='rating_1_5'?4:q.question_type==='single_select'?'opt_0':q.question_type==='multi_select'?['opt_9']:language==='ar'?'نص عربي للاختبار':'טקסט עברי לבדיקה']));
    const id=n=>qs[n-1].id;
    answers[id(1)]='na';answers[id(11)]='opt_0';answers[id(29)]='opt_10';
    answers[id(9)]='opt_2';answers[id(10)]='opt_9';answers[id(10)+'__other']='سبب آخر / סיבה אחרת';answers[id(30)+'__other']='دليل آخر / עדות אחרת';answers[id(23)]=2;
    const submission=randomUUID();
    const send=async a=>(await db.query('select feedback_public_submit($1,$2,$3,30) as result',[token,submission,a])).rows[0].result;
    for(const bad of [{...answers,[id(12)]:'א'.repeat(251)},{...answers,[id(26)]:'ع'.repeat(251)},{...answers,[id(30)]:['opt_8','opt_0']},{...answers,[id(30)]:['opt_0','opt_0']},{...answers,[id(10)+'__other']:''}])assert.equal((await send(bad)).state,'invalid_answers');
    const activeResult=await send(answers);assert.equal(activeResult.state,'submitted');
    const activeSaved=(await db.query('select a.* from feedback_answers a join feedback_responses r on r.id=a.response_id where r.campaign_id=$1',[campaign.id])).rows;
    assert.equal(activeSaved.length,33);
    for(const n of [10,26,28])assert.ok(activeSaved.find(a=>a.template_question_id===id(n)));
    assert.equal(activeSaved.find(a=>a.template_question_id===id(10)).value_text,answers[id(10)+'__other']);
    const {rows:[hiddenCampaign]}=await db.query(`insert into feedback_campaigns(program_key,template_version_id,audience,stage,school_name) select program_key,template_version_id,audience,stage,school_name from feedback_campaigns where id=$1 returning id`,[campaign.id]);
    const hiddenToken=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');
    await db.query(`insert into feedback_recipients(campaign_id,recipient_type,token,locked) values($1,'educational_staff',$2,false)`,[hiddenCampaign.id,hiddenToken]);
    const hiddenSubmission=randomUUID();
    const hiddenSend=async a=>(await db.query('select feedback_public_submit($1,$2,$3,30) as result',[hiddenToken,hiddenSubmission,a])).rows[0].result;
    // Hidden stale responses must not survive; other detail remains on visible multi-select.
    answers[id(9)]='opt_0';answers[id(23)]=5;answers[id(27)]='opt_1';
    const result=await hiddenSend(answers);assert.equal(result.state,'submitted');assert.equal((await hiddenSend(answers)).state,'already_received');
    const {rows:saved}=await db.query('select a.* from feedback_answers a join feedback_responses r on r.id=a.response_id where r.campaign_id=$1 and r.client_submission_id=$2',[hiddenCampaign.id,hiddenSubmission]);
    assert.equal(saved.length,30);assert.equal(saved.find(a=>a.template_question_id===id(1)).value_number,null);
    assert.deepEqual(saved.find(a=>a.template_question_id===id(1)).value_options,['na']);
    for(const n of [10,26,28])assert.equal(saved.some(a=>a.template_question_id===id(n)),false);
    assert.equal(saved.find(a=>a.template_question_id===id(30)).value_text,answers[id(30)+'__other']);
    for(const n of [12,13,31,32,33])assert.equal(saved.find(a=>a.template_question_id===id(n)).value_text,answers[id(n)]);
    assert.deepEqual(saved.find(a=>a.template_question_id===id(11)).value_options,['opt_0']);assert.deepEqual(saved.find(a=>a.template_question_id===id(29)).value_options,['opt_10']);
   }
  }
  const {rows:facts}=await db.query(`select a.*,a.id as answer_id,tq.wording->>'default' as question_text,tq.options as question_options,tq.scoring,tq.section,tq.sort_order,q.question_key,c.program_key,c.audience,c.stage,c.school_name,c.academic_year,r.submitted_at from feedback_answers a join feedback_responses r on r.id=a.response_id join feedback_campaigns c on c.id=r.campaign_id join feedback_template_questions tq on tq.id=a.template_question_id join feedback_questions q on q.id=a.question_id where c.program_key='biomimicry'`);
  const report=buildAiPackage({facts,selected:['educational_staff:final'],title:'ביומימיקרי',programs:[{key:'biomimicry',title:'ביומימיקרי'}]});
  const wb=XLSX.utils.book_new();
  for(const sheet of report.sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sheet.headers?[sheet.headers,...sheet.rows]:sheet.rows),sheet.name);
  const restored=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const exported=JSON.stringify(restored.Sheets);
  for(const text of ['טקסט עברי לבדיקה','نص عربي للاختبار','دليل آخر / עדות אחרת','سبب آخر / סיבה אחרת'])assert.ok(exported.includes(text));
  assert.equal(report.sheets.find(s=>s.name==='תשובות פתוחות').rows.length,30);
  assert.equal((await db.query(historySql,[versions])).rows[0].hash,before);
  assert.equal((await db.query('select count(*)::int as n from feedback_responses')).rows[0].n,45);
 } finally {await db.end();}
});
