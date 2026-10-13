import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { activeFeedbackQuestions, conditionalQuestionVisible } from '../frontend/src/impact-feedback/feedback-conditional.js';
import { missingRequired, formProgress } from '../frontend/src/impact-feedback/feedback-domain.js';
import { mountFeedbackForm } from '../frontend/src/impact-feedback/feedback-form.js';

const parent = { id:'question-parent', type:'multi_select', required:false, text:'אילו מצגות דורשות שיפור?',
  options:[{value:'v1',label:'עומס טקסט',label_ar:'ازدحام النص'}] };
const followUp = { id:'question-followup', type:'free_text', required:true,
  text:'איזו שקופית ולמה?', visible_when:{parent_id:parent.id,operator:'nonempty'} };
const rating = { id:'question-rating', type:'rating_1_5', required:true, text:'איכות התוכן' };
const questionSet = [parent,followUp,rating];

test('follow-up hidden until a problem is marked; missingRequired and progress track only visible questions', () => {
  assert.equal(conditionalQuestionVisible(followUp, {}, questionSet), false);
  assert.deepEqual(activeFeedbackQuestions(questionSet, {}).map(q=>q.id),[parent.id,rating.id]);
  assert.deepEqual(missingRequired(questionSet, {[rating.id]:4}), []);
  assert.equal(formProgress(questionSet, {[rating.id]:4}), 50);
  const answers = {[parent.id]:['v1'],[rating.id]:4};
  assert.equal(conditionalQuestionVisible(followUp, answers, questionSet), true);
  assert.deepEqual(missingRequired(questionSet, answers), [followUp.id]);
  assert.equal(formProgress(questionSet,answers),67);
  answers[followUp.id]='שקופית 4 – חסרה המחשה';
  assert.equal(formProgress(questionSet,answers),100);
});

test('a not_equals trigger handles content-time gaps and ignores unanswered parent', () => {
  const q=[{id:'time',type:'single_select',required:true},{id:'details',type:'free_text',required:false,
    visible_when:{parent_id:'time',operator:'not_equals',value:'v1'}}];
  assert.equal(conditionalQuestionVisible(q[1],{},q),false);
  assert.equal(conditionalQuestionVisible(q[1],{time:'v1'},q),false);
  assert.equal(conditionalQuestionVisible(q[1],{time:'v3'},q),true);
});

test('invalid or absent ancestors fail closed; older questions stay visible', () => {
  const invalid={id:'x',visible_when:{parent_id:'missing',operator:'nonempty'}};
  assert.equal(conditionalQuestionVisible(invalid,{missing:['v1']},[invalid]),false);
  assert.equal(conditionalQuestionVisible({id:'old'}, {}, [{id:'old'}]),true);
  const cycle=[{id:'a',visible_when:{parent_id:'b',operator:'nonempty'}},{id:'b',visible_when:{parent_id:'a',operator:'nonempty'}}];
  assert.equal(conditionalQuestionVisible(cycle[0],{a:['x'],b:['y']},cycle),false);
});

function mounted({language='he',initialAnswers={}}={}) {
  const dom = new JSDOM('<div id="app"></div>');
  const prevCSS=globalThis.CSS;
  globalThis.CSS = {escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const app=dom.window.document.getElementById('app');
  const calls=[];
  mountFeedbackForm(app,{audience:'instructor',stage:'pre',program_key:'ai_applications',program_title:'יישומי AI',
    questions:questionSet.map(q=>({...q,text:language==='ar'?'السؤال '+q.id:q.text}))},
  {language,initialAnswers,onSubmit:async answers=>{calls.push(answers);return {ok:true,state:'submitted'};}});
  return {dom,app,calls,cleanup:()=>{globalThis.CSS=prevCSS;}};
}
const update=(dom,el)=>el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
const submit=async (dom,form)=>{
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
};

test('real form opens follow-up, requires its answer, then clears it when parent is deselected', async () => {
  const f=mounted();
  try{
    const qNode=f.app.querySelector('[data-question="question-followup"]');
    const form=f.app.querySelector('form');
    assert.equal(qNode.hidden,true);
    assert.equal(qNode.querySelector('textarea').disabled,true);
    const choice=f.app.querySelector('input[data-qid="question-parent"]');
    choice.checked=true; update(f.dom,choice);
    assert.equal(qNode.hidden,false);
    assert.equal(qNode.querySelector('textarea').disabled,false);
    const ratingNode=f.app.querySelector('input[data-qid="question-rating"][value="4"]');
    ratingNode.checked=true;update(f.dom,ratingNode);
    await submit(f.dom,form);
    assert.equal(f.calls.length,0,'visible required follow-up prevents submit');
    const detail=qNode.querySelector('textarea');
    detail.value='להוסיף דוגמה והמחשה למפגש 3';
    detail.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
    await submit(f.dom,form);
    assert.deepEqual(f.calls[0][followUp.id],'להוסיף דוגמה והמחשה למפגש 3');
    choice.checked=false;update(f.dom,choice);
    assert.equal(qNode.hidden,true);
    assert.equal(detail.value,'','hidden answer is cleared');
    await submit(f.dom,form);
    assert.equal(f.calls.length,2);
    assert.equal(f.calls[1][followUp.id],undefined,'hidden answer never submitted');
  }finally{f.cleanup();}
});

test('Arabic view follows the same conditional path and counts active questions only', () => {
  const f=mounted({language:'ar',initialAnswers:{'question-parent':['v1']}});
  try {
    assert.equal(f.app.querySelector('[data-question="question-followup"]').hidden,false);
    assert.match(f.app.querySelector('[data-progress-label]').textContent,/من 3/);
    assert.match(f.app.querySelector('[data-question="question-followup"]').textContent,/السؤال/);
  }finally{f.cleanup();}
});

test('the published and preview questionnaire transports branch rules, and database rejects hidden answers', () => {
  const file=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const sql=file('supabase/migrations/20261013053000_feedback_instructor_conditional_followups.sql');
  assert.match(sql,/'visible_when',tq.scoring->'visible_when'/);
  assert.match(sql,/private\.feedback_question_visible\(p_answers, tq\.scoring\)/);
  assert.match(sql,/parent\.sort_order < child\.sort_order/);
  assert.match(file('frontend/src/impact-feedback/feedback-templates-view.js'),/visible_when: q\.scoring\?\.visible_when/);
  assert.match(file('frontend/src/impact-feedback/feedback-form.js'),/activeFeedbackQuestions\(questions, answers\)/);
});
