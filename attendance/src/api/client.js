// Same Supabase project as the dashboard (frontend/src/supabase-client.js fallback values).
// attendance/ is unbundled (copied verbatim, see scripts/sync-attendance-vendor.mjs), so there is
// no Vite import.meta.env available here — these are the public anon-key values, safe client-side.
const SUPABASE_URL = 'https://szinlhjuwyiyszdpsdop.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
