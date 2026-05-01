/**
 * Lightweight ops rollup in ScriptCache (no PII). Updated rarely: full read-model batch,
 * ~2% sampled read-cache / duration, ~5% sampled snapshot fallback signals.
 */
var SCRIPT_CACHE_KEY_OPS_HEALTH_ROLLUP_ = 'pc:ops-health-rollup:v1';
var OPS_HEALTH_ROLLUP_TTL_SEC_ = 21600;
var OPS_HEALTH_MAX_COUNTERS_ = 1000000;

function opsHealthMergeRollup_(mutator) {
  try {
    var c = CacheService.getScriptCache();
    var raw = c.get(SCRIPT_CACHE_KEY_OPS_HEALTH_ROLLUP_);
    var state = raw ? parseJsonObject_(raw, {}) : {};
    if (!state || typeof state !== 'object') state = {};
    state.v = 1;
    mutator(state);
    c.put(SCRIPT_CACHE_KEY_OPS_HEALTH_ROLLUP_, JSON.stringify(state), OPS_HEALTH_ROLLUP_TTL_SEC_);
  } catch (_e) {}
}

function opsHealthRecordReadModelBatchComplete_(refreshedAtIso, durationMs, failureCount) {
  var at = text_(refreshedAtIso || '');
  var dur = Math.max(0, Math.round(Number(durationMs) || 0));
  var fc = Math.max(0, Math.round(Number(failureCount) || 0));
  opsHealthMergeRollup_(function(s) {
    s.last_read_model_refresh_at = at;
    s.last_read_model_duration_ms = dur;
    s.last_read_model_failure_count = fc;
  });
}

/**
 * Probabilistic (~2%) so routine traffic stays cheap.
 */
function opsHealthMaybeSampleReadPath_(cacheHit, durationMs) {
  if (Math.random() > 0.02) return;
  var hit = !!cacheHit;
  var d = Math.max(0, Math.round(Number(durationMs) || 0));
  opsHealthMergeRollup_(function(s) {
    if (hit) {
      s.read_cache_hits = Math.min(OPS_HEALTH_MAX_COUNTERS_, (Number(s.read_cache_hits) || 0) + 1);
    } else {
      s.read_cache_misses = Math.min(OPS_HEALTH_MAX_COUNTERS_, (Number(s.read_cache_misses) || 0) + 1);
    }
    s.read_duration_sum_ms = Math.min(
      OPS_HEALTH_MAX_COUNTERS_,
      (Number(s.read_duration_sum_ms) || 0) + d
    );
    s.read_duration_samples = Math.min(OPS_HEALTH_MAX_COUNTERS_, (Number(s.read_duration_samples) || 0) + 1);
  });
}

/**
 * Probabilistic (~5%) snapshot-path fallback estimate (dashboard snapshot + activities list).
 */
function opsHealthMaybeSampleSnapshotFallback_(action, readData) {
  if (Math.random() > 0.05) return;
  if (!readData || typeof readData !== 'object') return;
  var fb = false;
  if (text_(action) === 'dashboardSnapshot') {
    fb = readData._is_snapshot === false;
  } else if (text_(action) === 'activities') {
    fb = !!readData._activities_fallback_used;
  } else {
    return;
  }
  opsHealthMergeRollup_(function(s) {
    s.snapshot_total = Math.min(OPS_HEALTH_MAX_COUNTERS_, (Number(s.snapshot_total) || 0) + 1);
    if (fb) {
      s.snapshot_fallback_hits = Math.min(OPS_HEALTH_MAX_COUNTERS_, (Number(s.snapshot_fallback_hits) || 0) + 1);
    }
  });
}

function opsHealthAfterReadResponse_(action, scriptCacheHit, readData) {
  var a = text_(action);
  if (a === 'health_check' || a === 'readModelHealth') return;
  try {
    var elapsed =
      typeof __rqPerf_ === 'object' && __rqPerf_ && __rqPerf_.started_ms
        ? Math.max(0, perfNowMs_() - __rqPerf_.started_ms)
        : 0;
    opsHealthMaybeSampleReadPath_(!!scriptCacheHit, elapsed);
    opsHealthMaybeSampleSnapshotFallback_(a, readData);
  } catch (_e) {}
}

function actionHealthCheck_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager']);
  var raw = scriptCacheGetJson_(SCRIPT_CACHE_KEY_OPS_HEALTH_ROLLUP_) || {};
  var hits = Number(raw.read_cache_hits) || 0;
  var misses = Number(raw.read_cache_misses) || 0;
  var total = hits + misses;
  var dsum = Number(raw.read_duration_sum_ms) || 0;
  var dcnt = Number(raw.read_duration_samples) || 0;
  var snapTot = Number(raw.snapshot_total) || 0;
  var snapFb = Number(raw.snapshot_fallback_hits) || 0;
  var at = raw.last_read_model_refresh_at ? text_(raw.last_read_model_refresh_at) : null;
  var lrmDur =
    raw.last_read_model_duration_ms !== undefined && raw.last_read_model_duration_ms !== null
      ? Math.round(Number(raw.last_read_model_duration_ms))
      : null;
  var lrmFc =
    raw.last_read_model_failure_count !== undefined && raw.last_read_model_failure_count !== null
      ? Math.round(Number(raw.last_read_model_failure_count))
      : null;

  return {
    last_read_model_refresh: {
      at: at || null,
      duration_ms: lrmDur,
      failure_count: lrmFc
    },
    cache_hit_ratio: total > 0 ? Math.round((hits / total) * 1000) / 1000 : null,
    avg_action_duration_ms: dcnt > 0 ? Math.round(dsum / dcnt) : null,
    snapshot_fallback_rate: snapTot > 0 ? Math.round((snapFb / snapTot) * 1000) / 1000 : null,
    samples: {
      read_cache_events: total,
      duration_events: dcnt,
      snapshot_events: snapTot
    }
  };
}
