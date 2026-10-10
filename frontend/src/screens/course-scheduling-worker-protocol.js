// Data-only transport. No DOM, credentials, persistence or scheduling policy.
export const POINT_SNAPSHOT_FIELDS = ['activities', 'instructors', 'profiles', 'rules', 'exceptions', 'schoolCalendar', 'catalog', 'existingRows', 'committedRows', 'lockedOptions', 'routeRows'];
export function planningWorkerError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}
export function planningRowPatches(rows = [], previous = []) {
  const before = new Map(previous.map(row => [String(row.courseId), row]));
  const patches = [];
  for (const row of rows) {
    const old = before.get(String(row.courseId));
    if (!old) { patches.push({ id: String(row.courseId), set: row, remove: [] }); continue; }
    const set = Object.create(null), remove = [];
    for (const key of Object.keys(row)) if (!Object.hasOwn(old, key) || JSON.stringify(row[key]) !== JSON.stringify(old[key])) set[key] = row[key];
    for (const key of Object.keys(old)) if (!(key in row)) remove.push(key);
    if (Object.keys(set).length || remove.length) patches.push({ id: String(row.courseId), set, remove });
  }
  return { order: rows.map(row => String(row.courseId)), patches };
}
export function applyPlanningRowPatches(delta, previous = []) {
  const rows = new Map(previous.map(row => [String(row.courseId), row]));
  for (const patch of delta.patches) {
    const row = { ...(rows.get(patch.id) || {}), ...patch.set };
    for (const key of patch.remove) delete row[key];
    rows.set(patch.id, row);
  }
  return delta.order.map(id => {
    if (!rows.has(id)) throw planningWorkerError('planning_worker_protocol_error');
    return rows.get(id);
  });
}

// Supabase invoke returns a Response in response, and HTTP errors also
// contain it in context. Neither belongs in the data-only Worker envelope.
// Transport only the error metadata consumed by the route client; never the
// Response, headers, stream or credentials. Route data itself stays unchanged.
export function planningRouteReply(value) {
  const error = value?.error;
  return { data: value?.data ?? null, error: error ? {
    message: typeof error.message === 'string' ? error.message : 'route_lookup_failed',
    ...(typeof error.code === 'string' ? { code: error.code } : {})
  } : null };
}
export function planningCloneError(error, message) {
  if (error?.name !== 'DataCloneError') return error;
  // Inspect recursively only on failure, avoiding a second clone of every
  // national snapshot. Expose field paths, never field values.
  const seen = new WeakSet();
  const locate = (value, path) => {
    if (typeof value === 'function' || typeof value === 'symbol') return path;
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    if ((typeof Response !== 'undefined' && value instanceof Response)
      || (typeof WeakMap !== 'undefined' && value instanceof WeakMap)
      || (typeof WeakSet !== 'undefined' && value instanceof WeakSet)
      || (typeof Node !== 'undefined' && value instanceof Node)) return path;
    const entries = value instanceof Map ? [...value.entries()].flatMap(([k,v],i)=>[[`mapKey${i}`,k],[`mapValue${i}`,v]])
      : value instanceof Set ? [...value].map((v,i)=>[i,v]) : Object.entries(value);
    for (const [key, child] of entries) { const found = locate(child, `${path}.${key}`); if (found) return found; }
    return null;
  };
  const path = locate(message, message.type || 'message') || message.type || 'message';
  return planningWorkerError('planning_worker_data_clone_failed', {
    message: `לא ניתן להעביר נתונים למנוע החישוב: שדה שאינו ניתן להעתקה (${path}). התכנון השמור לא השתנה.`,
    transportPath: path, cause: error
  });
}
