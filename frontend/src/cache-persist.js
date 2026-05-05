import { state } from './state.js';

export const SCREEN_CACHE_STORAGE_PREFIX = 'ds_screen_cache_v1';

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
