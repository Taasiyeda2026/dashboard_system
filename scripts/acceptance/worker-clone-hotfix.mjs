// Manual browser acceptance, anonymous inputs, no production access or writes.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {decisionInput} from './new-engine-input.mjs';
const {input,routes}=await decisionInput(process.env.DECISION_DIR);
input.allowGlobalRepair=true;input.skipSoftOptimization=false;
const old=await readFile(process.env.BEFORE_CLIENT,'utf8');
const server=await createServer({server:{host:'127.0.0.1',port:5187},plugins:[{name:'acceptance-only',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/acceptance-input'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({input,routes}));}else if(req.url==='/before-client.js'){res.setHeader('Content-Type','application/javascript');res.end(old.replace("'./course-scheduling-worker-protocol.js'","'/frontend/src/screens/course-scheduling-worker-protocol.js'"));}else next();});}}]});
await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:5187');
 const result=await page.evaluate(async()=>{
  const {SchedulingPointWorker:Before}=await import('/before-client.js');
  const {SchedulingPointWorker:After}=await import('/frontend/src/screens/course-scheduling-worker-client.js');
  const {FunctionsHttpError}=await import('/node_modules/@supabase/functions-js/dist/module/types.js');
  const {planningStoreErrorMessage}=await import('/frontend/src/screens/course-scheduling-planning-store.js');
  const routeValue=()=>({data:null,error:new FunctionsHttpError(new Response('isolated unavailable',{status:503})),response:new Response('isolated unavailable',{status:503})});
  // Exercise the real client's incoming route boundary with native browser clone.
  async function boundary(Client){let client;const worker={terminate(){},postMessage(message){structuredClone(message);if(message.type==='run-national')queueMicrotask(()=>client.receive({id:message.id,type:'route',routeId:1,body:{}}));else if(message.type==='route-result')queueMicrotask(()=>client.receive({id:message.runId,...(message.error?{error:message.error}:{ok:true})}));}};client=new Client({createWorker:()=>worker});client.ensureWorker('isolated');try{return await client.request('run-national',{}, {routeInvoke:async()=>routeValue()});}catch(e){return {error:e.code,message:e.message};}finally{client.dispose();}}
  const before=await boundary(Before),after=await boundary(After);
  const nested=new After({createWorker:()=>({terminate(){},postMessage:m=>structuredClone(m)})});nested.ensureWorker('isolated');let nestedError;try{await nested.request('snapshot-patch',{entries:[['0',{deep:{callback(){}}}]]});}catch(e){nestedError={code:e.code,path:e.transportPath,message:planningStoreErrorMessage(e)};}finally{nested.dispose();}
  const {input,routes}=await (await fetch('/acceptance-input')).json();const original=JSON.stringify(input);const client=new After();let routeCalls=0,progress=0;const at=performance.now();
  try{const plan=await client.runNational(input,{owner:'isolated-admin',version:'isolated-v37-clone-hotfix',routeRows:routes,routeInvoke:async()=>{routeCalls++;return routeValue();},onProgress:()=>{progress++;}});return {before,after,nestedError,elapsedMs:performance.now()-at,routeCalls,progress,sourceUnchanged:original===JSON.stringify(input),plan};}finally{client.dispose();}
 });
 assert.equal(result.before.error,25);assert.equal(result.before.message,'25');assert.equal(result.after.ok,true);assert.equal(result.nestedError.code,'planning_worker_data_clone_failed');assert.match(result.nestedError.path,/deep.callback/);assert.equal(result.sourceUnchanged,true);assert.equal(result.plan.finalPlanValidation.valid,true);
 await writeFile(process.env.ACCEPTANCE_OUT+'/national-plan.json',JSON.stringify(result.plan));const {plan,...metrics}=result;metrics.rows=plan.rows.length;metrics.assigned=plan.rows.filter(r=>r.instructorEmpId).length;metrics.finalValidation=plan.finalPlanValidation;metrics.engineMetrics=plan.newEngineMetrics;await writeFile(process.env.ACCEPTANCE_OUT+'/browser-clone.json',JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
} finally {await browser.close();await server.close();}
