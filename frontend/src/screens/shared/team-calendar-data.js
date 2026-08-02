import { supabase } from '../../supabase-client.js';

const TEAM_CALENDAR_COLUMNS = [
  'external_key',
  'event_date',
  'title',
  'owner_name',
  'event_type',
  'notes'
].join(',');

let cachedRows = null;
let inflightRequest = null;
let authSubscriptionStarted = false;
let authenticatedUserId;

function updateAuthenticatedUser(session) {
  const nextUserId = session?.user?.id || null;
  if (authenticatedUserId === undefined) {
    authenticatedUserId = nextUserId;
    return;
  }
  if (authenticatedUserId === nextUserId) return;
  authenticatedUserId = nextUserId;
  cachedRows = null;
}

function startAuthCacheInvalidation() {
  if (!supabase || authSubscriptionStarted) return;
  authSubscriptionStarted = true;
  supabase.auth.onAuthStateChange((_event, session) => updateAuthenticatedUser(session));
}

export function clearTeamCalendarCache() {
  cachedRows = null;
}

export async function loadTeamCalendarRows() {
  if (cachedRows) return cachedRows;
  if (inflightRequest) return inflightRequest;

  inflightRequest = (async () => {
    if (!supabase) return [];
    startAuthCacheInvalidation();

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.user) return [];
    updateAuthenticatedUser(sessionData.session);

    const { data, error } = await supabase
      .from('team_calendar_events')
      .select(TEAM_CALENDAR_COLUMNS)
      .eq('is_active', true)
      .eq('show_on_main_calendar', true)
      .order('event_date', { ascending: true })
      .order('event_type', { ascending: true })
      .order('title', { ascending: true });

    if (error) {
      console.warn('[team-calendar] read failed', {
        code: error.code || '',
        message: error.message || ''
      });
      return [];
    }

    cachedRows = Array.isArray(data) ? data : [];
    return cachedRows;
  })().finally(() => {
    inflightRequest = null;
  });

  return inflightRequest;
}
