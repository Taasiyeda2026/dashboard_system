import { state } from './state.js';

export const SCREEN_CACHE_STORAGE_PREFIX = 'ds_screen_cache_v2';

const PERSIST_BLOCKED_PREFIXES = [
  'activityDetail:'
];
const PERSIST_MAX_BYTES = 100 * 1024; // 100 KB

function storageKey() {
  const uid = state.user?.user_id || 'anon';
  return `${SCREEN_CACHE_STORAGE_PREFIX}:${uid}`;
}

export function persistCacheEntry(key, entry) {
  if (PERSIST_BLOCKED_PREFIXES.some((p) => key.startsWith(p))) return;
  try {
    const serialized = JSON.stringify(entry);
    if (serialized.length > PERSIST_MAX_BYTES) return;
    const raw = localStorage.getItem(storageKey());
    const stored = raw ? JSON.parse(raw) : {};
    stored[key] = entry;
    localStorage.setItem(storageKey(), JSON.stringify(stored));
  } catch { /* quota or serialization error — silently ignore */ }
}


function removeFromStorage(mutator) {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return [];
    const removed = [];
    Object.keys(stored).forEach((key) => {
      if (mutator(key)) {
        delete stored[key];
        removed.push(key);
      }
    });
    localStorage.setItem(storageKey(), JSON.stringify(stored));
    return removed;
  } catch {
    return [];
  }
}

export function deletePersistedCacheEntry(key) {
  const cacheKey = String(key || '');
  if (!cacheKey) return false;
  return removeFromStorage((storedKey) => storedKey === cacheKey).length > 0;
}

export function deletePersistedCacheByPrefixes(prefixes = []) {
  const safePrefixes = (Array.isArray(prefixes) ? prefixes : [])
    .map((p) => String(p || ''))
    .filter(Boolean);
  if (!safePrefixes.length) return [];
  return removeFromStorage((key) => safePrefixes.some((prefix) => key === prefix || key.startsWith(prefix)));
}
