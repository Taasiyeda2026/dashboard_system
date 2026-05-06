import { createClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://szinlhjuwyiyszdpsdop.supabase.co';
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM';

const viteEnv = import.meta.env || {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || viteEnv.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseAnonKey =
  viteEnv.VITE_SUPABASE_ANON_KEY ||
  viteEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  FALLBACK_SUPABASE_PUBLISHABLE_KEY;

let supabase = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing configuration. Expected VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export { supabase };
