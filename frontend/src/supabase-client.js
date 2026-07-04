import { createClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://szinlhjuwyiyszdpsdop.supabase.co';
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM';

const viteEnv = import.meta.env || {};

function readEnvValue(...keys) {
  for (const key of keys) {
    const value = String(viteEnv[key] || '').trim();
    if (value) return value;
  }
  return '';
}

const supabaseUrl = readEnvValue(
  'VITE_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL'
) || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = readEnvValue(
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY'
) || FALLBACK_SUPABASE_PUBLISHABLE_KEY;

let supabase = null;
let authSessionWaitPromise = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing configuration. Expected VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or NEXT_PUBLIC_/SUPABASE_ aliases.'
  );
}

export const supabaseConfig = {
  url: supabaseUrl,
  hasAnonKey: Boolean(supabaseAnonKey),
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  usesFallbackUrl: supabaseUrl === FALLBACK_SUPABASE_URL,
  usesFallbackAnonKey: supabaseAnonKey === FALLBACK_SUPABASE_PUBLISHABLE_KEY
};

export function resetSupabaseAuthSessionWait() {
  authSessionWaitPromise = null;
}

/**
 * Resolves when Supabase Auth has restored the persisted session (or timeout).
 * Personal reports RLS and profile reads require auth.uid() on the shared client.
 */
export function waitForSupabaseAuthSession(options = {}) {
  if (!supabase) return Promise.resolve(null);
  if (authSessionWaitPromise) return authSessionWaitPromise;

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000;

  authSessionWaitPromise = new Promise((resolve) => {
    let settled = false;
    let subscription = null;
    let timer = null;

    const finish = (session) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        subscription?.unsubscribe();
      } catch {
        /* ignore */
      }
      const resolvedSession = session?.user?.id ? session : null;
      if (!resolvedSession) authSessionWaitPromise = null;
      resolve(resolvedSession);
    };

    timer = setTimeout(() => {
      supabase.auth
        .getSession()
        .then(({ data }) => finish(data?.session || null))
        .catch(() => finish(null));
    }, timeoutMs);

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!error && data?.session?.user?.id) finish(data.session);
      })
      .catch(() => {});

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session?.user?.id) return;
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        finish(session);
      }
    });
    subscription = listener?.subscription;
  });

  return authSessionWaitPromise;
}

export { supabase };
