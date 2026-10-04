const COUNTER_KEYS = [
  'preliminaryCalls',
  'scheduleCalls',
  'activitiesComputed',
  'candidateEvals',
  'candidateEvaluations',
  'instructorScans',
  'scenarioCount',
  'scenarioEvaluations',
  'travelRequests',
  'routeCacheRequests',
  'cacheHits',
  'googleCalls',
  'finalValidations',
  'contextRebuilds',
  'progressUiUpdates',
  'checkpointSaves',
  'checkpointPayloadBytes'
];

let explicitEnabled = null;
let report = null;

function browserFlagEnabled() {
  try {
    if (typeof location === 'undefined') return false;
    return new URLSearchParams(location.search || '').get('planningPerf') === '1';
  } catch {
    return false;
  }
}

function enabled() {
  if (explicitEnabled != null) return explicitEnabled === true;
  return globalThis.__TAASIYEDA_PLANNING_PERF__ === true || browserFlagEnabled();
}

function freshReport(label = '') {
  return {
    label: String(label || ''),
    startedAt: Date.now(),
    finishedAt: null,
    counters: Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])),
    timers: {},
    events: []
  };
}

function ensureReport() {
  if (!report) report = freshReport();
  return report;
}

export function setPlanningPerfEnabled(value) {
  explicitEnabled = value == null ? null : value === true;
  if (explicitEnabled === true && !report) report = freshReport();
}

export function resetPlanningPerfReport(label = '') {
  report = freshReport(label);
  return report;
}

export function planningPerfCount(key, amount = 1) {
  if (!enabled()) return;
  const current = ensureReport();
  if (!Object.prototype.hasOwnProperty.call(current.counters, key)) current.counters[key] = 0;
  current.counters[key] += Number(amount) || 0;
}

export function planningPerfEvent(name, detail = {}) {
  if (!enabled()) return;
  const current = ensureReport();
  current.events.push({ name: String(name || ''), atMs: Date.now() - current.startedAt, ...detail });
}

export function planningPerfTimer(name) {
  if (!enabled()) return () => 0;
  const started = performance?.now?.() ?? Date.now();
  return () => {
    const ended = performance?.now?.() ?? Date.now();
    const elapsed = Math.max(0, ended - started);
    const current = ensureReport();
    const timer = current.timers[name] ||= { calls: 0, totalMs: 0, maxMs: 0 };
    timer.calls += 1;
    timer.totalMs += elapsed;
    timer.maxMs = Math.max(timer.maxMs, elapsed);
    return elapsed;
  };
}

export function planningPerfSnapshot() {
  const current = report || freshReport();
  return JSON.parse(JSON.stringify(current));
}

export function flushPlanningPerfReport({ log = true } = {}) {
  const current = ensureReport();
  current.finishedAt = Date.now();
  const snapshot = planningPerfSnapshot();
  if (log && enabled()) {
    console.info('[planning-perf]', JSON.stringify(snapshot));
  }
  return snapshot;
}
