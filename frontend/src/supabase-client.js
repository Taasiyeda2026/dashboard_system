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

const SCHEDULING_DRAFT_RPC_NAMES = new Set([
  'save_course_assignment_draft',
  'save_course_assignment_draft_with_dates'
]);

const SCHEDULING_DRAFT_RPC_ERROR_MESSAGES = Object.freeze({
  scheduling_conflict_detected: 'קיימת חפיפה עם שיבוץ אחר של המדריך',
  scheduling_transition_insufficient: 'אין מספיק זמן מעבר בין הפעילויות'
});

export function translateSchedulingDraftRpcErrorMessage(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  for (const [code, message] of Object.entries(SCHEDULING_DRAFT_RPC_ERROR_MESSAGES)) {
    if (raw === code || raw.includes(code)) return message;
  }
  return raw;
}

function installSchedulingDraftRpcErrorTranslation(client) {
  if (!client || typeof client.rpc !== 'function') return;
  const originalRpc = client.rpc.bind(client);
  client.rpc = (functionName, args, options) => {
    const request = originalRpc(functionName, args, options);
    if (!SCHEDULING_DRAFT_RPC_NAMES.has(String(functionName || ''))) return request;
    return Promise.resolve(request).then((result) => {
      const rawMessage = String(result?.error?.message || '').trim();
      const translated = translateSchedulingDraftRpcErrorMessage(rawMessage);
      if (!result?.error || !translated || translated === rawMessage) return result;
      return {
        ...result,
        error: {
          ...result.error,
          message: translated,
          details: result.error.details || rawMessage
        }
      };
    });
  };
}

let supabase = null;
let authSessionWaitPromise = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    installSchedulingDraftRpcErrorTranslation(supabase);
  } catch {
    /* realtime transport unavailable in this environment (e.g. Node 20 without WebSocket) */
  }
} else {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing configuration. Expected VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or NEXT_PUBLIC_/SUPABASE_ aliases.'
  );
}

export const supabaseConfig = {
  url: supabaseUrl,
  publishableKey: supabaseAnonKey,
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
