const MAX_BYTES = 2 * 1024 * 1024;
export function serializeSchedulingCacheEntry(entry) {
  let serialized = JSON.stringify(entry);
  if (new TextEncoder().encode(serialized).length > MAX_BYTES) {
    const { _planningShared, ...source } = entry.data;
    serialized = JSON.stringify({ ...entry, data: source });
  }
  return new TextEncoder().encode(serialized).length <= MAX_BYTES ? serialized : null;
}
