/**
 * Bound attendance travel requests so a stalled network call cannot lock the UI.
 * A timed-out write is NOT proof that the server did not save it.
 */
export class TravelRequestTimeoutError extends Error {
  constructor(action = 'הפעולה') {
    super(action + ' לא הסתיימה בזמן. בדקו את החיבור ונסו שוב.');
    this.name = 'TravelRequestTimeoutError';
  }
}

export async function withTravelDeadline(task, { timeoutMs = 12000, action = 'טעינת הנסיעות' } = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TravelRequestTimeoutError(action));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** A confirmation read must match the draft, not just find an older saved row. */
export function savedTravelMatchesDraft(saved, draftLegs, noTravel = false) {
  if (!saved || Boolean(saved.no_travel) !== Boolean(noTravel)) return false;
  if (noTravel) return Array.isArray(saved.legs) && saved.legs.length === 0;
  if (!Array.isArray(saved.legs) || !Array.isArray(draftLegs)
      || saved.legs.length !== draftLegs.length) return false;
  const close = (a, b) => a != null && b != null &&
    Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
    Math.abs(Number(a) - Number(b)) < 0.011;
  return draftLegs.every((draft, index) => {
    const actual = saved.legs[index];
    return actual && actual.kind === draft.kind
      && (actual.fromRecordId ?? null) === (draft.fromRecordId ?? null)
      && (actual.toRecordId ?? null) === (draft.toRecordId ?? null)
      && (!draft.contextFingerprint || actual.contextFingerprint === draft.contextFingerprint)
      && actual.from === draft.from && actual.to === draft.to
      && (actual.mode || 'car') === (draft.mode || 'car')
      && close(actual.minutes, draft.minutes)
      && close(actual.kilometers, draft.kilometers)
      && close(actual.transportCost ?? 0, draft.transportCost ?? 0);
  });
}
