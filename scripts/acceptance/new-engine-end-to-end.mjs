// One sequential isolated pipeline: national calculation -> independent audit -> SQL commit/reload.
// No external requests or production credentials; SQL helpers target only the disposable loopback database.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve(process.env.ACCEPTANCE_OUT || '');
assert.ok(process.env.ACCEPTANCE_OUT && process.env.DECISION_DIR,'Isolated input/output directories required');
await mkdir(out,{recursive:true});const steps=[];
async function run(file,extra={}) {const at=performance.now();const log=execFileSync(process.execPath,['scripts/acceptance/'+file+'.mjs'],{env:{...process.env,...extra},encoding:'utf8',maxBuffer:16*1024*1024});await writeFile(out+'/'+file+'.log',log);steps.push({step:file,pass:true,elapsedMs:performance.now()-at});}
await run('new-engine-national');
const plan=JSON.parse(await readFile(out+'/national-plan.json','utf8'));assert.equal(plan.finalPlanValidation.valid,true);assert.equal(plan.rows.length,253);
await run('new-engine-audit',{DECISION_PLAN:out+'/national-plan.json',DECISION_AUDIT_PATH:out+'/independent-audit.json'});
const audit=JSON.parse(await readFile(out+'/independent-audit.json','utf8'));assert.equal(audit.summary.generatedViolations,0,'Independent audit must find zero new hard-constraint violations');
await run('new-engine-postgres-bootstrap');await run('new-engine-postgres-seed');await run('new-engine-save');
const sql=JSON.parse(await readFile(out+'/sql-acceptance.json','utf8'));assert.ok(sql.results.every(r=>r.pass));assert.equal(sql.results[0].rows,253);
const metrics=JSON.parse(await readFile(out+'/national-metrics.json','utf8'));
await writeFile(out+'/end-to-end.json',JSON.stringify({pass:true,steps,metrics,independentAudit:audit.summary,sqlCases:sql.results.length,saveAndReload:sql.results[0],scope:'Actual new national engine, independent arithmetic audit, actual local PostgreSQL trusted RPC commit and reload; modeled identities, not a Supabase Auth/browser test; historic protected findings unchanged and explicit'},null,2));
console.log(JSON.stringify({pass:true,assigned:metrics.assigned,rows:plan.rows.length,nationalMs:metrics.elapsedMs,generatedViolations:audit.summary.generatedViolations,sqlCases:sql.results.length}));
