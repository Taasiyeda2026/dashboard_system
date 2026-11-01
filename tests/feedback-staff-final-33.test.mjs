import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountFeedbackForm } from '../frontend/src/impact-feedback/feedback-form.js';
import { conditionalQuestionVisible } from '../frontend/src/impact-feedback/feedback-conditional.js';
import { invalidFeedbackAnswers } from '../frontend/src/impact-feedback/feedback-answer-rules.js';
import { openAnswers, rawExportRows } from '../frontend/src/impact-feedback/feedback-domain.js';
const spec=JSON.parse(readFileSync(new URL('./fixtures/staff-final-approved.json',import.meta.url)));
export function questionsFor(language='he') {
  return spec.map(q=>({id:`q${q.number}`,type:q.type,required:true,text:q.wording[language==='ar'?'ar':'default'],options:q.options,allow_na:q.scoring.allow_na,scoring:{...q.scoring},
    visible_when:q.number===10?{parent_id:'q9',operator:'in',values:['opt_1','opt_2']}:q.number===28?{parent_id:'q27',operator:'in',values:['opt_0','opt_2']}:q.number===26?{any:[23,24,25].map(n=>({parent_id:`q${n}`,operator:'in',values:['1','2']}))}:null}));
}
for(const language of ['he','ar']) {
 test(`${language}: all 33 questions, headers, instructions, six rating labels and 0–10 endpoints render`,()=>{
  const dom=new JSDOM('<div id="app"></div>');globalThis.CSS={escape:String};
  const app=dom.window.document.querySelector('#app');
  mountFeedbackForm(app,{audience:'educational_staff',stage:'final',questions:questionsFor(language)},{language,initialStarted:true});
  assert.equal(app.querySelectorAll('fieldset').length,33);
  assert.equal(app.querySelectorAll('[data-heading-for]').length,8);
  for(const n of [1,9,14,15,20,23,27,32]) assert.ok(app.querySelector(`[data-heading-for="q${n}"]`).textContent.trim());
  for(const q of questionsFor(language)) assert.ok(app.querySelector(`[data-question="${q.id}"]`).textContent.includes(q.text));
  assert.equal(app.querySelectorAll('[data-question="q11"] input').length,11);
  assert.equal(app.querySelector('[data-question="q11"] input').value,'opt_0');
  assert.match(app.querySelector('[data-question="q29"]').textContent,language==='ar'?/تأثير إيجابي/:/השפעה חיובית/);
  assert.match(app.querySelector('[data-question="q1"]').textContent,language==='ar'?/بدرجة متوسطة/:/במידה בינונית/);
  assert.equal(app.querySelector('[data-question="q12"] textarea').maxLength,250);
  assert.equal(app.querySelector('[lang]').dir,'rtl');
  if(language==='ar') assert.doesNotMatch(app.textContent,/[א-ת]/);
  dom.window.close();delete globalThis.CSS;
 });
 test(`${language}: complete submission requires other details, enforces limits, exclusive evidence and clears hidden answers`,async()=>{
  const dom=new JSDOM('<div id="app"></div>');globalThis.CSS={escape:String};
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const app=dom.window.document.querySelector('#app');const calls=[];
  const qs=questionsFor(language);const initialAnswers=Object.fromEntries(qs.map(q=>[q.id,q.type==='rating_1_5'?4:q.type==='multi_select'?['opt_8']:q.type==='single_select'?'opt_0':language==='ar'?'تفاصيل':'פרטים']));
  initialAnswers.q9='opt_1';initialAnswers.q10='opt_9';initialAnswers.q23=1;
  const {answers}=mountFeedbackForm(app,{audience:'educational_staff',stage:'final',questions:qs},{language,initialAnswers,onSubmit:async a=>{calls.push(a);return {ok:true};}});
  const event=(el,kind)=>el.dispatchEvent(new dom.window.Event(kind,{bubbles:true,cancelable:true}));
  const submit=async()=>{event(app.querySelector('form'),'submit');await new Promise(setImmediate);};
  await submit();assert.equal(calls.length,0);
  const detail=app.querySelector('[data-other-for="q10"] textarea');detail.value=language==='ar'?'سبب آخر':'סיבה נוספת';event(detail,'input');
  await submit();assert.equal(calls.length,1);assert.equal(calls[0].q10__other,detail.value);assert.ok(calls[0].q26);
  const long=app.querySelector('[data-question="q13"] textarea');long.value='א'.repeat(251);event(long,'input');await submit();assert.equal(calls.length,1);
  long.value='א'.repeat(250);event(long,'input');
  const input=app.querySelector('[data-qid="q30"][value="opt_0"]');input.checked=true;event(input,'change');assert.deepEqual(answers.q30,['opt_0']);
  const none=app.querySelector('[data-qid="q30"][value="opt_8"]');none.checked=true;event(none,'change');assert.deepEqual(answers.q30,['opt_8']);
  for(const [id,value] of [['q9','opt_0'],['q23','5']]){const el=app.querySelector(`[data-qid="${id}"][value="${value}"]`);el.checked=true;event(el,'change');}
  assert.equal(answers.q10,undefined);assert.equal(answers.q10__other,undefined);assert.equal(answers.q26,undefined);
  await submit();assert.equal(calls.length,2);assert.equal(calls[1].q10,undefined);assert.equal(calls[1].q26,undefined);
  dom.window.close();delete globalThis.CSS;
 });
}
test('all operational triggers ignore N/A and missing parents; supplied invalid arrays and other text are rejected',()=>{
 const qs=questionsFor();const q=qs[25];
 assert.equal(conditionalQuestionVisible(q,{q23:'na',q24:5,q25:3},qs),false);
 for(const id of ['q23','q24','q25']) for(const n of [1,2]) assert.equal(conditionalQuestionVisible(q,{[id]:n},qs),true);
 assert.deepEqual(invalidFeedbackAnswers(qs,{q30:['opt_8','opt_0']}),['q30']);
 assert.deepEqual(invalidFeedbackAnswers(qs,{q30:['opt_0','opt_0']}),['q30']);
 assert.deepEqual(invalidFeedbackAnswers(qs,{q30:['opt_9'],q30__other:' '.repeat(3)}),['q30']);
});
test('raw Excel and AI open-answer inputs retain choice details and all seven open questions',()=>{
 const facts=spec.filter(q=>q.type==='free_text'||q.number===30).map(q=>({answer_id:`a${q.number}`,response_id:'r',question_id:`q${q.number}`,question_type:q.type,question_text:q.wording.default,question_options:q.options,scoring:q.scoring,value_options:q.number===30?['opt_9']:null,value_text:q.number===30?'פירוט אחר':`תשובה ${q.number}`}));
 assert.equal(openAnswers(facts).length,8);
 assert.match(JSON.stringify(rawExportRows(facts)),/פירוט אחר/);
 for(const n of [12,13,26,28,31,32,33])assert.match(JSON.stringify(rawExportRows(facts)),new RegExp(`תשובה ${n}`));
});
