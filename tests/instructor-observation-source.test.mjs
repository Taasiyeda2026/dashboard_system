import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('frontend/src/instructor-observation-runtime.js', 'utf8');
const stylesheet = fs.readFileSync('frontend/src/styles/instructor-observation.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261019023000_instructor_observations.sql', 'utf8');
const main = fs.readFileSync('frontend/src/main.js', 'utf8');
const jsBody = source.replace(/^import .*?;\s*$/gm, '').replace(/export function /g, 'function ');

test('observation feature script parses and retains 6 source sections with 15 questions', () => {
  const context = vm.createContext({});
  const sections = new vm.Script(jsBody + '\nSECTIONS;').runInContext(context);
  assert.equal(sections.length, 6);
  assert.equal(sections.reduce((sum, section) => sum + section.questions.length, 0), 15);
  assert.deepEqual([...sections.map(section => section.questions.length)], [2, 3, 3, 2, 3, 2]);
  assert.deepEqual([...sections[0].questions[0][1]], ['כן', 'חלקית', 'לא']);
  const expected=['5','4','3','2','1'];
  for (const section of sections) for (const [,answers] of section.questions) {
    if(answers.some(answer=>/^[1-5]$/.test(answer))) {
      assert.deepEqual([...answers.slice(0,5)],expected,'Graded domains use all five numeric ratings');
    } else assert.deepEqual([...answers],['כן','חלקית','לא']);
  }
  assert.deepEqual([...sections[1].questions[2][1]], [...expected,'לא בוצע']);
  assert.deepEqual([...sections[5].questions[1][1]], [...expected,'לא התקיים']);
});

test('numeric score labels print consistently and historic answers remain unconverted',()=>{
 const context=vm.createContext({});
 const grade=new vm.Script(jsBody+'\n({labels:RATING_OPTIONS.map(([v,caption])=>v+" – "+caption),newText:responseLabel("4",SECTIONS[0].questions[1][1]),oldText:responseLabel("בינוני",SECTIONS[0].questions[1][1]),binary:responseLabel("כן",SECTIONS[0].questions[0][1])})').runInContext(context);
 assert.deepEqual([...grade.labels],['5 – מצוין','4 – טוב מאוד','3 – טוב','2 – טעון שיפור','1 – חלש']);
 assert.equal(grade.newText,'4 – טוב מאוד');
 assert.equal(grade.oldText,'תשובה בסולם קודם: בינוני');
 assert.equal(grade.binary,'כן');
 assert.match(source,/function printedQuestion/);
 assert.match(source,/io-report-choice/);
 assert.match(source,/io-report-rating-key/);
 assert.match(stylesheet,/io-report-choices--rating/);
 assert.match(stylesheet,/io-home-head/);
 assert.match(stylesheet,/io-options--rating/);
});

test('manager icons only appear for authorized roles and observation data is separate', () => {
  assert.doesNotMatch(source, /manager-board-team-strip__grid button\[data-instructor-id\]/);
  assert.doesNotMatch(source, /instructor-card-shell button\[data-instructor-card\]/);
  assert.match(source, /observationSlot/);
  assert.match(source, /btn\.dataset\.ioSlot/);
  assert.match(source, /activities_manager/);
  assert.match(source, /operation_manager/);
  assert.match(source, /const TABLE = 'instructor_observations'/);
  assert.doesNotMatch(source, /feedback_campaigns/);
  assert.match(main, /installInstructorObservationRuntime\(\{ getUser: \(\) => state.user \}\)/);
});

test('PDF report is complete, A4-printable and does not modify finalized records', () => {
  assert.match(source, /SECTIONS\.map\(\(s,i\)=>'<section class="io-report-section">/);
  assert.match(source, /completed/);
  assert.match(source, /window\.print\(\)/);
  assert.match(stylesheet, /@media print/);
  assert.match(stylesheet, /@page instructor-observation-report\s*\{size:A4/);
  assert.match(stylesheet, /@media\(max-width:640px\)/);
  assert.match(migration, /completed_instructor_observation_is_immutable/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /created_by = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /for delete to authenticated/i);
});

test('migration contains one well-formed observation trigger and each RLS policy once',()=>{
 for(const marker of [
  'create trigger instructor_observations_immutable',
  'create policy instructor_observations_read',
  'create policy instructor_observations_insert',
  'create policy instructor_observations_update',
  'comment on table public.instructor_observations'
 ]) assert.equal(migration.split(marker).length-1,1,marker);
 assert.match(migration, /new\.details->>'meeting',''\) !~ '\^\[1-9\]\[0-9\]\*\$'/);
 assert.match(migration, /new\.details->>'students',''\) !~ '\^\[1-9\]\[0-9\]\*\$'/);
 assert.match(migration, /new\.responses \?& array\[/);
 assert.match(migration, /'5-1'\s*\]\)\s*\) then/);
});
