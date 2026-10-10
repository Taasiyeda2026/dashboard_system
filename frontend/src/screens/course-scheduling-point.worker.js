import { compileConstraints } from './scheduling-core/constraints.js';
import { buildDynamicCoursePlan, createPlanningCheckpoint } from './course-scheduling-planning.js';
import { createRouteClient } from './course-scheduling-travel.js';
import { planningRowPatches, planningWorkerError } from './course-scheduling-worker-protocol.js';
import { setPlanningPerfEnabled, resetPlanningPerfReport, flushPlanningPerfReport } from './course-scheduling-perf.js';

let compiledContext = null;
const constraintFields = new Set(['activities','instructors','profiles','rules','exceptions','schoolCalendar']);
let version = '', fields = new Map(), staging = null, active = null, routeSequence = 0;
const routeWaiters = new Map();
const reply = (id, value = {}) => self.postMessage({ id, ...value });
self.onmessage = async ({ data: message }) => {
  const { id, type } = message;
  if (type === 'route-result') {
    const waiter = routeWaiters.get(message.routeId);
    if (!waiter || waiter.runId !== message.runId) return;
    routeWaiters.delete(message.routeId);
    if (message.error) waiter.reject(planningWorkerError(message.error, { message: message.message || message.error }));
    else waiter.resolve(message.value);
    return;
  }
  if (type === 'cancel') { if (active?.id === message.runId) active.controller.abort(); return; }
  try {
    if (active) throw planningWorkerError('planning_worker_busy');
    if (type === 'snapshot-begin') { staging = { version: message.version, fields: new Map(fields), constraintsDirty: !compiledContext }; reply(id); return; }
    if (type === 'snapshot-alias') {
      if (!staging || staging.version !== message.version || message.field !== 'committedRows' || message.targetField !== 'existingRows') throw planningWorkerError('planning_worker_revision_conflict');
      staging.fields.set(message.field, staging.fields.get(message.targetField)); reply(id); return;
    }
    if (type === 'snapshot-patch') {
      if (!staging || staging.version !== message.version) throw planningWorkerError('planning_worker_revision_conflict');
      if (constraintFields.has(message.field)) staging.constraintsDirty = true;
      const map = new Map(staging.fields.get(message.field)?.map || []);
      for (const key of message.remove) map.delete(key);
      for (const [key, value] of message.entries) map.set(key, value);
      staging.fields.set(message.field, { kind: message.kind, map }); reply(id); return;
    }
    if (type === 'snapshot-commit') {
      if (!staging || staging.version !== message.version) throw planningWorkerError('planning_worker_revision_conflict');
      fields = staging.fields; version = staging.version; if (staging.constraintsDirty) compiledContext = null; staging = null; reply(id); return;
    }
    if (!['run','run-national'].includes(type) || message.version !== version) throw planningWorkerError('planning_worker_revision_conflict');
    if (type === 'run' && (!Array.isArray(message.options.targetCourseIds) || !message.options.targetCourseIds.length || message.options.allowGlobalRepair !== false || message.options._nationalRun === true)) throw planningWorkerError('planning_worker_scope_required');
    const controller = new AbortController(); active = { id, controller };
    const input = {};
    for (const [field, {kind, map}] of fields) input[field] = kind === 'array' ? [...map].sort(([a],[b])=>Number(a)-Number(b)).map(([,value])=>value) : Object.fromEntries(map);
    const routeClient = createRouteClient({ preloadedRows: input.routeRows || [], signal: controller.signal, invoke: body => new Promise((resolve, reject) => {
      const routeId = ++routeSequence;
      routeWaiters.set(routeId, { runId: id, resolve, reject });
      reply(id, { type: 'route', routeId, body });
    }) });
    const cancelRoutes = () => { for (const [key, waiter] of routeWaiters) if (waiter.runId === id) { waiter.reject(planningWorkerError('planning_cancelled')); routeWaiters.delete(key); } };
    controller.signal.addEventListener('abort', cancelRoutes, { once: true });
    if (!compiledContext) compiledContext = compileConstraints(input);
    compiledContext.routeClient = routeClient;
    let lastProgress = -Infinity;
    const heartbeat = setInterval(() => reply(id, { type: 'heartbeat' }), 250);
    setPlanningPerfEnabled(message.perf === true); resetPlanningPerfReport('point-worker');
    const started = performance.now();
    try {
      const buildInput = { ...input, ...message.options, _nationalRun: type === 'run-national', constraintContext: compiledContext, routeClient, signal: controller.signal, checkpoint: createPlanningCheckpoint({ signal: controller.signal }), onProgress: progress => {
        const now = performance.now();
        if (type === 'run-national' && (progress.row || progress.snapshotRows)) {
          const provisional = row => row.kind === 'live' ? row : { ...row, validationState: 'provisional', status: 'הצעה בחישוב — טרם אומתה' };
          reply(id, { type: 'progress', progress: { ...progress, row: progress.row ? provisional(progress.row) : null, snapshotRows: progress.snapshotRows?.map(provisional) } });
          return;
        }
        if (now - lastProgress < 250) return;
        lastProgress = now;
        reply(id, { type: 'progress', progress: { phase: progress.phase, completed: progress.completed, total: progress.total } });
      } };
      const result = await buildDynamicCoursePlan(buildInput);
      if (controller.signal.aborted) throw planningWorkerError('planning_cancelled');
      if (result.finalPlanValidation?.valid !== true) throw planningWorkerError('planning_final_validation_failed');
      const { rows, ...summary } = result;
      const delta = planningRowPatches(rows, input.existingRows || []);
      reply(id, { type: 'result', version, summary, delta, metrics: { computeMs: performance.now()-started, perf: flushPlanningPerfReport({log:false}) } });
    } finally { clearInterval(heartbeat); cancelRoutes(); controller.signal.removeEventListener('abort', cancelRoutes); setPlanningPerfEnabled(false); active = null; }
  } catch (error) { reply(id, { error: error.code || 'planning_worker_failed', failures: (error.failures || []).slice(0, 50) }); }
};
