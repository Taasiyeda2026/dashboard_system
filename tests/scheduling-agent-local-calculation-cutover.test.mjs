import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
test('manual workboard exposes no local or agent candidate computation',()=>{
  assert.doesNotMatch(source,/data-find-instructors|assignmentClient\.candidates\(/);
  assert.match(source,/data-open-manual-assignment/);
});
test('district simulation is not performed by dashboard',()=>{
  const start=source.indexOf('const runDistrictSimulation = async () => {');
  const end=source.indexOf('const preliminary = preliminaryCourseCandidates(input)',start);
  assert.ok(start>=0 && end>start);
  assert.match(source.slice(start,end),/if \(SCHEDULING_AGENT_OWNS_COMPUTE\) \{[\s\S]*?return;/);
});
