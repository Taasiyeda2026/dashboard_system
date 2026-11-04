import { supabase, waitForSupabaseAuthSession } from '../../supabase-client.js';

/**
 * List view of the activity updates, restricted to the IDs of school_2027
 * activities already loaded by the activities endpoint.
 *
 * The activities.notes field is "מידע נוסף", never the latest update.
 * Read-only: does not create, update or remove notes.
 */
const CHUNK_SIZE = 80;

function noteRank(note) {
  const time = note?.is_legacy
    ? (note.saved_at
      ? Date.parse(note.saved_at)
      : (note.occurred_on ? Date.parse(note.occurred_on + 'T12:00:00Z') : 0))
    : Date.parse(note?.created_at);
  return Number.isFinite(time) ? time : 0;
}

export function selectLatestActivityUpdates(notes = []) {
  const result = Object.create(null);
  for (const note of notes) {
    const id = String(note?.activity_row_id || '').trim();
    if (!id || !String(note?.body || '').trim()) continue;
    const previous = result[id];
    if (!previous) {
      result[id] = note;
      continue;
    }
    const timeDiff = noteRank(note) - noteRank(previous);
    // Match the drawer's chronological sort including the legacy tie breaker.
    const isLater = timeDiff > 0 || (timeDiff === 0 && (
      note.is_legacy && previous.is_legacy
        ? (Number(note.legacy_sequence) || 0) < (Number(previous.legacy_sequence) || 0)
        : Number(note.id) > Number(previous.id)
    ));
    if (isLater) result[id] = note;
  }
  return result;
}

export async function loadLatest2027ActivityUpdates(rows = []) {
  const rowIds = [...new Set((Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.activity_season || '') === 'school_2027')
    .map((row) => String(row?.RowID || row?.row_id || '').trim())
    .filter(Boolean))];
  if (!rowIds.length || !supabase) return Object.create(null);

  await waitForSupabaseAuthSession();
  const chunks = [];
  for (let offset = 0; offset < rowIds.length; offset += CHUNK_SIZE) {
    chunks.push(rowIds.slice(offset, offset + CHUNK_SIZE));
  }
  const responses = await Promise.all(chunks.map((ids) => supabase
    .from('activity_update_notes')
    .select('id,activity_row_id,body,author_name,created_at,is_legacy,occurred_on,legacy_sequence,saved_at')
    .in('activity_row_id', ids)
    .limit(1000)));
  const errors = responses.filter((response) => response.error).map((response) => response.error);
  if (errors.length) throw errors[0];
  return selectLatestActivityUpdates(responses.flatMap((response) => response.data || []));
}

export function latestUpdateDisplay(note) {
  if (!note) return '';
  let date = '';
  const raw = note.is_legacy ? (note.saved_at || note.occurred_on) : note.created_at;
  if (raw) {
    const parsed = Date.parse(note.is_legacy && !note.saved_at ? String(raw) + 'T12:00:00Z' : raw);
    if (Number.isFinite(parsed)) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit'
      }).formatToParts(new Date(parsed));
      const get = (type) => parts.find((part) => part.type === type)?.value || '';
      date = [get('day'), get('month'), get('year')].join('.');
    }
  }
  const author = String(note.author_name || '').trim();
  const prefix = [date, author].filter(Boolean).join(' · ');
  const body = String(note.body || '').trim().replace(/\s*\n\s*/g, ' ');
  return prefix ? prefix + ': ' + body : body;
}
