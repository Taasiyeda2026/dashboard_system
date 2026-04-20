/** Short-lived CacheService entries for heavy read-only payloads (invalidated on writes). */

var SCRIPT_CACHE_KEY_DASHBOARD = 'pc:dashboard:v2';
var SCRIPT_CACHE_KEY_PERMISSIONS_LIST = 'pc:permissions:v2';
var SCRIPT_CACHE_KEY_DATA_VIEWS_VERSION = 'pc:data-views-version:v1';

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
    c.put(SCRIPT_CACHE_KEY_DATA_VIEWS_VERSION, fresh, 21600);
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
      21600
    );
  } catch (e) {}
}
