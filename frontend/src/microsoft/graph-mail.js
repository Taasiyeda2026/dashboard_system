import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

let msalClient;

function microsoftConfig() {
  const runtime = globalThis.__DASHBOARD_CONFIG__ || {};
  return {
    clientId: String(import.meta.env?.VITE_MICROSOFT_CLIENT_ID || runtime.microsoftClientId || '').trim(),
    tenantId: String(import.meta.env?.VITE_MICROSOFT_TENANT_ID || runtime.microsoftTenantId || '').trim(),
    redirectUri: String(import.meta.env?.VITE_MICROSOFT_REDIRECT_URI || runtime.microsoftRedirectUri || globalThis.location?.origin || '').trim()
  };
}

export async function delegatedMailToken(loginHint = '', { interactive = true } = {}) {
  const config = microsoftConfig();
  if (!config.clientId || !config.tenantId) throw new Error('חיבור Microsoft 365 טרם הוגדר במערכת.');
  if (!msalClient) {
    msalClient = new PublicClientApplication({
      auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`, redirectUri: config.redirectUri },
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
    });
    await msalClient.initialize();
    await msalClient.handleRedirectPromise();
  }
  const request = { scopes: ['Mail.ReadWrite', 'Mail.Send'], loginHint: loginHint || undefined };
  const account = msalClient.getAllAccounts()[0];
  if (account) {
    try { return (await msalClient.acquireTokenSilent({ ...request, account })).accessToken; }
    catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) throw error;
      if (!interactive) return '';
    }
  }
  if (!interactive) return '';
  return (await msalClient.acquireTokenPopup(request)).accessToken;
}

export async function graphMailRequest(token, path, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'IdType="ImmutableId"',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload?.error?.message || `Microsoft Graph request failed (${response.status}).`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('retry-after') || 0);
    throw error;
  }
  return response.status === 204 || response.status === 202 ? null : response.json();
}

export async function createGraphDraft({ token, subject, body, to, cc = [], extendedProperties = [] }) {
  return graphMailRequest(token, '/me/messages', {
    method: 'POST',
    body: JSON.stringify({
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: cc.filter(Boolean).map((address) => ({ emailAddress: { address } })),
      singleValueExtendedProperties: extendedProperties
    })
  });
}

export function addGraphFileAttachment(token, messageId, attachment) {
  return graphMailRequest(token, `/me/messages/${encodeURIComponent(messageId)}/attachments`, {
    method: 'POST',
    body: JSON.stringify({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachment.name,
      contentType: attachment.contentType || 'application/pdf',
      contentBytes: attachment.contentBytes
    })
  });
}

export function deleteGraphDraft(token, messageId) {
  return graphMailRequest(token, `/me/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
}

export function sendGraphMessage(token, messageId) {
  return graphMailRequest(token, `/me/messages/${encodeURIComponent(messageId)}/send`, { method: 'POST' });
}
