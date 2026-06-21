import { createClient } from '@supabase/supabase-js';

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
);
const supabaseAnonKey = readEnvValue(
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY'
);

let supabase = null;
let authSessionWaitPromise = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY for Preview integrations).'
  );
}

export const supabaseConfig = {
  url: supabaseUrl,
  hasAnonKey: Boolean(supabaseAnonKey),
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey)
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
      resolve(session?.user?.id ? session : null);
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
