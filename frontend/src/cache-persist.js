import { state } from './state.js';

export const SCREEN_CACHE_STORAGE_PREFIX = 'ds_screen_cache_v1';

function storageKey() {
  const uid = state.user?.user_id || 'anon';
  return `${SCREEN_CACHE_STORAGE_PREFIX}:${uid}`;
}

export function persistCacheEntry(key, entry) {
  try {
    const raw = localStorage.getItem(storageKey());
    const stored = raw ? JSON.parse(raw) : {};
    stored[key] = entry;
    localStorage.setItem(storageKey(), JSON.stringify(stored));
  } catch { /* quota or serialization error — silently ignore */ }
}
