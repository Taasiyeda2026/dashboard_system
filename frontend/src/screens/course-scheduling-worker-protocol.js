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
