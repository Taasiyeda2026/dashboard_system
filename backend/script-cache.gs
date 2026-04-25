/** Short-lived CacheService entries for heavy read-only payloads (invalidated on writes). */

var SCRIPT_CACHE_KEY_DASHBOARD = 'pc:dashboard:v2';
var SCRIPT_CACHE_KEY_PERMISSIONS_LIST = 'pc:permissions:v2';
var SCRIPT_CACHE_KEY_DATA_VIEWS_VERSION = 'pc:data-views-version:v1';
var SCRIPT_CACHE_KEY_DEBUG_STATS = 'pc:cache-debug:stats:v1';

function scriptCacheGetJson_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function scriptCachePutJson_(key, value, seconds) {
  try {
    var payload = JSON.stringify(value);
    if (payload.length > 95000) {
      scriptCacheDebugMark_('skip_too_large', key, payload.length);
      return { ok: false, reason: 'too_large', bytes: payload.length };
    }
    var ttl = seconds || (CONFIG.SCRIPT_CACHE_SECONDS || 90);
    CacheService.getScriptCache().put(key, payload, ttl);
    return { ok: true, bytes: payload.length };
  } catch (e) {
    scriptCacheDebugMark_('put_error', key, 0, String(e && e.message ? e.message : e));
    return { ok: false, reason: 'exception' };
  }
}

function scriptCacheDebugMark_(eventName, key, bytes, errorText) {
  try {
    var payload = {
      event: text_(eventName),
      key: text_(key),
      bytes: Number(bytes) || 0,
      error: text_(errorText || ''),
      at: new Date().toISOString()
    };
    console.warn('[script-cache]', JSON.stringify(payload));
    var c = CacheService.getScriptCache();
    var raw = c.get(SCRIPT_CACHE_KEY_DEBUG_STATS);
    var stats = raw ? JSON.parse(raw) : {};
    var n = (Number(stats[eventName]) || 0) + 1;
    stats[eventName] = n;
    stats.last = payload;
    c.put(SCRIPT_CACHE_KEY_DEBUG_STATS, JSON.stringify(stats), 21600);
  } catch (e) {}
}

function debugScriptCacheLoaded_() {
  Logger.log('typeof scriptCacheDebugMark_ = ' + typeof scriptCacheDebugMark_);
}

function scriptCacheInvalidateDataViews_() {
  try {
    var c = CacheService.getScriptCache();
    bumpDataViewsCacheVersion_();
    c.remove(SCRIPT_CACHE_KEY_DASHBOARD);
    c.remove(SCRIPT_CACHE_KEY_PERMISSIONS_LIST);
  } catch (e) {}
}

function dataViewsCacheVersion_() {
  try {
    var c = CacheService.getScriptCache();
    var existing = c.get(SCRIPT_CACHE_KEY_DATA_VIEWS_VERSION);
    if (existing) return existing;
    var fresh = String(new Date().getTime());
    // Short TTL so manual edits directly in Sheets won't stay stale for hours.
    c.put(SCRIPT_CACHE_KEY_DATA_VIEWS_VERSION, fresh, 600);
    return fresh;
  } catch (e) {
    return '0';
  }
}

function bumpDataViewsCacheVersion_() {
  try {
    CacheService.getScriptCache().put(
      SCRIPT_CACHE_KEY_DATA_VIEWS_VERSION,
      String(new Date().getTime()),
      600
    );
  } catch (e) {}
}
