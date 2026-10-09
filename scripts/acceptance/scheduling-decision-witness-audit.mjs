import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const dir=process.env.DECISION_DIR,run=promisify(execFile),search=JSON.parse(await readFile(dir+'/alternative-search.json','utf8')),results=[];
for(const candidate of search.results.filter(x=>x.legalAlternative)){
 const file='audit-'+candidate.courseId+'.json';
 await run(process.execPath,['scripts/acceptance/scheduling-decision-audit.mjs'],{env:{...process.env,DECISION_PLAN:dir+'/witness-'+candidate.courseId+'.json',DECISION_AUDIT_FILE:file}});
 const audit=JSON.parse(await readFile(dir+'/'+file,'utf8'));
 results.push({courseId:candidate.courseId,coverageDelta:candidate.coverageDelta,internalValidation:candidate.validation.valid,generatedViolations:audit.summary.generatedViolations,counts:audit.summary.counts,independentNewAssignmentsPass:audit.summary.generatedViolations===0});
}
await writeFile(dir+'/independent-witness-results.json',JSON.stringify({scope:'Each witness is a separate +1 experiment on the cleaned tentative base. Existing protected findings remain; not simultaneous improvements or a global optimum proof.',results},null,2));
console.log(JSON.stringify({checked:results.length,independentPass:results.filter(x=>x.independentNewAssignmentsPass).length}));
