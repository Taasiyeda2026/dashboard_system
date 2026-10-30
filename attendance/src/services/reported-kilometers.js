// A physical report needs an explicit amount, including an explicit zero.
// Remote reports, public transport and cancellation-only rows carry no km claim.
export function reportedKilometers(value, { online = false, publicTransport = false, activityType = '' } = {}) {
  if (online || publicTransport) return 0;
  const raw = String(value ?? '').trim();
  if (!raw) return activityType === 'ביטול זמן' ? 0 : null;
  const km = Number(raw);
  return Number.isFinite(km) && km >= 0 ? km : null;
}
