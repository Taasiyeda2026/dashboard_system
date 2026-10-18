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
  assert.deepEqual([...sections[1].questions[2][1]], ['מצוין', 'טוב', 'חלקי', 'לא בוצע']);
  assert.deepEqual([...sections[5].questions[1][1]], ['מצוין', 'טוב', 'בינוני', 'לא התקיים']);
});

test('manager icons only appear for authorized roles and observation data is separate', () => {
  assert.match(source, /manager-board-team-strip__grid button\[data-instructor-id\]/);
  assert.match(source, /instructor-card-shell button\[data-instructor-card\]/);
  assert.match(source, /activities_manager/);
  assert.match(source, /operation_manager/);
  assert.match(source, /const TABLE = 'instructor_observations'/);
  assert.doesNotMatch(source, /feedback_campaigns/);
  assert.match(main, /installInstructorObservationRuntime\(\{ getUser: \(\) => state.user \}\)/);
});

test('PDF report is complete, A4-printable and does not modify finalized records', () => {
  assert.match(source, /SECTIONS\.map\(\(s,i\)=>'<section>/);
  assert.match(source, /completed/);
  assert.match(source, /window\.print\(\)/);
  assert.match(stylesheet, /@media print/);
  assert.match(stylesheet, /@page\s*\{size:A4/);
  assert.match(stylesheet, /@media\(max-width:640px\)/);
  assert.match(migration, /completed_instructor_observation_is_immutable/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /created_by = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /for delete to authenticated/i);
});
