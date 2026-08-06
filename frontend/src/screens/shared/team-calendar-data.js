import { supabase } from '../../supabase-client.js';

let cachedRows = null;
let inflightRequest = null;

export function getCachedTeamCalendarRows() {
  return cachedRows;
}

export function clearTeamCalendarCache() {
  cachedRows = null;
}

export async function loadTeamCalendarRows() {
  if (cachedRows) return cachedRows;
  if (inflightRequest) return inflightRequest;
  if (!supabase) return [];

  inflightRequest = supabase
    .from('team_calendar_events')
    .select('external_key,event_date,title,owner_name,display_order,is_active')
    .eq('is_active', true)
    .order('event_date', { ascending: true })
    .order('display_order', { ascending: true })
    .then(({ data, error }) => {
      if (error) {
        console.warn('[team-calendar] read failed', { code: error.code || '', message: error.message || '' });
        return [];
      }
      cachedRows = Array.isArray(data) ? data : [];
      return cachedRows;
    })
    .finally(() => { inflightRequest = null; });

  return inflightRequest;
}
