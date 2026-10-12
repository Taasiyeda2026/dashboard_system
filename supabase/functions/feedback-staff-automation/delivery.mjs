import { israelClock } from './planner.mjs';

/** Required From mailbox for every automatically generated staff feedback email. */
export const STAFF_FEEDBACK_SENDER = 'office@think.org.il';

// No transport is constructed here: tests inject a fake, production injects Graph.
export function deliveryWindow(action, now) {
  const clock = israelClock(now);
  return clock.hour === (action === 'prepare' ? 5 : action === 'dispatch' ? 8 : -1);
}

export function staffMail(item, baseUrl) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('invalid_feedback_base_url');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(item.token || '')) throw new Error('invalid_personal_token');
  const url = new URL('feedback.html', base);
  url.searchParams.set('t', item.token);
  const stage = item.stage === 'pre' ? 'פתיחה' : item.stage === 'final' ? 'סיום' : null;
  if (!stage) throw new Error('invalid_stage');
  return {
    subject: `משוב ${stage} – ${item.program_title} – ${item.school}`,
    body: { contentType: 'Text', content: [
      'שלום,', '',
      `נשמח לקבל משוב ${stage} קצר על התוכנית "${item.program_title}" בבית הספר "${item.school}".`,
      'המשוב יסייע לנו ללמוד מהניסיון שלכם ולשפר את התוכנית.',
      `למילוי המשוב האישי: ${url.href}`, '', 'תודה על שיתוף הפעולה,', 'צוות תעשיידע'
    ].join('\n') },
    toRecipients: [{ emailAddress: { address: item.recipient_email } }]
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
