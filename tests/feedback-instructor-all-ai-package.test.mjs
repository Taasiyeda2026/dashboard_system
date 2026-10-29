import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAllInstructorAiPackage } from '../frontend/src/impact-feedback/feedback-instructor-all-ai-package.js';

const mk = (program_key, stage, response_id, question_id, question_text, value_number, question_type='rating_1_5') => ({
  program_key, stage, response_id, question_id, question_key: question_id,
  question_text, value_number: question_type === 'rating_1_5' ? value_number : null,
  value_text: question_type === 'free_text' ? value_number : null,
  question_type, audience:'instructor', academic_year:'school_2027',
  metric_key:'delivery', school_name:'בית ספר חסוי', instructor_name:'מדריך חסוי',
  respondent_name:'שם חסוי', campaign_id:'secret-id', submitted_at:'2026-10-20T09:00:00Z',
  scoring:{}, question_options:[], value_options:[], sort_order:10, section:'core'
});
const facts = [
  mk('course-a','pre','a1','shared','עד כמה ההכשרה תרמה למוכנות?',2),
  mk('course-a','pre','a2','shared','עד כמה ההכשרה תרמה למוכנות?',4),
  mk('course-b','pre','b1','shared','עד כמה ההכשרה תרמה למוכנות?',5),
  mk('course-c','pre','c1','shared','שאלה בנוסח אחר',3),
  mk('course-a','final','a3','end','איכות ההדרכה בפועל?',4),
  mk('course-b','final_b','b2','end','איכות ההדרכה בפועל?',5),
  mk('course-a','final','a4','arabic','הערה על הקורס','كانت التجربة جيدة جدا','free_text'),
];
const programs = [
  {key:'course-a',title:'קורס א׳'}, {key:'course-b',title:'קורס ב׳'},
  {key:'course-c',title:'קורס ג׳'}, {key:'course-d',title:'קורס ללא משובים'}
];
const run = () => buildAllInstructorAiPackage({
  academicYear:'school_2027', programs, facts, metrics:[],
  instructorRecommendations:[
    {program_key:'course-a',response_id:'a3',issue:'פעילות עמוסה',recommendation:'לקצר את הפעילות',actions:['simplify'],priority:'high'},
    {program_key:'course-b',response_id:'b2',issue:'זמן קצר',recommendation:'להאריך זמן',actions:['extend'],priority:'high'}
  ]
});
const sheet = (output,name) => output.sheets.find((s) => s.name === name);

test('all instructor course/phase combinations remain distinct with own N', () => {
  const out=run();
  const rows=sheet(out,'בסיס לפי קורס').rows;
  assert.equal(rows.find(r=>r[0]==='קורס א׳' && r[2]==='pre')[3],2);
  assert.equal(rows.find(r=>r[0]==='קורס ב׳' && r[2]==='final_b')[3],1);
  assert.equal(rows.find(r=>r[0]==='קורס ללא משובים' && r[2]==='pre')[3],0);
  assert.equal(out.questionnaireCount,7);
  const questions=sheet(out,'תוצאות לפי קורס').rows;
  assert.equal(questions.find(r=>r[0]==='קורס א׳' && r[1]==='לאחר הכשרה')[7],3);
  assert.equal(questions.find(r=>r[0]==='קורס ב׳' && r[1]==='לאחר הכשרה')[7],5);
});
test('only identical questions at the same stage qualify as cross-course numeric comparisons', () => {
  const rows=sheet(run(),'שאלות משותפות').rows;
  assert.equal(rows.length,2);
  assert.ok(rows.every(r=>r[1]==='עד כמה ההכשרה תרמה למוכנות?'));
  assert.ok(rows.every(r=>r[2]!=='קורס ג׳'));
  assert.ok(!rows.some(r=>r[1]==='איכות ההדרכה בפועל?'));
});
test('all instructor comments and improvement recommendations retain their course', () => {
  const out=run();
  const open=sheet(out,'תשובות פתוחות').rows;
  assert.equal(open.length,1);
  assert.equal(open[0][1],'קורס א׳');
  assert.equal(open[0][5],'ערבית - נדרש תרגום מלא');
  const improvements=sheet(out,'המלצות מדריכים').rows;
  assert.equal(improvements.length,2);
  assert.equal(improvements[0][0],'קורס א׳');
  assert.equal(improvements[1][0],'קורס ב׳');
  assert.ok(JSON.stringify(sheet(out,'הנחיות AI')).includes('כל קורס בנפרד'));
});
test('instructor raw source retains course identity but not identifying names or IDs', () => {
  const raw=JSON.stringify(sheet(run(),'נתוני מקור').rows);
  assert.match(raw,/קורס א׳/);
  assert.doesNotMatch(raw,/מדריך חסוי|שם חסוי|בית ספר חסוי|secret-id|a1|a2/);
});
test('non-instructors and other academic years do not leak into export', () => {
  const extra=[
    {...mk('course-a','pre','st1','s','שאלת תלמיד',2),audience:'student'},
    {...mk('course-a','pre','old1','shared','עד כמה ההכשרה תרמה למוכנות?',1),academic_year:'regular'}
  ];
  const output=buildAllInstructorAiPackage({
    academicYear:'school_2027', programs, facts:[...facts,...extra]
  });
  assert.equal(output.questionnaireCount,7);
  const raw=JSON.stringify(sheet(output,'נתוני מקור').rows);
  assert.doesNotMatch(raw,/שאלת תלמיד/);
});
