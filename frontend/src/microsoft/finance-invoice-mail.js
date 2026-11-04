import { hasPermission } from '../permission-policy.js';

// Use the same delegated MSAL session as coordination and onboarding. Tokens
// remain transient and are sent only to the authenticated invoice endpoint.
export async function financeDelegatedHeaders(user, tokenProvider) {
  try {
    const provider = tokenProvider || (await import('./graph-mail.js')).delegatedMailToken;
    const token = await provider(user?.auth_email || user?.email || '', { interactive: false });
    return token ? { 'x-microsoft-mail-token': token } : {};
  } catch { return {}; } // PDF issuance must survive an unavailable Microsoft session.
}

export async function resumeFinanceInvoiceDrafts({ user, api, tokenProvider, reconnected = false }) {
  if (!user?.auth_user_id || !hasPermission(user, 'manage_finance_transactions')) return [];
  const pending = await api.pendingFinanceDelegatedAccounts({ reconnected });
  if (!pending.length) return [];
  const headers = await financeDelegatedHeaders(user, tokenProvider);
  if (!headers['x-microsoft-mail-token']) return [];
  const results = [];
  for (const account of pending) {
    try { results.push(await api.dispatchFinanceTransactionAccount({ accountId: account.id }, { mailHeaders: headers })); }
    catch (error) { results.push({ accountId: account.id, error: String(error?.message || error) }); }
  }
  return results;
}

export function createFinanceInvoiceResumeRuntime({ getUser, api, target = globalThis.window, tokenProvider, onChanged = () => {} }) {
  let userId = '', timer = null, busy = false;
  const tick = async (event) => {
    const user = getUser();
    if (busy || !userId || user?.auth_user_id !== userId) return;
    busy = true;
    try {
      const owner = userId;
      // Recheck the session before every network dispatch, including mid-batch logout.
      const guardedApi = {
        pendingFinanceDelegatedAccounts: options => api.pendingFinanceDelegatedAccounts(options),
        dispatchFinanceTransactionAccount: (...args) => {
          if (getUser()?.auth_user_id !== owner) throw new Error('invoice_original_issuer_required');
          return api.dispatchFinanceTransactionAccount(...args);
        }
      };
      const results = await resumeFinanceInvoiceDrafts({ user, api: guardedApi, tokenProvider, reconnected: event?.type==='microsoft-mail-connected' });
      if (results.length && getUser()?.auth_user_id === owner) onChanged(results);
    } catch { /* Persisted account status remains authoritative; the next session can resume. */ }
    finally { busy = false; }
  };
  const sync = () => {
    const user = getUser();
    const next = user?.auth_user_id && hasPermission(user, 'manage_finance_transactions') ? user.auth_user_id : '';
    if (next === userId) return;
    if (timer) clearInterval(timer);
    userId = next;
    if (userId) { void tick({ type:'microsoft-mail-connected' }); timer = setInterval(tick, 60000); }
  };
  target?.addEventListener('focus', tick);
  target?.addEventListener('microsoft-mail-connected', tick);
  return { sync, tick, stop() {
    userId = ''; clearInterval(timer);
    target?.removeEventListener('focus', tick);
    target?.removeEventListener('microsoft-mail-connected', tick);
  } };
}
