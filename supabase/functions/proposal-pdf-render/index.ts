import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MAX_HTML_BYTES = 4 * 1024 * 1024;
const ALLOWED_ROLES = new Set(['admin', 'operation_manager', 'domain_manager']);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'server_configuration_missing' }, 500);

  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse({ error: 'authentication_required' }, 401);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return jsonResponse({ error: 'invalid_authentication' }, 401);

  const { data: appUser, error: appUserError } = await db
    .from('users')
    .select('role,is_active')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (appUserError) return jsonResponse({ error: 'authorization_check_failed' }, 500);
  if (!ALLOWED_ROLES.has(text(appUser?.role))) return jsonResponse({ error: 'proposal_pdf_permission_denied' }, 403);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const html = text(payload.html);
  if (!html || !/<html\b/i.test(html) || !/proposal-native-pdf-root/i.test(html)) {
    return jsonResponse({ error: 'invalid_proposal_pdf_html' }, 400);
  }
  if (byteLength(html) > MAX_HTML_BYTES) return jsonResponse({ error: 'proposal_pdf_html_too_large' }, 413);

  const browserlessToken = Deno.env.get('BROWSERLESS_API_KEY') || Deno.env.get('BROWSERLESS_TOKEN') || '';
  if (!browserlessToken) return jsonResponse({ error: 'browserless_not_configured' }, 503);

  const browserlessBase = text(Deno.env.get('BROWSERLESS_API_URL') || 'https://production-ams.browserless.io')
    .replace(/\/+$/, '');
  const endpoint = `${browserlessBase}/pdf?token=${encodeURIComponent(browserlessToken)}`;

  let rendered: Response;
  try {
    rendered = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        html,
        waitForFunction: {
          fn: '() => window.__proposalNativePdfReady === true',
          timeout: 20000
        },
        options: {
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' }
        }
      })
    });
  } catch (error) {
    console.error('[proposal-pdf-render] browser request failed', error);
    return jsonResponse({ error: 'pdf_render_failed' }, 502);
  }

  if (!rendered.ok) {
    const detail = await rendered.text().catch(() => '');
    console.error('[proposal-pdf-render] browserless failed', {
      status: rendered.status,
      detail: detail.slice(0, 500)
    });
    return jsonResponse({ error: 'pdf_render_failed' }, 502);
  }

  const bytes = new Uint8Array(await rendered.arrayBuffer());
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (!bytes.length || signature !== '%PDF-') {
    console.error('[proposal-pdf-render] invalid PDF response', {
      contentType: rendered.headers.get('content-type') || '',
      size: bytes.length
    });
    return jsonResponse({ error: 'pdf_render_invalid_response' }, 502);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="proposal.pdf"',
      'Cache-Control': 'no-store'
    }
  });
});
