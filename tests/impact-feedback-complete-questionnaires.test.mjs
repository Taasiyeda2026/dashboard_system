import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import pg from 'pg';
import { JSDOM } from 'jsdom';
import { groupInstructorFullResponses, groupEducationalStaffFullResponses, groupStudentFullResponses } from '../frontend/src/impact-feedback/feedback-domain.js';
import { loadAllFeedbackFactPages } from '../frontend/src/impact-feedback/feedback-facts-pagination.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const renderer = screen.slice(screen.indexOf('function completeInstructorAnswerValueHtml('), screen.indexOf('/** Every question', screen.indexOf('function completeInstructorAnswerValueHtml(')));
const render = vm.runInNewContext(renderer + '\ncompleteInstructorAnswerValueHtml', {
  esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  hasArabicAnswerText: () => false
});
const longText = 'טקסט מלא بالعربية <script>\n'.repeat(120);

for (const [audience, group] of [
  ['instructor', (facts) => groupInstructorFullResponses(facts)[0]?.courses[0].responses || []],
  ['educational_staff', (facts) => groupEducationalStaffFullResponses(facts)[0]?.courses[0].responses || []],
  ['student', (facts) => groupStudentFullResponses(facts)[0]?.groups[0].responses || []]
]) {
  test(`${audience}: mixed questions, blank and long replies stay ordered in separate forms`, async () => {
    const facts = ['old', 'future'].flatMap((response_id) => [
      { question_id: 'z', question_type: 'free_text', value_text: longText },
      { question_id: 'a', question_type: 'rating_1_5', value_number: 0 },
      { question_id: 'multi', question_type: 'multi_select', value_options: ['b','a'], question_options: [{value:'b',label:'בחירה ב'},{value:'a',label:'בחירה א'}] },
      { question_id: 'blank', question_type: 'free_text', answer_id: null },
      { question_id: 'bool', question_type: 'yes_no', value_bool: false },
      { question_id: 'single', question_type: 'single_select', value_options: ['a'] }
    ].map((fact, index) => ({ answer_id: `${response_id}-${index}`, audience, response_id, program_key:'pharma', stage:'pre',
      sort_order:index, campaign_id:'campaign', school_name:'בית ספר', respondent_name:'שם', ...fact })));
    // Simulate a page boundary inside a questionnaire.
    const loaded = await loadAllFeedbackFactPages(async (start, end) => facts.slice(start, end + 1), 5);
    const responses = group(loaded);
    assert.equal(responses.length, 2);
    for (const response of responses) {
      assert.deepEqual(response.answers.map((f) => f.question_id), ['z','a','multi','blank','bool','single']);
      const dom = new JSDOM('<main>' + response.answers.map(render).join('') + '</main>');
      assert.equal(dom.window.document.querySelector('.ifb-full-answer-raw').textContent, longText);
      assert.equal(dom.window.document.querySelector('script'), null);
      assert.match(dom.window.document.body.textContent, /בחירה ב · בחירה אלא נענהלאa/);
    }
    assert.equal(group(loaded.filter((f) => f.program_key === 'other')).length, 0);
  });
}

test('visible unanswered follow-ups stay in sequence; hidden branches do not invent replies; saved text is retained', () => {
  const facts = [
    { question_id:'parent', question_type:'single_select', value_options:['yes'], scoring:{__template_question_id:'parent-id'} },
    { question_id:'visible', answer_id:null, scoring:{visible_when:{parent_id:'parent-id',operator:'not_equals',value:'no'}} },
    { question_id:'hidden', answer_id:null, scoring:{visible_when:{parent_id:'parent-id',operator:'not_equals',value:'yes'}} },
    { question_id:'saved', value_text:'תשובה היסטורית', scoring:{visible_when:{parent_id:'missing',operator:'nonempty'}} }
  ].map((fact,index) => ({ audience:'instructor', response_id:'r', program_key:'pharma', answer_id:String(index), sort_order:1, ...fact }));
  const answers = groupInstructorFullResponses(facts)[0].courses[0].responses[0].answers;
  assert.deepEqual(answers.map((f) => f.question_id), ['parent','visible','saved'], 'equal sort orders preserve server/public template order');
});

test('complete rows are kept separately from answered-only analytics and invalidated together', () => {
  assert.match(screen, /fetchAnswerFacts\(\{ academic_year: year, __complete_questionnaires: true \}\)/);
  assert.match(screen, /ui.questionnaireFacts = rows;\s+ui.facts = rows.filter\(\(fact\) => fact.answer_id != null\)/);
  assert.equal((screen.match(/ui.facts = null;\s+ui.questionnaireFacts = null;/g) || []).length, 2);
});

test('SQL RPC returns full submitted versions for all audiences without changing default facts or access', async (t) => {
  if (!process.env.FEEDBACK_COMPLETE_TEST_DATABASE_URL) return t.skip('requires a dedicated disposable database');
  const client = new pg.Client({connectionString:process.env.FEEDBACK_COMPLETE_TEST_DATABASE_URL});
  await client.connect();
  t.after(() => client.end());
  await client.query(`create schema private;
    create function private.feedback_can_view_results() returns boolean language sql as $$ select current_setting('test.allowed',true) = 'yes' $$;
    create table feedback_responses(id uuid, campaign_id uuid, submitted_at timestamptz, age_band text, recipient_id uuid, template_version_id uuid);
    create table feedback_answers(id uuid, response_id uuid, template_question_id uuid, question_id uuid, metric_key text, question_type text, value_number numeric, value_bool boolean, value_text text, value_options text[]);
    create table feedback_campaigns(id uuid, audience text, stage text, program_key text, academic_year text, activity_row_id text, activity_name text, authority_name text, school_name text, grade text, age_band text, instructor_name text, template_version_id uuid);
    create table feedback_programs(key text, topic text);
    create table feedback_template_questions(id uuid, version_id uuid, question_id uuid, wording jsonb, section text, sort_order int, metric_key text, question_type text, is_comparison boolean, scoring jsonb, options jsonb);
    create table feedback_template_versions(id uuid, version_no int);
    create table feedback_questions(id uuid, question_key text);
    create table feedback_recipients(id uuid, display_name text);
    create table activities(row_id text, start_date text, emp_id text, emp_id_2 text, instructor_assignment_locked boolean);`);
  const schema = readFileSync(new URL('../supabase/migrations/20261008120000_impact_feedback_schema.sql', import.meta.url), 'utf8');
  let rpc = schema.slice(schema.indexOf('create or replace function public.feedback_admin_answer_facts('), schema.indexOf('revoke all on function public.feedback_admin_answer_facts'));
  rpc = rpc.replace('private.feedback_is_admin()', 'private.feedback_can_view_results()')
    .replace('left join public.feedback_recipients rc on rc.id = r.recipient_id', 'left join public.feedback_recipients rc on rc.id = r.recipient_id\n  left join public.activities a on a.row_id = c.activity_row_id')
    .replace("where (f->>'academic_year'", "where (c.activity_row_id is null or a.start_date is not null) and (f->>'academic_year'");
  await client.query(rpc);
  await client.query(readFileSync(new URL('../supabase/migrations/20261028121000_feedback_answer_facts_explicit_server_pagination.sql', import.meta.url), 'utf8'));
  const migration = readdirSync(new URL('../supabase/migrations/', import.meta.url)).find((f) => f.endsWith('_feedback_complete_submitted_questionnaires.sql'));
  await client.query(readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  await client.query("select set_config('test.allowed','yes',false)");
  await client.query("insert into feedback_programs values ('pharma','נושא')");
  await client.query("insert into feedback_template_versions values ($1,1),($2,2)", [id(1),id(2)]);
  for (let i=0;i<3;i++) {
    await client.query('insert into feedback_questions values ($1,$2)', [id(10+i),'q'+i]);
    await client.query(`insert into feedback_template_questions values ($1,$2,$3,$4,'core',$5,'metric',$6,false,'{}','[]')`, [id(20+i),id(1),id(10+i),JSON.stringify({default:'שאלה '+i}),i,i===1?'rating_1_5':'free_text']);
  }
  for (const [index,audience] of ['student','instructor','educational_staff'].entries()) {
    const campaign=id(30+index), response=id(40+index);
    await client.query("insert into feedback_campaigns(id,audience,stage,program_key,academic_year,template_version_id) values ($1,$2,'pre','pharma','school_2027',$3)", [campaign,audience,id(2)]);
    await client.query("insert into feedback_responses(id,campaign_id,submitted_at,template_version_id) values ($1,$2,now(),$3)", [response,campaign,id(1)]);
    await client.query("insert into feedback_answers(id,response_id,template_question_id,question_id,metric_key,question_type,value_text) values ($1,$2,$3,$4,'metric','free_text',$5)", [id(50+index),response,id(20),id(10),longText]);
  }
  const fetch = async (filters) => (await client.query('select * from feedback_admin_answer_facts($1)', [filters])).rows;
  assert.equal((await fetch({})).length, 3, 'legacy analytics still receive saved answers only');
  const all = await loadAllFeedbackFactPages((start,end) => fetch({__complete_questionnaires:true,__page_offset:start,__page_limit:end-start+1}), 2);
  assert.equal(all.length, 9);
  for (const audience of ['student','instructor','educational_staff']) {
    const rows=all.filter((f) => f.audience===audience);
    assert.deepEqual(rows.map((f) => f.question_text), ['שאלה 0','שאלה 1','שאלה 2']);
    assert.equal(rows[0].value_text, longText);
    assert.equal(rows[1].answer_id, null);
    assert.equal(rows[0].template_version_id, id(1), 'response snapshot wins over current campaign version');
    assert.equal(rows[0].version_no, 1);
    assert.equal((await fetch({__complete_questionnaires:true,audience})).length, 3);
    if (audience==='student') assert.equal(rows[0].respondent_name, null);
  }
  assert.equal((await fetch({__complete_questionnaires:true,program_key:'other'})).length, 0);
  await client.query("select set_config('test.allowed','no',false)");
  await assert.rejects(fetch({__complete_questionnaires:true}), /feedback_forbidden/);
});
