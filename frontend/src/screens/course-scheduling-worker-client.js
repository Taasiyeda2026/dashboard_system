import { POINT_SNAPSHOT_FIELDS, planningWorkerError, applyPlanningRowPatches, planningRouteReply, planningCloneError } from './course-scheduling-worker-protocol.js';

const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0));
export class SchedulingPointWorker {
  constructor({ createWorker = () => new Worker(new URL('./course-scheduling-point.worker.js', import.meta.url), {type:'module',name:'scheduling-point'}), yieldControl = yieldUi } = {}) {
    this.createWorker = createWorker; this.yieldControl = yieldControl;
    this.worker = null; this.sequence = 0; this.pending = new Map(); this.signatures = new Map(); this.owner = ''; this.tail = Promise.resolve(); this.snapshotVersion = ''; this.snapshotRoots = new Map(); this.readonlyHashes = new WeakMap(); this.readonlyNodes = new WeakSet();
    this.metrics = { snapshots:0, changedEntries:0, messages:0, maxPostMs:0, runs:0, progressMessages:0 };
  }
  dispose(code = 'planning_worker_failed') {
    this.worker?.terminate(); this.worker = null; this.signatures.clear(); this.snapshotRoots.clear(); this.snapshotVersion = ''; this.readonlyHashes = new WeakMap(); this.readonlyNodes = new WeakSet(); this.owner = '';
    for (const task of this.pending.values()) { clearTimeout(task.timeout); task.reject(code instanceof Error ? code : planningWorkerError(code)); }
    this.pending.clear();
  }
  ensureWorker(owner) {
    if (this.worker && this.owner !== owner) this.dispose('planning_cancelled');
    if (this.worker) return;
    try { this.worker = this.createWorker(); } catch { throw planningWorkerError('planning_worker_unavailable'); }
    this.owner = owner;
    this.worker.onerror = () => this.dispose('planning_worker_failed');
    this.worker.onmessageerror = () => this.dispose('planning_worker_protocol_error');
    this.worker.onmessage = ({data}) => this.receive(data);
  }
  post(message) {
    const start = performance.now();
    try { this.worker.postMessage(message); } catch (error) { throw planningCloneError(error, message); }
    this.metrics.maxPostMs = Math.max(this.metrics.maxPostMs, performance.now()-start); this.metrics.messages++;
  }
  request(type, body = {}, hooks = {}) {
    const id = ++this.sequence;
    return new Promise((resolve,reject) => {
      const timeout = setTimeout(()=>this.dispose('planning_worker_timeout'), ['run','run-national'].includes(type)?10*60*1000:15000);
      this.pending.set(id,{resolve,reject,timeout,...hooks});
      try { this.post({id,type,...body}); } catch (error) { this.dispose(error); }
    });
  }
  async receive(data) {
    const task = this.pending.get(data.id); if (!task) return;
    try {
      task.assertActive?.();
      if (data.type === 'route') {
        try {
          const value = await task.routeInvoke(data.body); task.assertActive?.();
          if (this.pending.has(data.id)) this.post({type:'route-result',runId:data.id,routeId:data.routeId,value:planningRouteReply(value)});
        } catch (error) {
          if (error.code === 'planning_worker_data_clone_failed') { this.dispose(error); return; }
          if (this.pending.has(data.id)) this.post({type:'route-result',runId:data.id,routeId:data.routeId,error:typeof error.code === 'string' ? error.code : 'route_lookup_failed', message:error.message}); }
        return;
      }
      if (data.type === 'heartbeat') { await task.checkpoint?.(); return; }
      if (data.type === 'progress') { this.metrics.progressMessages++; task.progressQueue = (task.progressQueue || Promise.resolve()).then(() => task.onProgress?.(data.progress)); await task.progressQueue; return; }
      await task.progressQueue;
      this.pending.delete(data.id); clearTimeout(task.timeout);
      if (task.cancelled) task.reject(planningWorkerError('planning_cancelled'));
      else if (data.error) task.reject(planningWorkerError(data.error,{failures:data.failures}));
      else task.resolve(data);
    } catch (error) { this.dispose(error); }
  }
  async freezeReadonlyData(item, signal, assertActive) {
    const stack = [item], nodes = [], seen = new WeakSet(); let deadline = performance.now()+6;
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || seen.has(value) || this.readonlyNodes.has(value)) continue;
      const proto = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
      seen.add(value); nodes.push(value); for (const child of Object.values(value)) stack.push(child);
      if (performance.now()>deadline) { if(signal?.aborted)throw planningWorkerError('planning_cancelled');assertActive?.();await this.yieldControl();deadline=performance.now()+6; }
    }
    for (const value of nodes.reverse()) {
      Object.freeze(value); this.readonlyNodes.add(value);
      if (performance.now()>deadline) { if(signal?.aborted)throw planningWorkerError('planning_cancelled');assertActive?.();await this.yieldControl();deadline=performance.now()+6; }
    }
    return true;
  }
  async sync(input, version, signal, assertActive) {
    const next = new Map(); const nextRoots = new Map(); const hashCache = new Map();
    await this.request('snapshot-begin',{version});
    let deadline = performance.now()+6;
    for (const field of POINT_SNAPSHOT_FIELDS) {
      const value = input[field] || (['profiles','rules','exceptions','lockedOptions'].includes(field)?{}:[]);
      nextRoots.set(field,value);
      const priorRoot = this.snapshotRoots.get(field);
      // The caller's version includes authoritative source/workspace revisions
      // and input fingerprints. Identical roots at that version are unchanged.
      if (version === this.snapshotVersion && this.signatures.has(field)
        && (value === priorRoot || (Array.isArray(value) && !value.length && Array.isArray(priorRoot) && !priorRoot.length))) {
        next.set(field,this.signatures.get(field)); continue;
      }
      if (field === 'committedRows' && value === input.existingRows) {
        await this.request('snapshot-alias',{version,field,targetField:'existingRows'});
        next.set(field,next.get('existingRows')); continue;
      }
      const kind = Array.isArray(value)?'array':'object';
      const entries = kind==='array'?value.map((v,i)=>[String(i),v]):Object.entries(value);
      const old = this.signatures.get(field) || new Map(), hashes = new Map(), changes = [];
      for (const [key, item] of entries) {
        if (signal?.aborted) throw planningWorkerError('planning_cancelled'); assertActive?.();
        const object = item && typeof item === 'object';
        const readonly = object && ['existingRows','committedRows','routeRows'].includes(field);
        let hash = readonly ? this.readonlyHashes.get(item) : undefined;
        if (hash === undefined && object) hash = hashCache.get(item);
        if (hash === undefined) {
          // Only immutable planning/cache records can reuse serialized content
          // across revisions. Live activities, availability and profiles stay mutable.
          const immutable = readonly && await this.freezeReadonlyData(item,signal,assertActive);
          hash = JSON.stringify(item);
          if (object) hashCache.set(item,hash);
          if (immutable) this.readonlyHashes.set(item,hash);
        }
        hashes.set(key,hash); if (!old.has(key)||old.get(key)!==hash) changes.push([key,item]);
        if (performance.now()>deadline) { await this.yieldControl(); deadline=performance.now()+6; }
      }
      const remove = [...old.keys()].filter(key=>!hashes.has(key)); next.set(field,hashes);
      if (changes.length || remove.length || !this.signatures.has(field)) {
        // Bound clone bytes rather than entry count: routes are tiny, while
        // an individual planning row includes alternatives. Each acknowledgement
        // already yields to the browser; avoid an extra timer per message.
        let index = 0;
        do {
          if (signal?.aborted) throw planningWorkerError('planning_cancelled'); assertActive?.();
          const batch = []; let bytes = 0;
          while (index < changes.length && bytes < 64 * 1024) {
            const entry = changes[index++]; batch.push(entry);
            bytes += (hashes.get(entry[0])?.length || 0) * 2;
          }
          await this.request('snapshot-patch',{version,field,kind,entries:batch,remove:index===batch.length?remove:[]});
          this.metrics.changedEntries+=batch.length;
        } while (index < changes.length);
      }
    }
    if (signal?.aborted) throw planningWorkerError('planning_cancelled'); assertActive?.();
    await this.request('snapshot-commit',{version}); this.signatures=next; this.snapshotRoots=nextRoots; this.snapshotVersion=version; this.metrics.snapshots++;
  }
  run(input, hooks = {}) { return this.runScoped(input, hooks, false); }
  runNational(input, hooks = {}) { return this.runScoped(input, hooks, true); }
  runScoped(input, { owner, version, routeRows = [], routeInvoke, signal, assertActive, checkpoint, onProgress, perf = false } = {}, national = false) {
    if (!owner || !version || (!national && (!Array.isArray(input.targetCourseIds) || !input.targetCourseIds.length || input.allowGlobalRepair === true))) return Promise.reject(planningWorkerError('planning_worker_scope_required'));
    const execute = async () => {
      if (signal?.aborted) throw planningWorkerError('planning_cancelled');
      this.ensureWorker(owner);
      let abortTimer;
      const abort = () => {
        for (const [id,task] of this.pending) if (task.run) { task.cancelled=true; this.post({type:'cancel',runId:id}); }
        abortTimer=setTimeout(()=>this.dispose('planning_cancelled'),500);
      };
      signal?.addEventListener('abort',abort,{once:true});
      try {
        await this.sync({...input,routeRows},version,signal,assertActive);
        const options={};for(const [key,value] of Object.entries(input))if(!POINT_SNAPSHOT_FIELDS.includes(key)&&!['routeClient','constraintContext','signal','checkpoint','onProgress'].includes(key)&&typeof value!=='function')options[key]=value;
        options.allowGlobalRepair = national ? input.allowGlobalRepair !== false : false; options._nationalRun = national; this.metrics.runs++;
        const response = await this.request(national ? 'run-national' : 'run',{version,options,perf},{run:true,routeInvoke,assertActive,checkpoint,onProgress});
        if (signal?.aborted) throw planningWorkerError('planning_cancelled'); assertActive?.();
        if (response.version!==version || response.summary?.finalPlanValidation?.valid!==true) throw planningWorkerError('planning_worker_revision_conflict');
        this.lastRunMetrics=response.metrics;
        return {...response.summary,rows:applyPlanningRowPatches(response.delta,input.existingRows||[])};
      } catch(error) { this.dispose(error.code||'planning_worker_failed'); throw error; }
      finally { clearTimeout(abortTimer); signal?.removeEventListener('abort',abort); }
    };
    const result=this.tail.catch(()=>{}).then(execute);this.tail=result.catch(()=>{});return result;
  }
}
export const schedulingPointWorker = new SchedulingPointWorker();
