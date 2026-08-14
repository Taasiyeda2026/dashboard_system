import { supabase, supabaseConfig } from './supabase-client.js';

const PDF_FUNCTION_NAME = 'proposal-pdf-render';
const MAX_PDF_HTML_BYTES = 4 * 1024 * 1024;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function escapeHtmlAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function absoluteUrl(value, baseUrl) {
  const raw = text(value);
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return raw;
  }
}

function proposalPdfBaseUrl() {
  if (typeof window === 'undefined' || !window.location?.href) return '';
  try {
    return new URL('/', window.location.href).href;
  } catch {
    return window.location.origin ? `${window.location.origin}/` : '';
  }
}

function proposalPdfHeadAssets(baseUrl) {
  if (typeof document === 'undefined') return '';
  const output = [];
  const seenLinks = new Set();

  document.querySelectorAll('link[rel="stylesheet"][href]').forEach((link) => {
    const href = absoluteUrl(link.getAttribute('href'), document.baseURI || baseUrl);
    if (!href || href.startsWith('blob:') || seenLinks.has(href)) return;
    seenLinks.add(href);
    output.push(`<link rel="stylesheet" href="${escapeHtmlAttribute(href)}">`);
  });

  document.querySelectorAll('style').forEach((style) => {
    const css = String(style.textContent || '');
    if (css.trim()) output.push(`<style>${css}</style>`);
  });

  return output.join('\n');
}

function removeExecutableContent(html) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return String(html || '')
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<(?:iframe|object|embed)\b[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, '');
  }

  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  template.content.querySelectorAll('script,iframe,object,embed,button,[data-pdf-exclude],.ds-pa-pdf-spinner')
    .forEach((node) => node.remove());
  return template.innerHTML;
}

export function buildProposalNativePdfHtml(documentHtmlSnapshot, options = {}) {
  const bodyHtml = removeExecutableContent(documentHtmlSnapshot);
  if (!text(bodyHtml)) throw new Error('proposal_pdf_html_missing');

  const baseUrl = text(options.baseUrl) || proposalPdfBaseUrl();
  const title = text(options.title) || 'הצעת מחיר';
  const headAssets = proposalPdfHeadAssets(baseUrl);
  const baseTag = baseUrl ? `<base href="${escapeHtmlAttribute(baseUrl)}">` : '';

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseTag}
  <title>${escapeHtmlAttribute(title)}</title>
  ${headAssets}
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; direction: rtl; background: #fff; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #proposal-native-pdf-root { direction: rtl; }
    [data-pdf-exclude], .proposal-preview-toolbar, .ds-pa-pdf-spinner { display: none !important; }
  </style>
</head>
<body>
  <main id="proposal-native-pdf-root" dir="rtl">${bodyHtml}</main>
  <script>
    (() => {
      window.__proposalNativePdfReady = false;
      const waitForImages = () => Promise.all(Array.from(document.images || []).map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }));
      const markReady = async () => {
        try {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          await waitForImages();
        } finally {
          window.__proposalNativePdfReady = true;
        }
      };
      if (document.readyState === 'complete') markReady();
      else window.addEventListener('load', markReady, { once: true });
    })();
  </script>
</body>
</html>`;

  const byteLength = typeof TextEncoder === 'function'
    ? new TextEncoder().encode(html).length
    : html.length;
  if (byteLength > MAX_PDF_HTML_BYTES) throw new Error('proposal_pdf_html_too_large');
  return html;
}

async function currentAccessToken() {
  if (!supabase) throw new Error('proposal_pdf_supabase_unavailable');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message || 'proposal_pdf_auth_failed');
  const token = text(data?.session?.access_token);
  if (!token) throw new Error('proposal_pdf_auth_required');
  return token;
}

function proposalPdfErrorMessage(code, fallback = '') {
  const messages = {
    browserless_not_configured: 'מחולל ה-PDF החדש עדיין לא הוגדר בשרת.',
    pdf_render_failed: 'יצירת ה-PDF נכשלה.',
    pdf_render_invalid_response: 'השרת החזיר קובץ PDF לא תקין.',
    proposal_pdf_auth_required: 'נדרש להתחבר מחדש למערכת לפני יצירת PDF.',
    proposal_pdf_html_too_large: 'הצעת המחיר גדולה מדי להפקת PDF.'
  };
  return messages[code] || fallback || 'יצירת ה-PDF נכשלה.';
}

export async function generateProposalNativePdfBlob(documentHtmlSnapshot, options = {}) {
  let stage = 'prepare-html';
  const setStage = (value) => {
    stage = value;
    options.onStage?.(value);
  };

  try {
    setStage('prepare-html');
    const html = buildProposalNativePdfHtml(documentHtmlSnapshot, options);
    const token = await currentAccessToken();
    const base = text(supabaseConfig?.url).replace(/\/+$/, '');
    if (!base) throw new Error('proposal_pdf_supabase_unavailable');

    setStage('render-pdf');
    const response = await fetch(`${base}/functions/v1/${PDF_FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: text(supabaseConfig?.publishableKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ html })
    });

    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      const code = text(payload?.error) || `proposal_pdf_http_${response.status}`;
      const error = new Error(proposalPdfErrorMessage(code, text(payload?.message)));
      error.code = code;
      error.status = response.status;
      throw error;
    }

    setStage('validate-pdf');
    const pdf = await response.blob();
    if (!pdf.size) throw new Error('pdf_blob_empty');
    const signature = new TextDecoder().decode(await pdf.slice(0, 5).arrayBuffer());
    if (signature !== '%PDF-') {
      const error = new Error(proposalPdfErrorMessage('pdf_render_invalid_response'));
      error.code = 'pdf_render_invalid_response';
      throw error;
    }
    return pdf.type === 'application/pdf' ? pdf : pdf.slice(0, pdf.size, 'application/pdf');
  } catch (error) {
    if (!error?.userMessage) error.userMessage = proposalPdfErrorMessage(error?.code || error?.message, error?.message);
    console.error('[proposal-native-pdf-failed]', {
      stage,
      proposalId: text(options.proposalId),
      code: error?.code || '',
      message: error?.message || String(error)
    });
    throw error;
  }
}
