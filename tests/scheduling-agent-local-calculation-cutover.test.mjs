import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
test('single-course local candidate engine is disabled under server ownership',()=>{
  assert.match(source,/const SCHEDULING_AGENT_OWNS_COMPUTE = true/);
  const start=source.indexOf('const runFindInstructors = async () => {');
  const end=source.indexOf('const preliminary = preliminaryCourseCandidates(input)',start);
  assert.ok(start>=0 && end>start);
  const run=source.slice(start,end);
  assert.match(run,/if \(SCHEDULING_AGENT_OWNS_COMPUTE\) \{[\s\S]*?return;/);
  assert.ok(run.indexOf('if (SCHEDULING_AGENT_OWNS_COMPUTE)')<run.indexOf('preliminaryCourseCandidates(input)') || !run.includes('preliminaryCourseCandidates(input)'));
  assert.match(source,/data-find-instructors \$\{SCHEDULING_AGENT_OWNS_COMPUTE \|\| finding \? 'disabled' : ''\}/);
});
test('district simulation is not performed by dashboard',()=>{
  const start=source.indexOf('const runDistrictSimulation = async () => {');
  const end=source.indexOf('const preliminary = preliminaryCourseCandidates(input)',start);
  assert.ok(start>=0 && end>start);
  assert.match(source.slice(start,end),/if \(SCHEDULING_AGENT_OWNS_COMPUTE\) \{[\s\S]*?return;/);
});
