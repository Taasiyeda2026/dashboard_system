/** Short-lived CacheService entries for heavy read-only payloads (invalidated on writes). */

var SCRIPT_CACHE_KEY_DASHBOARD = 'pc:dashboard:v1';
var SCRIPT_CACHE_KEY_PERMISSIONS_LIST = 'pc:permissions:v2';

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
      return;
    }
    var ttl = seconds || (CONFIG.SCRIPT_CACHE_SECONDS || 90);
    CacheService.getScriptCache().put(key, payload, ttl);
  } catch (e) {}
}

function scriptCacheInvalidateDataViews_() {
  try {
    var c = CacheService.getScriptCache();
    c.remove(SCRIPT_CACHE_KEY_DASHBOARD);
    c.remove(SCRIPT_CACHE_KEY_PERMISSIONS_LIST);
  } catch (e) {}
}
