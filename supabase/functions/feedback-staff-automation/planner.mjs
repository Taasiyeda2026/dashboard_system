/**
 * Staff feedback automatic email — simulation-only planner.
 *
 * Input comes exclusively from feedback_staff_auto_candidates RPC which
 * reproduces the unfiltered educational-staff list; never from a second
 * activities query, alternate contact lookup or arbitrary UI filters.
 */
export const STAFF_FEEDBACK_STAGES = Object.freeze(['pre', 'mid', 'final']);
export const STAFF_YEAR = 'school_2027';
export const ISRAEL_ZONE = 'Asia/Jerusalem';

function nz(value) { return String(value ?? '').trim(); }

/** Honor current phase/stage, no email fallback and no retroactive delivery. */
export function previewEligibility(rows, { activationAt, queuedKeys = new Set() } = {}) {
  const lowerBound = new Date(activationAt);
  const hasStart = activationAt !== undefined && !Number.isNaN(lowerBound.getTime());
  return (rows || []).map((row) => {
    const key = `${nz(row.group_key)}:${nz(row.stage)}`;
    const reason = !STAFF_FEEDBACK_STAGES.includes(row.stage) ? 'invalid_stage'
      : row.status !== 'eligible' ? row.status
      : !hasStart ? 'not_activated'
      : !row.eligibility_at || Date.parse(row.eligibility_at) < lowerBound.getTime() ? 'before_activation'
      : queuedKeys.has(key) ? 'already_queued'
      : 'would_queue';
    return { key, stage: row.stage, group_key: row.group_key,
      representative_row_id: row.representative_row_id, member_row_ids: row.member_row_ids || [],
      contact_id: row.contact_id, status: reason, eligible_at: row.eligibility_at };
  });
}

/** Graph must not be attempted when source identity or date changes at 08:00. */
export function revalidateSend(prepared, latest, { acceptedKeys = new Set() } = {}) {
  if (!prepared || !latest || prepared.group_key !== latest.group_key
      || prepared.stage !== latest.stage) return 'group_changed';
  if (acceptedKeys.has(`${prepared.group_key}:${prepared.stage}`)) return 'already_sent';
  if (latest.status !== 'eligible') return 'no_longer_eligible';
  if (nz(prepared.contact_id) !== nz(latest.contact_id)) return 'contact_changed';
  if (nz(prepared.contact_email).toLowerCase() !== nz(latest.contact_email).toLowerCase()) return 'email_changed';
  if (prepared.representative_row_id !== latest.representative_row_id) return 'representative_changed';
  if (prepared.eligibility_at !== latest.eligibility_at) return 'meeting_schedule_changed';
  return 'ready';
}

/** Daily check/dispatch hours in Israel: DST-safe, independent of server UTC. */
export function israelClock(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { day: `${fields.year}-${fields.month}-${fields.day}`, hour: Number(fields.hour) };
}

export function summarizeCandidatePreview(rows, options = {}) {
  const counts = {};
  for (const row of previewEligibility(rows, options)) {
    const key = `${row.stage}:${row.status}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
