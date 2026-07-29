import { supabase } from '../../supabase-client.js';

const SCHOOL_CALENDAR_COLUMNS = [
  'external_key',
  'title',
  'category',
  'start_date',
  'end_date',
  'resume_date',
  'day_status',
  'school_day_end_time',
  'blocks_scheduling',
  'enforce_end_time',
  'show_on_main_calendar',
  'is_active'
].join(',');

let cachedRows = null;
let inflightRequest = null;
let authSubscriptionStarted = false;
let authGeneration = 0;
let authenticatedUserId;

function updateAuthenticatedUser(session) {
  const nextUserId = session?.user?.id || null;

  if (authenticatedUserId === undefined) {
    authenticatedUserId = nextUserId;
    return;
  }

  if (authenticatedUserId === nextUserId) return;

  authenticatedUserId = nextUserId;
  authGeneration += 1;
  cachedRows = null;
}

function startAuthCacheInvalidation() {
  if (!supabase || authSubscriptionStarted) return;
  authSubscriptionStarted = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    updateAuthenticatedUser(session);
  });
}

export function getCachedSchoolCalendarRows() {
  return cachedRows;
}

export function clearSchoolCalendarCache() {
  cachedRows = null;
}

export async function loadSchoolCalendarRows() {
  if (cachedRows) return cachedRows;
  if (inflightRequest) return inflightRequest;

  inflightRequest = (async () => {
    if (!supabase) return [];

    startAuthCacheInvalidation();

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('[school-calendar] session check failed', {
        message: sessionError.message || ''
      });
      return [];
    }

    updateAuthenticatedUser(sessionData?.session || null);
    if (!sessionData?.session?.user) return [];

    const requestAuthGeneration = authGeneration;
    const { data, error } = await supabase
      .from('school_calendar')
      .select(SCHOOL_CALENDAR_COLUMNS)
      .eq('is_active', true)
      .eq('show_on_main_calendar', true)
      .order('start_date', { ascending: true });

    if (error) {
      console.warn('[school-calendar] read failed', {
        code: error.code || '',
        message: error.message || ''
      });
      return [];
    }

    if (requestAuthGeneration !== authGeneration) return [];

    cachedRows = Array.isArray(data) ? data : [];
    return cachedRows;
  })().finally(() => {
    inflightRequest = null;
  });

  return inflightRequest;
}
