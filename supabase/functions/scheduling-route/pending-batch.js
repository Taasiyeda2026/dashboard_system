// Advance through the original list: filtering before applying the cursor would
// skip missing routes after successful writes shrink the pending set.
export function selectPendingRouteBatch(pairs, offset, limit, isUsable) {
  const pending = [];
  let nextOffset = Math.max(0, offset);
  let skipped = 0;
  while (nextOffset < pairs.length) {
    const pair = pairs[nextOffset];
    if (!isUsable(pair)) {
      if (pending.length >= limit) break;
      pending.push(pair);
    } else skipped += 1;
    nextOffset += 1;
  }
  return { pending, nextOffset, skipped };
}
