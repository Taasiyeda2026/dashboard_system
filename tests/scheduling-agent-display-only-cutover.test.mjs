import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const screen=readFileSync(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');

test('dashboard can display planning data but cannot start a browser optimization',()=>{
 assert.match(screen,/const SCHEDULING_AGENT_OWNS_COMPUTE = true;/);
 const run=screen.slice(screen.indexOf('const runCoursePlanning = async'),screen.indexOf('const clonePlanningOption',screen.indexOf('const runCoursePlanning = async')));
 assert.match(run,/if \(SCHEDULING_AGENT_OWNS_COMPUTE\) \{/);
 assert.ok(run.indexOf('if (SCHEDULING_AGENT_OWNS_COMPUTE)')<run.indexOf('acquireSchedulingPlanningRunLease'));
 assert.match(screen,/if \(!SCHEDULING_AGENT_OWNS_COMPUTE && !root\._agentOptimizationQueueTimer\)/);
});

test('dashboard hides local recalculate buttons when agent owns computation',()=>{
 assert.match(screen,/SCHEDULING_AGENT_OWNS_COMPUTE \? '<span class="course-scheduling-agent-compute">/);
 assert.match(screen,/עדכון ההמלצות מנוהל בנפרד/);
 assert.match(screen,/loadSharedPlanningDisplayWorkspace/);
});
