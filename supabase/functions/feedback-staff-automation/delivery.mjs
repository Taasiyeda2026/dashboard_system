import { israelClock } from './planner.mjs';
import { STAFF_SIGNATURE_CONTENT_ID, STAFF_SIGNATURE_PNG_BASE64, STAFF_SIGNATURE_WIDTH, STAFF_SIGNATURE_HEIGHT } from './staff-signature.mjs';

/** Required From mailbox for every automatically generated staff feedback email. */
export const STAFF_FEEDBACK_SENDER = 'office@think.org.il';
/**
 * Staff feedback uses its OWN Azure app registration. These are public app/tenant
 * identifiers (not secrets), pinned to the approved Taasiyeda Dashboard app.
 * Never fall back to shared MS_* used by unrelated services.
 */
export const STAFF_GRAPH_CLIENT_ID = 'b37ae8f7-0b03-4925-b0e4-f5cb8da95238';
export const STAFF_GRAPH_TENANT_ID = 'bb3f0918-c67d-4fee-b2db-e6a8eab891d1';

export function staffGraphCredentials(readEnv) {
  const client = String(readEnv('FEEDBACK_STAFF_MS_CLIENT_ID') || '').trim().toLowerCase();
  const tenant = String(readEnv('FEEDBACK_STAFF_MS_TENANT_ID') || '').trim().toLowerCase();
  const secret = String(readEnv('FEEDBACK_STAFF_MS_CLIENT_SECRET') || '');
  if (!secret || client !== STAFF_GRAPH_CLIENT_ID || tenant !== STAFF_GRAPH_TENANT_ID) {
    throw new Error('staff_graph_credentials_not_ready');
  }
  return { client, tenant, secret };
}

/** Graph application tokens must belong to the pinned app AND carry Mail.Send. */
export function staffGraphTokenHasMailSend(token) {
  if (typeof token !== 'string') return false;
  try {
    const middle = token.split('.')[1];
    if (!middle || !/^[A-Za-z0-9_-]+$/.test(middle)) return false;
    const raw = middle.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')));
    const appId = String(claims.appid || claims.azp || '').toLowerCase();
    const tenantId = String(claims.tid || '').toLowerCase();
    return appId === STAFF_GRAPH_CLIENT_ID
      && tenantId === STAFF_GRAPH_TENANT_ID
      && Array.isArray(claims.roles)
      && claims.roles.includes('Mail.Send');
  } catch {
    return false;
  }
}


// No transport is constructed here: tests inject a fake, production injects Graph.
export function deliveryWindow(action, now) {
  const clock = israelClock(now);
  return clock.hour === (action === 'prepare' ? 7 : action === 'dispatch' ? 8 : -1);
}

/** Escape untrusted activity/contact values before rendering a right-to-left email. */
function escapeMailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function staffMail(item, baseUrl) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('invalid_feedback_base_url');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(item.token || '')) throw new Error('invalid_personal_token');
  const stage = item.stage;
  if (!['pre', 'mid', 'final'].includes(stage)) throw new Error('invalid_stage');
  const programTitle = String(item.program_title ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!programTitle) throw new Error('missing_program_title');
  // The name belongs to the selected contacts_schools record, not a legacy
  // activity field. A blank name never leaks a template placeholder.
  const contactName = String(item.contact_name ?? '').replace(/[\r\n]+/g, ' ').trim();
  const greeting = contactName ? `שלום ${escapeMailHtml(contactName)},` : 'שלום רב,';
  const program = escapeMailHtml(programTitle);
  const url = new URL('feedback.html', base);
  url.searchParams.set('t', item.token);

  const paragraphs = stage === 'pre'
    ? [
      `עם תחילת התוכנית <strong>${program}</strong>, נשמח להכיר את הציפיות והצרכים שלכם ואת נקודת הפתיחה של התלמידים.`,
      'תשובותיך יסייעו לנו להתאים את המשך ההדרכה לצורכי הקבוצה ולדייק את המפגשים הבאים.',
      'נודה לך על הקדשת מספר דקות למילוי משוב תיאום ציפיות קצר.'
    ]
    : stage === 'mid' ? [
      `במחצית התוכנית <strong>${program}</strong>, חשוב לנו להבין כיצד המפגשים מתקדמים.`,
      'נשמח לדעת מה עובד היטב והאם קיים קושי שחשוב לטפל בו כבר במפגשים הקרובים.',
      'נודה לך על מילוי משוב אמצע קצר שמאפשר לנו לשפר בזמן אמת.'
    ]
    : [
      `עם סיום התוכנית <strong>${program}</strong>, נשמח לשמוע את התרשמותך מהפעילות שהתקיימה.`,
      'חשוב לנו להבין מה עבד היטב, אילו חלקים היו משמעותיים במיוחד והאם יש נושאים שכדאי לשמר, לדייק או לשפר לקראת הפעילויות הבאות.',
      'נודה לך על הקדשת מספר דקות למילוי משוב קצר, שיסייע לנו להמשיך ולפתח את התוכנית ולהתאים אותה לצורכי התלמידים ובית הספר.'
    ];

  return {
    subject: `משוב על פעילויות תעשיידע | ${programTitle}`,
    body: {
      contentType: 'HTML',
      content: [
        '<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;text-align:right">',
        `<p>${greeting}</p>`,
        ...paragraphs.map((paragraph) => `<p>${paragraph}</p>`),
        `<p><strong>למילוי המשוב האישי:</strong><br><a href="${escapeMailHtml(url.href)}">${escapeMailHtml(url.href)}</a></p>`,
        '<p>תודה רבה על שיתוף הפעולה,</p>',
        '<p style="margin:8px 0 0;text-align:right"><img src="cid:' + STAFF_SIGNATURE_CONTENT_ID + '" alt="חתימת תעשיידע" width="' + STAFF_SIGNATURE_WIDTH + '" height="' + STAFF_SIGNATURE_HEIGHT + '" style="display:block;max-width:100%;width:410px;height:auto;border:0;outline:none;text-decoration:none"></p>',
        '</div>'
      ].join('\n')
    },
    toRecipients: [{ emailAddress: { address: item.recipient_email } }],
    attachments: [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'taasiyeda-signature.png',
      contentType: 'image/png',
      contentId: STAFF_SIGNATURE_CONTENT_ID,
      isInline: true,
      contentBytes: STAFF_SIGNATURE_PNG_BASE64
    }]
  };
}

/** One attempt only. A lost response / 5xx is ambiguous, never auto-retried. */
export async function deliverClaim(item, { rpc, getAccessToken, send, baseUrl }) {
  let message, accessToken;
  try {
    message = staffMail(item, baseUrl);
    accessToken = await getAccessToken();
  } catch {
    await rpc('feedback_staff_auto_finish', {
      p_id: item.id, p_claim: item.claim_token, p_result: 'failed',
      p_error: 'mail_preflight_failed', p_http_status: null, p_graph_request_id: null
    });
    return 'failed';
  }
  // Fresh DB check immediately before the external side effect. The DB records
  // graph_started_at before returning so a process crash is recovered as unknown.
  const gate = await rpc('feedback_staff_auto_begin_send', { p_id: item.id, p_claim: item.claim_token, p_token: item.token });
  if (!gate.ready) return 'blocked';
  let result;
  try {
    const response = await send(message, accessToken);
    result = {
      p_result: response.status === 202 ? 'accepted'
        : [400, 401, 403, 404, 413, 422, 429].includes(response.status) ? 'failed' : 'unknown',
      p_http_status: response.status,
      p_graph_request_id: response.headers.get('request-id'),
      p_error: response.status === 202 ? null : `graph_http_${response.status}`
    };
  } catch {
    result = { p_result: 'unknown', p_http_status: null, p_graph_request_id: null, p_error: 'graph_response_lost' };
  }
  // Do not send again if recording the result fails. The persisted sending claim
  // will be recovered as unknown, even when Graph returned 202.
  await rpc('feedback_staff_auto_finish', { p_id: item.id, p_claim: item.claim_token, ...result });
  return result.p_result;
}

export async function runAutomation({ action, now = new Date(), enabled = false, rpc, transport, limit = 1000 }) {
  if (!enabled) return { disabled: true, mail_sent: 0 };
  if (!deliveryWindow(action, now)) return { outside_window: true, mail_sent: 0 };
  if (action === 'prepare') return rpc('feedback_staff_auto_prepare', {});
  const counts = { accepted: 0, failed: 0, unknown: 0, blocked: 0 };
  for (let n = 0; n < limit; n++) {
    const item = await rpc('feedback_staff_auto_claim', {});
    if (!item?.id) break;
    counts[await deliverClaim(item, { rpc, ...transport })]++;
  }
  return counts;
}
