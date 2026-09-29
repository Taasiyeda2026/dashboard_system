export function parseGoogleRouteMetrics(route) {
  if (!route || !/^\d+(?:\.\d+)?s$/.test(String(route.duration || ''))) return null;
  const seconds = Number.parseFloat(route.duration);
  // Protobuf omits distanceMeters when its value is zero. Only accept that
  // default with an explicit zero duration and matching provider coordinates.
  const distance = route.distanceMeters === undefined && seconds === 0 ? 0 : route.distanceMeters;
  if (distance == null || !Number.isFinite(Number(distance)) || Number(distance) < 0) return null;
  const start = route.legs?.[0]?.startLocation?.latLng;
  const end = route.legs?.at(-1)?.endLocation?.latLng;
  const samePoint = start && end && ['latitude', 'longitude'].every(k =>
    Number.isFinite(start[k]) && Number.isFinite(end[k]) && start[k] === end[k]);
  const zero = Number(distance) === 0 || seconds === 0;
  if (zero && !(Number(distance) === 0 && seconds === 0 && samePoint)) return null;
  return { distance_km: Number(distance) / 1000, duration_minutes: Math.ceil(seconds / 60),
    provider: zero ? 'google_verified_zero' : 'google' };
}
