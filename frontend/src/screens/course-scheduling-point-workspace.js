// Cache only full, authoritative rows. A compact projection is never engine input.
// Reuse is permitted only after permission-checked preflight and matching versions.
export function reusablePointWorkspace(cache, { owner, scope, facts, display = null }) {
  const sameSource = String(cache?.sourceRevision) === String(facts.sourceRevision);
  if (cache?.owner !== owner || cache.scope !== scope || (!sameSource && !display)
    || cache.shared?.workspace?.id !== facts.workspace?.id
    || Number(cache.shared?.workspace?.revision) !== Number(facts.workspace?.revision)
    || cache.shared?.displayOnly === true) return null;
  if (!display) return cache.shared;
  if (display.workspace?.id !== cache.shared.workspace.id || Number(display.workspace.revision) !== Number(cache.shared.workspace.revision)) return null;
  const full = new Map(cache.shared.rows.map(entry => [entry.activityId,entry.row]));
  if (display.rows.length !== full.size || display.rows.some(entry => !full.has(entry.activityId))) return null;
  // Source changes invalidate calculation inputs, not unchanged persisted row_data.
  // Take all dirty flags/locks/header metadata from the fresh authorized projection.
  return { ...display, displayOnly: false, rows: display.rows.map(entry => ({...entry,row:full.get(entry.activityId)})) };
}
export async function refreshCommittedPointWorkspace({ previous, changedIds, saved, loadDisplay, loadDetails, verifyRevision, loadFull }) {
  if (!Array.isArray(changedIds) || !previous?.workspace || !saved?.id || saved.id !== previous.workspace.id) return loadFull();
  const display = await loadDisplay();
  // Another manager may have written between our commit and canonical read.
  // Do not certify local rows at somebody else's revision.
  if (display?.workspace?.id !== saved.id || Number(display.workspace.revision) !== Number(saved.revision)) return loadFull();
  const rows = new Map(previous.rows.map(entry => [entry.activityId, entry.row]));
  const pending = [...new Set(changedIds)];
  if (display.rows.some(entry => !rows.has(entry.activityId) && !pending.includes(entry.activityId))) return loadFull();
  for (let i = 0; i < pending.length; i += 6) {
    await Promise.all(pending.slice(i, i + 6).map(async activityId => {
      const row = await loadDetails({ workspaceId: saved.id, activityId, expectedRevision: saved.revision });
      if (!row || row._detailsDeferred) throw new Error('planning_worker_protocol_error');
      rows.set(activityId, row);
    }));
  }
  await verifyRevision({ workspaceId: saved.id, expectedRevision: saved.revision });
  return { ...display, displayOnly: false, rows: display.rows.map(entry => ({ ...entry, row: rows.get(entry.activityId) })) };
}
