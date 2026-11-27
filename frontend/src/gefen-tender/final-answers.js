/** Final-answer approval helpers with non-restorable approval tokens. */

export function answerText(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

export function normalizeFinalEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { text: entry, token: null, approved_at: null, legacy: true };
  }
  if (typeof entry === 'object' && entry.text != null) {
    return {
      text: String(entry.text),
      token: entry.token ? String(entry.token) : null,
      approved_at: entry.approved_at || null,
      legacy: Boolean(entry.legacy)
    };
  }
  return null;
}

export function isFinalAnswer(finalAnswers, key, currentValue) {
  const current = answerText(currentValue).trim();
  if (!current) return false;
  const entry = normalizeFinalEntry(finalAnswers?.[key]);
  if (!entry) return false;
  if (entry.text !== current) return false;
  // Legacy string approvals are treated as approved only while text still matches,
  // but any edit clears them. Restoring old text without a token does NOT re-approve
  // once the server rewrites entries to tokenized form.
  if (entry.legacy) return true;
  return Boolean(entry.token);
}

export function createApprovalToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function approveAnswer(finalAnswers, key, value) {
  const text = answerText(value).trim();
  if (!text) return { ...(finalAnswers || {}) };
  return {
    ...(finalAnswers || {}),
    [key]: {
      text,
      token: createApprovalToken(),
      approved_at: new Date().toISOString(),
      legacy: false
    }
  };
}

export function revokeAnswer(finalAnswers, key) {
  const next = { ...(finalAnswers || {}) };
  delete next[key];
  return next;
}

/**
 * Keep only approvals whose text still matches the current draft AND that have a token
 * (or are still legacy and match). Any mismatch is dropped so restored old text cannot
 * revive a cleared approval.
 */
export function reconcileFinalAnswers(finalAnswers, currentByKey) {
  const out = {};
  for (const [key, raw] of Object.entries(finalAnswers || {})) {
    const entry = normalizeFinalEntry(raw);
    if (!entry) continue;
    const current = answerText(currentByKey.get(key)).trim();
    if (!current || current !== entry.text) continue;
    if (entry.legacy) {
      // Upgrade legacy match to a fresh token so a later edit+restore cannot revive it
      // after the next save cycle clears it.
      out[key] = {
        text: entry.text,
        token: createApprovalToken(),
        approved_at: entry.approved_at || new Date().toISOString(),
        legacy: false
      };
      continue;
    }
    if (!entry.token) continue;
    out[key] = entry;
  }
  return out;
}

export function withinLimit(value, limit) {
  if (!limit) return true;
  return answerText(value).length <= limit;
}
