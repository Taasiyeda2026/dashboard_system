/**
 * Merge a previewed travel leg with a previously saved leg.
 * Preserves instructor-entered km/mode/cost when the route segment still matches.
 * sameLocation defaults to 0 km only when nothing was saved yet.
 */

export function legsShareRoute(previewLeg = {}, savedLeg = null) {
  if (!savedLeg) return false;
  return savedLeg.kind === previewLeg.kind
    && savedLeg.from === previewLeg.from
    && savedLeg.to === previewLeg.to
    && (!previewLeg.contextFingerprint
      || savedLeg.contextFingerprint === previewLeg.contextFingerprint);
}

export function mergeDailyTravelLegValues(previewLeg = {}, savedLeg = null) {
  const same = legsShareRoute(previewLeg, savedLeg);
  const sameLocation = previewLeg.kind === 'between' && previewLeg.sameLocation === true;
  const savedKm = same && savedLeg?.kilometers != null && savedLeg.kilometers !== ''
    ? Number(savedLeg.kilometers)
    : null;
  return {
    ...previewLeg,
    minutes: previewLeg.kind === 'between'
      ? previewLeg.gapMinutes
      : (same ? savedLeg.minutes : null),
    kilometers: sameLocation
      ? (Number.isFinite(savedKm) ? savedKm : 0)
      : (same ? savedLeg.kilometers : null),
    mode: same
      ? (savedLeg.mode || 'car')
      : (sameLocation ? 'car' : ''),
    transportCost: same ? Number(savedLeg.transportCost || 0) : 0,
  };
}
